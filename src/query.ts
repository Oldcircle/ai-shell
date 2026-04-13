/**
 * 核心查询循环
 *
 * 这是整个 AI Shell 的大脑 —— 管理 LLM 交互的完整生命周期：
 *
 * 1. 将用户输入 + 历史消息 + 系统提示词发给 LLM
 * 2. 流式接收 LLM 响应
 * 3. 如果 LLM 返回 tool_use → 执行工具 → 将结果作为 tool_result 发回
 * 4. 循环直到 LLM 给出最终文本回复（end_turn）
 *
 * 使用 async generator 模式，让调用方可以逐步接收事件并更新 UI。
 */

import type { Message, AssistantMessage, ToolUseBlock } from "./core/message"
import {
	createToolResultMessage,
	extractToolUses,
} from "./core/message"
import type { Tool, ToolUseContext, ToolResult } from "./core/tool"
import { findToolByName, toolsToAPISchemas } from "./core/tool"
import type { Provider, StreamEvent, TokenUsage } from "./providers/types"

// ─── Query 事件（UI 消费用）───

export interface QueryTextEvent {
	type: "text"
	text: string
}

export interface QueryThinkingEvent {
	type: "thinking"
	thinking: string
}

export interface QueryToolStartEvent {
	type: "tool_start"
	toolName: string
	toolId: string
	input: Record<string, unknown>
}

export interface QueryToolEndEvent {
	type: "tool_end"
	toolName: string
	toolId: string
	result: ToolResult
}

export interface QueryDoneEvent {
	type: "done"
	usage: TokenUsage
	messages: Message[]
}

export interface QueryErrorEvent {
	type: "error"
	error: Error
}

export type QueryEvent =
	| QueryTextEvent
	| QueryThinkingEvent
	| QueryToolStartEvent
	| QueryToolEndEvent
	| QueryDoneEvent
	| QueryErrorEvent

// ─── Query 参数 ───

export interface QueryParams {
	provider: Provider
	model: string
	systemPrompt: string
	messages: Message[]
	tools: readonly Tool[]
	/** 工具执行上下文 */
	toolContext: ToolUseContext
	/** 最大工具循环轮次（防止无限循环）*/
	maxTurns?: number
	/** 中止信号 */
	abortSignal?: AbortSignal
}

// ─── 核心查询函数 ───

const DEFAULT_MAX_TURNS = 25

/**
 * 执行一次完整的查询循环。
 * 返回 async generator，产出 QueryEvent 流。
 */
export async function* query(params: QueryParams): AsyncGenerator<QueryEvent> {
	const {
		provider,
		model,
		systemPrompt,
		tools,
		toolContext,
		maxTurns = DEFAULT_MAX_TURNS,
		abortSignal,
	} = params

	// 工具 schema（发给 API）
	const toolSchemas = toolsToAPISchemas(tools)

	// 消息副本（会在循环中追加 tool_result）
	const messages = [...params.messages]
	let totalUsage: TokenUsage = {
		inputTokens: 0,
		outputTokens: 0,
	}

	// ─── 工具循环 ───
	for (let turn = 0; turn < maxTurns; turn++) {
		// 检查是否被中止
		if (abortSignal?.aborted) {
			yield { type: "error", error: new Error("Request aborted") }
			return
		}

		// ─── 1. 调用 LLM（含错误流中止检测）───
		const stream = provider.stream({
			model,
			systemPrompt,
			messages,
			tools: toolSchemas.length > 0 ? toolSchemas : undefined,
		})
		let streamErrored = false

		// 累积本轮 assistant 响应
		let assistantText = ""
		const toolUses: ToolUseBlock[] = []
		let currentToolUse: {
			id: string
			name: string
			inputJson: string
		} | null = null
		let stopReason: string | undefined

		// ─── 2. 流式处理响应 ───
		for await (const event of stream) {
			if (abortSignal?.aborted) {
				yield { type: "error", error: new Error("Request aborted") }
				return
			}

			switch (event.type) {
				case "text":
					assistantText += event.text
					yield { type: "text", text: event.text }
					break

				case "thinking":
					yield { type: "thinking", thinking: event.thinking }
					break

				case "tool_use_start":
					currentToolUse = {
						id: event.id,
						name: event.name,
						inputJson: "",
					}
					break

				case "tool_use_input":
					if (currentToolUse) {
						currentToolUse.inputJson += event.partial_json
					}
					break

				case "tool_use_end":
					if (currentToolUse) {
						let input: Record<string, unknown> = {}
						try {
							input = JSON.parse(currentToolUse.inputJson || "{}")
						} catch {
							// JSON 解析失败，用空对象
						}
						toolUses.push({
							type: "tool_use",
							id: currentToolUse.id,
							name: currentToolUse.name,
							input,
						})
						currentToolUse = null
					}
					break

				case "done":
					totalUsage = {
						inputTokens: totalUsage.inputTokens + event.usage.inputTokens,
						outputTokens: totalUsage.outputTokens + event.usage.outputTokens,
						cacheReadTokens:
							(totalUsage.cacheReadTokens ?? 0) +
							(event.usage.cacheReadTokens ?? 0),
						cacheWriteTokens:
							(totalUsage.cacheWriteTokens ?? 0) +
							(event.usage.cacheWriteTokens ?? 0),
					}
					stopReason = event.stopReason
					break

				case "error":
					yield { type: "error", error: event.error }
					return
			}
		}

		// ─── 3. 构建 assistant 消息 ───
		const contentBlocks: AssistantMessage["content"] = []
		if (assistantText) {
			contentBlocks.push({ type: "text", text: assistantText })
		}
		contentBlocks.push(...toolUses)

		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: contentBlocks.length === 1 && contentBlocks[0].type === "text"
				? assistantText
				: contentBlocks,
		}
		messages.push(assistantMessage)

		// ─── 4. 如果没有 tool_use，完成 ───
		if (toolUses.length === 0 || stopReason !== "tool_use") {
			yield { type: "done", usage: totalUsage, messages }
			return
		}

		// ─── 5. 执行工具并收集结果 ───
		// 分离可并行和必须串行的工具
		const concurrentUses: typeof toolUses = []
		const sequentialUses: typeof toolUses = []
		for (const tu of toolUses) {
			const t = findToolByName(tools, tu.name)
			if (t?.isConcurrencySafe()) {
				concurrentUses.push(tu)
			} else {
				sequentialUses.push(tu)
			}
		}

		const toolResults: { toolUseId: string; content: string; isError: boolean }[] = []

		/** 执行单个工具，含 Zod 验证 */
		const executeTool = async (
			toolUse: ToolUseBlock,
		): Promise<{ toolUseId: string; content: string; isError: boolean }> => {
			const tool = findToolByName(tools, toolUse.name)

			if (!tool) {
				return {
					toolUseId: toolUse.id,
					content: `Unknown tool: ${toolUse.name}`,
					isError: true,
				}
			}

			// Zod 输入验证
			const parseResult = tool.inputSchema.safeParse(toolUse.input)
			if (!parseResult.success) {
				return {
					toolUseId: toolUse.id,
					content: `Invalid input for ${tool.name}: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
					isError: true,
				}
			}

			// 执行工具
			let result: ToolResult
			try {
				result = await tool.call(parseResult.data, toolContext)
			} catch (error) {
				result = {
					content: `Tool execution error: ${(error as Error).message}`,
					isError: true,
				}
			}

			return {
				toolUseId: toolUse.id,
				content: result.content,
				isError: result.isError ?? false,
			}
		}

		// 并行执行可并发工具
		if (concurrentUses.length > 0) {
			for (const tu of concurrentUses) {
				yield { type: "tool_start", toolName: tu.name, toolId: tu.id, input: tu.input }
			}
			const concurrentResults = await Promise.all(
				concurrentUses.map((tu) => executeTool(tu)),
			)
			for (let i = 0; i < concurrentUses.length; i++) {
				yield {
					type: "tool_end",
					toolName: concurrentUses[i].name,
					toolId: concurrentUses[i].id,
					result: { content: concurrentResults[i].content, isError: concurrentResults[i].isError },
				}
			}
			toolResults.push(...concurrentResults)
		}

		// 串行执行不可并发工具
		for (const toolUse of sequentialUses) {
			yield { type: "tool_start", toolName: toolUse.name, toolId: toolUse.id, input: toolUse.input }
			const tr = await executeTool(toolUse)
			yield {
				type: "tool_end",
				toolName: toolUse.name,
				toolId: toolUse.id,
				result: { content: tr.content, isError: tr.isError },
			}
			toolResults.push(tr)
		}

		// ─── 6. 将工具结果合并为单个 user 消息发回 ───
		// Anthropic API 要求同一轮的所有 tool_result 在同一个 user 消息中
		if (toolResults.length === 1) {
			messages.push(
				createToolResultMessage(
					toolResults[0].toolUseId,
					toolResults[0].content,
					toolResults[0].isError,
				),
			)
		} else if (toolResults.length > 1) {
			messages.push({
				role: "user",
				content: toolResults.map((tr) => ({
					type: "tool_result" as const,
					tool_use_id: tr.toolUseId,
					content: tr.content,
					...(tr.isError && { is_error: true }),
				})),
			})
		}

		// 继续循环，LLM 会看到工具结果并继续响应
	}

	// 超过最大轮次
	yield {
		type: "error",
		error: new Error(`Exceeded maximum tool turns (${maxTurns})`),
	}
}
