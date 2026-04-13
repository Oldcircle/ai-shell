/**
 * Anthropic Provider
 *
 * 直连 Anthropic Messages API 的实现。
 * 核心职责：将 Provider 接口的请求转为 Anthropic SDK 调用，将 SDK 的流式事件转为统一的 StreamEvent。
 */

import Anthropic from "@anthropic-ai/sdk"
import type {
	Provider,
	ProviderRequest,
	StreamEvent,
	TokenUsage,
	StopReason,
	ToolSchema,
} from "./types"
import { toAPIMessages } from "../core/message"

// ─── 模型配置 ───

const MODEL_MAX_TOKENS: Record<string, number> = {
	"claude-sonnet-4-20250514": 16384,
	"claude-opus-4-20250514": 16384,
	"claude-haiku-4-5-20251001": 8192,
	// 默认
	default: 8192,
}

// ─── Provider 实现 ───

export function createAnthropicProvider(): Provider {
	let client: Anthropic | null = null

	function getClient(): Anthropic {
		if (!client) {
			client = new Anthropic()
		}
		return client
	}

	return {
		name: "anthropic",

		isAvailable(): boolean {
			return !!process.env.ANTHROPIC_API_KEY
		},

		getMaxOutputTokens(model: string): number {
			return MODEL_MAX_TOKENS[model] ?? MODEL_MAX_TOKENS.default
		},

		async *stream(request: ProviderRequest): AsyncGenerator<StreamEvent> {
			const anthropic = getClient()
			const messages = toAPIMessages(request.messages)
			const maxTokens = request.maxTokens ?? this.getMaxOutputTokens(request.model)

			// 构建请求参数
			const params: Anthropic.MessageCreateParams = {
				model: request.model,
				max_tokens: maxTokens,
				system: request.systemPrompt,
				messages,
				stream: true,
			}

			// 添加工具
			if (request.tools && request.tools.length > 0) {
				params.tools = request.tools.map(toolSchemaToAnthropic)
			}

			// 温度
			if (request.temperature !== undefined) {
				params.temperature = request.temperature
			}

			// Extended thinking
			if (request.thinking?.enabled) {
				;(params as unknown as Record<string, unknown>).thinking = {
					type: "enabled",
					budget_tokens: request.thinking.budgetTokens ?? 10000,
				}
			}

			// 发起流式请求
			try {
				const stream = anthropic.messages.stream(params)

				// 当前正在累积的 tool use
				let currentToolId: string | null = null

				for await (const event of stream) {
					const events = convertStreamEvent(event, currentToolId)
					for (const e of events) {
						// 跟踪 tool use 状态
						if (e.type === "tool_use_start") {
							currentToolId = e.id
						} else if (e.type === "tool_use_end") {
							currentToolId = null
						}
						yield e
					}
				}

				// 获取最终消息以提取 usage
				const finalMessage = await stream.finalMessage()
				const usageRecord = finalMessage.usage as unknown as Record<string, number>
				yield {
					type: "done",
					usage: {
						inputTokens: finalMessage.usage.input_tokens,
						outputTokens: finalMessage.usage.output_tokens,
						cacheReadTokens: usageRecord.cache_read_input_tokens,
						cacheWriteTokens: usageRecord.cache_creation_input_tokens,
					},
					stopReason: mapStopReason(finalMessage.stop_reason),
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

// ─── 内部辅助函数 ───

function toolSchemaToAnthropic(
	schema: ToolSchema,
): Anthropic.Messages.Tool {
	return {
		name: schema.name,
		description: schema.description,
		input_schema: schema.input_schema as Anthropic.Messages.Tool["input_schema"],
	}
}

function mapStopReason(reason: string | null): StopReason {
	switch (reason) {
		case "end_turn":
			return "end_turn"
		case "tool_use":
			return "tool_use"
		case "max_tokens":
			return "max_tokens"
		case "stop_sequence":
			return "stop_sequence"
		default:
			return "end_turn"
	}
}

/**
 * 将 Anthropic SDK 的流式事件转为统一格式
 * 一个 SDK 事件可能映射为 0 或多个 StreamEvent
 */
function convertStreamEvent(
	event: Anthropic.MessageStreamEvent,
	_currentToolId: string | null,
): StreamEvent[] {
	switch (event.type) {
		case "content_block_start": {
			const block = event.content_block
			if (block.type === "text") {
				return block.text ? [{ type: "text", text: block.text }] : []
			}
			if (block.type === "tool_use") {
				return [{ type: "tool_use_start", id: block.id, name: block.name }]
			}
			if (block.type === "thinking") {
				return block.thinking
					? [{ type: "thinking", thinking: block.thinking }]
					: []
			}
			return []
		}

		case "content_block_delta": {
			const delta = event.delta
			if (delta.type === "text_delta") {
				return [{ type: "text", text: delta.text }]
			}
			if (delta.type === "input_json_delta") {
				return [{ type: "tool_use_input", partial_json: delta.partial_json }]
			}
			if (delta.type === "thinking_delta") {
				return [{ type: "thinking", thinking: delta.thinking }]
			}
			return []
		}

		case "content_block_stop":
			// 如果当前有 tool use 正在进行，发出结束事件
			if (_currentToolId) {
				return [{ type: "tool_use_end" }]
			}
			return []

		default:
			return []
	}
}
