/**
 * Provider 接口定义
 *
 * 所有 LLM API 提供商的统一抽象层。
 * 核心思想：下游代码只跟 Provider 接口打交道，不关心底层是 Anthropic、OpenAI 还是 Ollama。
 */

import type { Message } from "../core/message"

// ─── 流式事件类型 ───

export interface StreamTextEvent {
	type: "text"
	text: string
}

export interface StreamToolUseStartEvent {
	type: "tool_use_start"
	id: string
	name: string
}

export interface StreamToolUseInputEvent {
	type: "tool_use_input"
	/** JSON 字符串片段（需要累积后 parse） */
	partial_json: string
}

export interface StreamToolUseEndEvent {
	type: "tool_use_end"
}

export interface StreamThinkingEvent {
	type: "thinking"
	thinking: string
}

export interface StreamDoneEvent {
	type: "done"
	usage: TokenUsage
	stopReason: StopReason
}

export interface StreamErrorEvent {
	type: "error"
	error: Error
}

export type StreamEvent =
	| StreamTextEvent
	| StreamToolUseStartEvent
	| StreamToolUseInputEvent
	| StreamToolUseEndEvent
	| StreamThinkingEvent
	| StreamDoneEvent
	| StreamErrorEvent

// ─── Token 用量 ───

export interface TokenUsage {
	inputTokens: number
	outputTokens: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
}

// ─── 停止原因 ───

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"

// ─── 工具 Schema（发给 API 的格式）───

export interface ToolSchema {
	name: string
	description: string
	input_schema: Record<string, unknown>
}

// ─── Provider 请求参数 ───

export interface ProviderRequest {
	model: string
	systemPrompt: string
	messages: Message[]
	tools?: ToolSchema[]
	maxTokens?: number
	temperature?: number
	/** 是否启用 extended thinking */
	thinking?: {
		enabled: boolean
		budgetTokens?: number
	}
}

// ─── Provider 接口 ───

export interface Provider {
	name: string

	/**
	 * 发起流式请求，返回 async generator
	 * 调用方通过 for-await 消费事件流
	 */
	stream(request: ProviderRequest): AsyncGenerator<StreamEvent>

	/** 当前 provider 是否可用（API key 是否配置等） */
	isAvailable(): boolean

	/** 获取模型的最大输出 token 数 */
	getMaxOutputTokens(model: string): number
}
