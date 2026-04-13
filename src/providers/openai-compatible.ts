/**
 * OpenAI Compatible Provider
 *
 * 支持任何 OpenAI Chat Completions 兼容端点：DeepSeek、Ollama、vLLM、Together 等。
 * 核心思路：将 OpenAI 格式的流式响应转为统一的 StreamEvent。
 *
 * 环境变量：
 *   OPENAI_API_KEY / DEEPSEEK_API_KEY — API 密钥
 *   OPENAI_BASE_URL / DEEPSEEK_BASE_URL — 端点 URL
 *   OPENAI_MODEL / DEEPSEEK_MODEL — 模型名称
 */

import type {
	Provider,
	ProviderRequest,
	StreamEvent,
	ToolSchema,
} from "./types"
import type { Message, ToolResultBlock, TextBlock, ToolUseBlock } from "../core/message"

// ─── 配置 ───

interface OpenAIConfig {
	apiKey: string
	baseUrl: string
	model: string
	name: string
}

function getDeepSeekConfig(): OpenAIConfig | null {
	const apiKey = process.env.DEEPSEEK_API_KEY
	if (!apiKey) return null
	return {
		apiKey,
		baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
		model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
		name: "deepseek",
	}
}

function getOpenAIConfig(): OpenAIConfig | null {
	const apiKey = process.env.OPENAI_API_KEY
	if (!apiKey) return null
	return {
		apiKey,
		baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
		model: process.env.OPENAI_MODEL ?? "gpt-4o",
		name: "openai",
	}
}

/** 自动检测可用的 OpenAI 兼容配置 */
function detectConfig(): OpenAIConfig | null {
	return getDeepSeekConfig() ?? getOpenAIConfig()
}

// ─── OpenAI 消息格式 ───

interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool"
	content?: string | null
	tool_calls?: OpenAIToolCall[]
	tool_call_id?: string
}

interface OpenAIToolCall {
	id: string
	type: "function"
	function: {
		name: string
		arguments: string
	}
}

interface OpenAITool {
	type: "function"
	function: {
		name: string
		description: string
		parameters: Record<string, unknown>
	}
}

// ─── SSE 流解析 ───

interface OpenAIDelta {
	role?: string
	content?: string | null
	tool_calls?: Array<{
		index: number
		id?: string
		type?: string
		function?: {
			name?: string
			arguments?: string
		}
	}>
	reasoning_content?: string | null
}

interface OpenAIStreamChunk {
	id: string
	choices: Array<{
		index: number
		delta: OpenAIDelta
		finish_reason: string | null
	}>
	usage?: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}

// ─── 消息转换 ───

function convertMessages(
	systemPrompt: string,
	messages: Message[],
): OpenAIMessage[] {
	const result: OpenAIMessage[] = [
		{ role: "system", content: systemPrompt },
	]

	for (const msg of messages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				result.push({ role: "user", content: msg.content })
			} else {
				// 处理 tool_result 块
				for (const block of msg.content) {
					if ((block as ToolResultBlock).type === "tool_result") {
						const tr = block as ToolResultBlock
						result.push({
							role: "tool",
							content: tr.content,
							tool_call_id: tr.tool_use_id,
						})
					} else if ((block as TextBlock).type === "text") {
						result.push({
							role: "user",
							content: (block as TextBlock).text,
						})
					}
				}
			}
		} else if (msg.role === "assistant") {
			if (typeof msg.content === "string") {
				result.push({ role: "assistant", content: msg.content })
			} else {
				// 收集文本和 tool_calls
				let text = ""
				const toolCalls: OpenAIToolCall[] = []
				for (const block of msg.content) {
					if ((block as TextBlock).type === "text") {
						text += (block as TextBlock).text
					} else if ((block as ToolUseBlock).type === "tool_use") {
						const tu = block as ToolUseBlock
						toolCalls.push({
							id: tu.id,
							type: "function",
							function: {
								name: tu.name,
								arguments: JSON.stringify(tu.input),
							},
						})
					}
				}
				const assistantMsg: OpenAIMessage = {
					role: "assistant",
					content: text || null,
				}
				if (toolCalls.length > 0) {
					assistantMsg.tool_calls = toolCalls
				}
				result.push(assistantMsg)
			}
		}
	}

	return result
}

function convertTools(tools: ToolSchema[]): OpenAITool[] {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.input_schema,
		},
	}))
}

// ─── Provider 实现 ───

export function createOpenAICompatibleProvider(
	configOverride?: OpenAIConfig,
): Provider {
	const config = configOverride ?? detectConfig()

	return {
		name: config?.name ?? "openai-compatible",

		isAvailable(): boolean {
			return config !== null
		},

		getMaxOutputTokens(_model: string): number {
			return 8192
		},

		async *stream(request: ProviderRequest): AsyncGenerator<StreamEvent> {
			if (!config) {
				yield {
					type: "error",
					error: new Error(
						"No OpenAI-compatible API key found. Set DEEPSEEK_API_KEY or OPENAI_API_KEY.",
					),
				}
				return
			}

			const model = request.model === config.model ? config.model : config.model
			const messages = convertMessages(request.systemPrompt, request.messages)

			const body: Record<string, unknown> = {
				model,
				messages,
				stream: true,
				stream_options: { include_usage: true },
			}

			if (request.tools && request.tools.length > 0) {
				body.tools = convertTools(request.tools)
			}

			if (request.maxTokens) {
				body.max_tokens = request.maxTokens
			}

			if (request.temperature !== undefined) {
				body.temperature = request.temperature
			}

			try {
				const response = await fetch(`${config.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${config.apiKey}`,
					},
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(120_000), // 2 分钟 API 超时
				})

				if (!response.ok) {
					const errorText = await response.text()
					yield {
						type: "error",
						error: new Error(
							`API error ${response.status}: ${errorText}`,
						),
					}
					return
				}

				if (!response.body) {
					yield { type: "error", error: new Error("No response body") }
					return
				}

				// ─── 解析 SSE 流 ───
				const reader = response.body.getReader()
				const decoder = new TextDecoder()
				let buffer = ""
				let totalInputTokens = 0
				let totalOutputTokens = 0

				// 跟踪 tool calls
				const activeToolCalls = new Map<
					number,
					{ id: string; name: string; args: string }
				>()
				let hasToolCalls = false

				while (true) {
					const { done, value } = await reader.read()
					if (done) break

					buffer += decoder.decode(value, { stream: true })
					const lines = buffer.split("\n")
					buffer = lines.pop() ?? ""

					for (const line of lines) {
						const trimmed = line.trim()
						if (!trimmed || !trimmed.startsWith("data: ")) continue
						const data = trimmed.slice(6)
						if (data === "[DONE]") continue

						let chunk: OpenAIStreamChunk
						try {
							chunk = JSON.parse(data)
						} catch {
							continue
						}

						// Usage (final chunk)
						if (chunk.usage) {
							totalInputTokens = chunk.usage.prompt_tokens
							totalOutputTokens = chunk.usage.completion_tokens
						}

						for (const choice of chunk.choices) {
							const delta = choice.delta

							// 文本内容
							if (delta.content) {
								yield { type: "text", text: delta.content }
							}

							// DeepSeek reasoning (thinking)
							if (delta.reasoning_content) {
								yield {
									type: "thinking",
									thinking: delta.reasoning_content,
								}
							}

							// Tool calls
							if (delta.tool_calls) {
								hasToolCalls = true
								for (const tc of delta.tool_calls) {
									if (tc.id) {
										// 新的 tool call
										activeToolCalls.set(tc.index, {
											id: tc.id,
											name: tc.function?.name ?? "",
											args: tc.function?.arguments ?? "",
										})
										yield {
											type: "tool_use_start",
											id: tc.id,
											name: tc.function?.name ?? "",
										}
									} else {
										// 追加参数
										const existing = activeToolCalls.get(tc.index)
										if (existing && tc.function?.arguments) {
											existing.args += tc.function.arguments
											yield {
												type: "tool_use_input",
												partial_json: tc.function.arguments,
											}
										}
									}
								}
							}

							// finish_reason — 不同 API 返回不同值
							if (
								choice.finish_reason === "tool_calls" ||
								choice.finish_reason === "stop"
							) {
								if (activeToolCalls.size > 0) {
									for (const [idx] of activeToolCalls) {
										yield { type: "tool_use_end" }
									}
									// 标记为已关闭，避免重复发送
									activeToolCalls.clear()
								}
							}
						}
					}
				}

				// 安全兜底：如果有未关闭的 tool calls，发出 end 事件
				if (activeToolCalls.size > 0) {
					for (const [idx] of activeToolCalls) {
						yield { type: "tool_use_end" }
					}
					activeToolCalls.clear()
				}

				yield {
					type: "done",
					usage: {
						inputTokens: totalInputTokens,
						outputTokens: totalOutputTokens,
					},
					stopReason: hasToolCalls ? "tool_use" : "end_turn",
				}
			} catch (error) {
				yield {
					type: "error",
					error: error instanceof Error ? error : new Error(String(error)),
				}
			}
		},
	}
}
