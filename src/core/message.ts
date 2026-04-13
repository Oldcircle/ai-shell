/**
 * 消息类型系统
 *
 * 定义 AI Shell 中所有消息类型，对齐 Anthropic Messages API 格式。
 * 这是整个系统的数据基础 —— query loop、UI 渲染、持久化都依赖这些类型。
 */

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages"

// ─── 基础内容块类型 ───

export interface TextBlock {
	type: "text"
	text: string
}

export interface ToolUseBlock {
	type: "tool_use"
	id: string
	name: string
	input: Record<string, unknown>
}

export interface ToolResultBlock {
	type: "tool_result"
	tool_use_id: string
	content: string
	is_error?: boolean
}

export interface ThinkingBlock {
	type: "thinking"
	thinking: string
}

// ─── 消息类型 ───

export interface UserMessage {
	role: "user"
	content: string | (TextBlock | ToolResultBlock)[]
}

export interface AssistantMessage {
	role: "assistant"
	content: string | (TextBlock | ToolUseBlock | ThinkingBlock)[]
}

export interface SystemMessage {
	type: "system"
	text: string
}

/** 对话中的一条消息（不含 system，system 单独传） */
export type Message = UserMessage | AssistantMessage

/** 所有消息类型，含 system */
export type AnyMessage = Message | SystemMessage

// ─── 工厂函数 ───

export function createUserMessage(text: string): UserMessage {
	return { role: "user", content: text }
}

export function createAssistantMessage(text: string): AssistantMessage {
	return { role: "assistant", content: text }
}

export function createToolResultMessage(
	toolUseId: string,
	content: string,
	isError = false,
): UserMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				content,
				...(isError && { is_error: true }),
			},
		],
	}
}

// ─── API 格式转换 ───

/** 将内部消息转为 Anthropic API 格式 */
export function toAPIMessage(msg: Message): MessageParam {
	if (typeof msg.content === "string") {
		return { role: msg.role, content: msg.content }
	}
	return {
		role: msg.role,
		content: msg.content.map((block) => {
			if (block.type === "thinking") {
				// thinking blocks 不发给 API（仅内部显示用）
				return { type: "text" as const, text: `[thinking] ${block.thinking}` }
			}
			return block as MessageParam["content"][0]
		}),
	} as MessageParam
}

/** 批量转换消息为 API 格式 */
export function toAPIMessages(messages: Message[]): MessageParam[] {
	return messages.map(toAPIMessage)
}

// ─── 工具调用提取 ───

/** 从 assistant 消息中提取所有 tool_use 块 */
export function extractToolUses(msg: AssistantMessage): ToolUseBlock[] {
	if (typeof msg.content === "string") return []
	return msg.content.filter((b): b is ToolUseBlock => b.type === "tool_use")
}

/** 从 assistant 消息中提取文本内容 */
export function extractText(msg: AssistantMessage): string {
	if (typeof msg.content === "string") return msg.content
	return msg.content
		.filter((b): b is TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("")
}
