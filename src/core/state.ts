/**
 * 应用状态管理
 *
 * 使用 Zustand 管理全局状态。核心设计：
 * - 单例 store，整个 CLI 生命周期共享
 * - 消息历史、工具列表、配置、Token 统计
 * - 不依赖 React（纯 JS 也能用）
 */

import { createStore as zustandCreateStore } from "zustand/vanilla"
import type { Message } from "./message"
import type { Tool } from "./tool"
import type { TokenUsage } from "../providers/types"

// ─── 状态类型 ───

export interface AppState {
	/** 对话消息历史 */
	messages: Message[]
	/** 注册的工具列表 */
	tools: readonly Tool[]
	/** 当前使用的模型 */
	model: string
	/** 系统提示词 */
	systemPrompt: string
	/** 当前工作目录 */
	cwd: string
	/** 会话 ID */
	sessionId: string
	/** 是否正在请求 API */
	isLoading: boolean
	/** 是否已中止当前请求 */
	isAborted: boolean
	/** 累计 Token 用量 */
	totalUsage: TokenUsage
	/** 累计花费（美元） */
	totalCost: number
	/** 是否处于 verbose 模式 */
	verbose: boolean
}

// ─── 默认状态 ───

function generateSessionId(): string {
	return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getDefaultState(): AppState {
	return {
		messages: [],
		tools: [],
		model: "claude-sonnet-4-20250514",
		systemPrompt: "",
		cwd: process.cwd(),
		sessionId: generateSessionId(),
		isLoading: false,
		isAborted: false,
		totalUsage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		totalCost: 0,
		verbose: false,
	}
}

// ─── Store 创建 ───

export type AppStore = ReturnType<typeof createAppStore>

export function createAppStore(initialState?: Partial<AppState>) {
	return zustandCreateStore<AppState>()(() => ({
		...getDefaultState(),
		...initialState,
	}))
}

// ─── 状态操作辅助函数 ───

export function addMessage(store: AppStore, message: Message): void {
	store.setState((state) => ({
		messages: [...state.messages, message],
	}))
}

export function updateLoading(store: AppStore, isLoading: boolean): void {
	store.setState({ isLoading })
}

export function abortRequest(store: AppStore): void {
	store.setState({ isAborted: true })
}

export function resetAbort(store: AppStore): void {
	store.setState({ isAborted: false })
}

export function accumulateUsage(store: AppStore, usage: TokenUsage): void {
	store.setState((state) => ({
		totalUsage: {
			inputTokens: state.totalUsage.inputTokens + usage.inputTokens,
			outputTokens: state.totalUsage.outputTokens + usage.outputTokens,
			cacheReadTokens:
				(state.totalUsage.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
			cacheWriteTokens:
				(state.totalUsage.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
		},
		totalCost: state.totalCost + calculateCost(usage, state.model),
	}))
}

// ─── 成本计算 ───

/** 每百万 token 价格（美元）*/
const PRICING: Record<string, { input: number; output: number }> = {
	// Anthropic
	"claude-sonnet-4-20250514": { input: 3, output: 15 },
	"claude-opus-4-20250514": { input: 15, output: 75 },
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
	// DeepSeek
	"deepseek-chat": { input: 0.14, output: 0.28 },
	"deepseek-reasoner": { input: 0.55, output: 2.19 },
	// OpenAI
	"gpt-4o": { input: 2.5, output: 10 },
	"gpt-4o-mini": { input: 0.15, output: 0.6 },
}

export function calculateCost(usage: TokenUsage, model: string): number {
	const prices = PRICING[model] ?? PRICING["claude-sonnet-4-20250514"]
	const inputCost = (usage.inputTokens / 1_000_000) * prices.input
	const outputCost = (usage.outputTokens / 1_000_000) * prices.output
	// Cache reads 按 input 的 10% 计价
	const cacheReadCost =
		((usage.cacheReadTokens ?? 0) / 1_000_000) * prices.input * 0.1
	// Cache writes 按 input 的 125% 计价
	const cacheWriteCost =
		((usage.cacheWriteTokens ?? 0) / 1_000_000) * prices.input * 1.25
	return inputCost + outputCost + cacheReadCost + cacheWriteCost
}
