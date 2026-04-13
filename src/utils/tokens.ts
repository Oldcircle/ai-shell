/**
 * Token 计数估算
 *
 * 精确计数需要 tokenizer（大且慢），这里用启发式估算：
 * - 英文：~4 字符/token
 * - 中文：~1.5 字符/token
 * - 代码：~3.5 字符/token
 * - JSON/结构化：~3 字符/token
 *
 * 误差范围 ±15%，足够做上下文预算决策。
 */

import type { Message } from "../core/message"

/** 估算一段文本的 token 数 */
export function estimateTokens(text: string): number {
	if (!text) return 0

	// 统计中文字符占比来调整比率
	const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) ?? []).length
	const totalChars = text.length
	const cjkRatio = totalChars > 0 ? cjkCount / totalChars : 0

	// 混合比率：CJK 部分按 1.5 char/token，其余按 3.8 char/token
	const cjkTokens = cjkCount / 1.5
	const otherTokens = (totalChars - cjkCount) / 3.8

	return Math.ceil(cjkTokens + otherTokens)
}

/** 估算单条消息的 token 数 */
export function estimateMessageTokens(msg: Message): number {
	// 角色标记 ~4 tokens
	let tokens = 4

	if (typeof msg.content === "string") {
		tokens += estimateTokens(msg.content)
	} else {
		for (const block of msg.content) {
			if ("text" in block && typeof block.text === "string") {
				tokens += estimateTokens(block.text)
			} else if ("thinking" in block && typeof block.thinking === "string") {
				tokens += estimateTokens(block.thinking)
			} else if ("content" in block && typeof block.content === "string") {
				tokens += estimateTokens(block.content)
			} else if ("input" in block) {
				tokens += estimateTokens(JSON.stringify(block.input))
			}
			// 每个 block 有 ~3 tokens 的结构开销
			tokens += 3
		}
	}

	return tokens
}

/** 估算整个消息列表的 token 数 */
export function estimateTotalTokens(messages: Message[]): number {
	return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0)
}

/** 模型的上下文窗口大小 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
	"claude-sonnet-4-20250514": 200_000,
	"claude-opus-4-20250514": 200_000,
	"claude-haiku-4-5-20251001": 200_000,
	"deepseek-chat": 64_000,
	"gpt-4o": 128_000,
	default: 64_000,
}

export function getContextWindow(model: string): number {
	return MODEL_CONTEXT_WINDOWS[model] ?? MODEL_CONTEXT_WINDOWS.default
}

/** 获取自动压缩阈值（上下文窗口的 80%）*/
export function getCompactThreshold(model: string): number {
	return Math.floor(getContextWindow(model) * 0.8)
}

/** 检查是否需要压缩 */
export function shouldCompact(messages: Message[], model: string): boolean {
	const tokenCount = estimateTotalTokens(messages)
	const threshold = getCompactThreshold(model)
	return tokenCount >= threshold
}
