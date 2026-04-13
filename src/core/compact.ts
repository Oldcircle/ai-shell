/**
 * 上下文压缩
 *
 * 当对话接近上下文窗口限制时，将旧消息摘要化以释放空间。
 *
 * 策略（参考 Claude Code 简化版）：
 * 1. 保留最近 N 条消息不动
 * 2. 将更早的消息发给 LLM 做摘要
 * 3. 用摘要替换旧消息
 * 4. 确保 tool_use/tool_result 配对不被拆分
 */

import type { Message, AssistantMessage } from "./message"
import type { Provider } from "../providers/types"
import {
	estimateTotalTokens,
	estimateMessageTokens,
	getCompactThreshold,
} from "../utils/tokens"

/** 压缩结果 */
export interface CompactResult {
	messages: Message[]
	/** 被压缩的消息数 */
	compactedCount: number
	/** 压缩前 token 数 */
	beforeTokens: number
	/** 压缩后 token 数 */
	afterTokens: number
}

/** 压缩提示词 */
const COMPACT_SYSTEM_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the conversation so far.

Rules:
- Preserve key technical decisions, file paths, and code changes
- Preserve any errors encountered and their resolutions
- Note which tools were used and their important results
- Keep the summary factual and structured
- Write in the same language as the conversation
- Be concise but don't lose critical context
- Format as a structured summary with bullet points`

const COMPACT_USER_PROMPT = `Summarize the following conversation history into a concise summary. Preserve all important technical details, file paths, decisions, and outcomes.

Conversation to summarize:`

/**
 * 自动压缩对话历史
 *
 * @param messages 当前消息列表
 * @param model 模型名称（用于确定阈值）
 * @param provider 用于生成摘要的 provider
 * @returns 压缩后的消息列表，或 null（不需要压缩）
 */
export async function autoCompact(
	messages: Message[],
	model: string,
	provider: Provider,
): Promise<CompactResult | null> {
	const beforeTokens = estimateTotalTokens(messages)
	const threshold = getCompactThreshold(model)

	if (beforeTokens < threshold) return null

	return compactMessages(messages, model, provider)
}

/**
 * 手动触发压缩（/compact 命令）
 */
export async function manualCompact(
	messages: Message[],
	model: string,
	provider: Provider,
): Promise<CompactResult> {
	return compactMessages(messages, model, provider)
}

async function compactMessages(
	messages: Message[],
	model: string,
	provider: Provider,
): Promise<CompactResult> {
	const beforeTokens = estimateTotalTokens(messages)

	// 决定保留多少条最近消息
	const keepCount = calculateKeepCount(messages)
	const splitIndex = messages.length - keepCount

	if (splitIndex <= 0) {
		// 没有可压缩的消息
		return {
			messages,
			compactedCount: 0,
			beforeTokens,
			afterTokens: beforeTokens,
		}
	}

	// 调整分割点，确保不拆分 tool_use/tool_result 配对
	const safeIndex = adjustSplitIndex(messages, splitIndex)
	const toCompact = messages.slice(0, safeIndex)
	const toKeep = messages.slice(safeIndex)

	if (toCompact.length === 0) {
		return {
			messages,
			compactedCount: 0,
			beforeTokens,
			afterTokens: beforeTokens,
		}
	}

	// 生成摘要
	const summary = await generateSummary(toCompact, model, provider)

	// 构建压缩后的消息列表
	const compactedMessages: Message[] = [
		{
			role: "user",
			content: `[Previous conversation summary]\n\n${summary}\n\n[End of summary — conversation continues below]`,
		},
		{
			role: "assistant",
			content:
				"Understood. I have the context from the previous conversation. Let me continue from where we left off.",
		},
		...toKeep,
	]

	const afterTokens = estimateTotalTokens(compactedMessages)

	return {
		messages: compactedMessages,
		compactedCount: toCompact.length,
		beforeTokens,
		afterTokens,
	}
}

/**
 * 计算应保留的最近消息数量
 * 目标：保留约 30% 的消息，但至少 4 条，最多 40 条
 */
function calculateKeepCount(messages: Message[]): number {
	const target = Math.floor(messages.length * 0.3)
	return Math.max(4, Math.min(target, 40))
}

/**
 * 调整分割点，确保不拆分 tool_use/tool_result 配对
 *
 * tool_use 在 assistant 消息中，对应的 tool_result 在下一个 user 消息中。
 * 如果分割点落在中间，向前移到 tool_use 之前。
 */
function adjustSplitIndex(messages: Message[], index: number): number {
	let adjusted = index

	// 向前扫描，如果 index 处的消息是 tool_result，退到前面
	while (adjusted > 0) {
		const msg = messages[adjusted]
		if (msg.role === "user" && typeof msg.content !== "string") {
			const blocks = msg.content as Array<{ type: string }>
			if (blocks.some((b) => b.type === "tool_result")) {
				adjusted--
				continue
			}
		}
		break
	}

	return adjusted
}

/**
 * 调用 LLM 生成对话摘要
 */
async function generateSummary(
	messages: Message[],
	model: string,
	provider: Provider,
): Promise<string> {
	// 将消息格式化为可读文本
	const formatted = messages
		.map((msg) => {
			const role = msg.role === "user" ? "User" : "Assistant"
			let content: string
			if (typeof msg.content === "string") {
				content = msg.content
			} else {
				content = msg.content
					.map((block) => {
						if ("text" in block) return block.text
						if ("type" in block && block.type === "tool_use") {
							const tu = block as { name: string; input: unknown }
							return `[Tool: ${tu.name}(${JSON.stringify(tu.input).slice(0, 200)})]`
						}
						if ("type" in block && block.type === "tool_result") {
							const tr = block as { content: string }
							return `[Tool Result: ${tr.content.slice(0, 200)}]`
						}
						return ""
					})
					.filter(Boolean)
					.join("\n")
			}
			return `${role}: ${content}`
		})
		.join("\n\n")

	// 截断过长的内容（摘要请求本身不能太大）
	const maxChars = 50_000
	const truncated =
		formatted.length > maxChars
			? `${formatted.slice(0, maxChars)}\n\n[... truncated ...]`
			: formatted

	// 调用 LLM 生成摘要
	const summaryMessages: Message[] = [
		{
			role: "user",
			content: `${COMPACT_USER_PROMPT}\n\n${truncated}`,
		},
	]

	let summary = ""

	const stream = provider.stream({
		model,
		systemPrompt: COMPACT_SYSTEM_PROMPT,
		messages: summaryMessages,
		maxTokens: 2000,
		temperature: 0,
	})

	for await (const event of stream) {
		if (event.type === "text") {
			summary += event.text
		}
		if (event.type === "error") {
			// 如果摘要失败，返回简单的消息计数
			return `[Compacted ${messages.length} messages. Summary generation failed: ${event.error.message}]`
		}
	}

	return summary || `[Compacted ${messages.length} messages]`
}
