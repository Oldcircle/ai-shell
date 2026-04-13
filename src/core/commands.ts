/**
 * Slash 命令系统
 *
 * 内置命令处理器。不经过 LLM，直接在本地执行。
 */

import type { Message } from "./message"
import type { Provider, TokenUsage } from "../providers/types"
import { manualCompact } from "./compact"
import { listSessions } from "../config/session"
import { getBackgroundTasks, killBackgroundTask } from "../tools/bash"
import { estimateTotalTokens, getContextWindow, getCompactThreshold } from "../utils/tokens"

/** 命令执行结果 */
export interface CommandResult {
	/** 显示给用户的文本 */
	output: string
	/** 是否需要更新消息列表 */
	newMessages?: Message[]
	/** 切换模型 */
	newModel?: string
	/** 重置会话状态（readFiles、caches 等）*/
	resetState?: boolean
	/** 是否应该退出 */
	exit?: boolean
}

/** 命令处理器 */
type CommandHandler = (
	args: string,
	context: CommandContext,
) => Promise<CommandResult>

export interface CommandContext {
	messages: Message[]
	model: string
	provider: Provider
	usage: TokenUsage
	cost: number
	cwd: string
}

// ─── 命令注册表 ───

const commands: Record<string, { handler: CommandHandler; help: string }> = {
	help: {
		handler: handleHelp,
		help: "Show available commands",
	},
	clear: {
		handler: handleClear,
		help: "Clear conversation history",
	},
	compact: {
		handler: handleCompact,
		help: "Compress conversation to free context space",
	},
	cost: {
		handler: handleCost,
		help: "Show token usage and cost",
	},
	context: {
		handler: handleContext,
		help: "Show context window usage",
	},
	model: {
		handler: handleModel,
		help: "Show or change model (e.g. /model deepseek-chat)",
	},
	history: {
		handler: handleHistory,
		help: "List saved sessions",
	},
	tasks: {
		handler: handleTasks,
		help: "List background tasks",
	},
	kill: {
		handler: handleKill,
		help: "Kill a background task (e.g. /kill bg-1)",
	},
	exit: {
		handler: handleExit,
		help: "Exit AI Shell (kills all background tasks)",
	},
	quit: {
		handler: handleExit,
		help: "Exit AI Shell",
	},
}

// ─── 公共 API ───

/** 检查是否是 slash 命令 */
export function isCommand(input: string): boolean {
	return input.startsWith("/") && input.length > 1
}

/** 解析并执行命令 */
export async function executeCommand(
	input: string,
	context: CommandContext,
): Promise<CommandResult> {
	const trimmed = input.slice(1).trim()
	const [cmdName, ...rest] = trimmed.split(/\s+/)
	const args = rest.join(" ")

	const cmd = commands[cmdName.toLowerCase()]
	if (!cmd) {
		const available = Object.keys(commands).join(", ")
		return {
			output: `Unknown command: /${cmdName}\nAvailable: ${available}`,
		}
	}

	return cmd.handler(args, context)
}

// ─── 命令实现 ───

async function handleHelp(): Promise<CommandResult> {
	const lines = [
		"Available commands:",
		"",
		...Object.entries(commands).map(
			([name, { help }]) => `  /${name.padEnd(10)} ${help}`,
		),
		"",
		"Keyboard shortcuts:",
		"  Ctrl+C     Interrupt current request / clear input / exit",
		"  Up/Down    Browse input history",
		"  Ctrl+U     Clear current input line",
	]
	return { output: lines.join("\n") }
}

async function handleClear(): Promise<CommandResult> {
	return {
		output: "Conversation cleared. Session state reset.",
		newMessages: [],
		resetState: true,
	}
}

async function handleCompact(
	_args: string,
	context: CommandContext,
): Promise<CommandResult> {
	if (context.messages.length < 4) {
		return { output: "Not enough messages to compact." }
	}

	const result = await manualCompact(
		context.messages,
		context.model,
		context.provider,
	)

	if (result.compactedCount === 0) {
		return { output: "No messages were compacted." }
	}

	return {
		output: [
			`Compacted ${result.compactedCount} messages.`,
			`Tokens: ${result.beforeTokens} → ${result.afterTokens} (saved ${result.beforeTokens - result.afterTokens})`,
		].join("\n"),
		newMessages: result.messages,
	}
}

async function handleCost(
	_args: string,
	context: CommandContext,
): Promise<CommandResult> {
	const { usage, cost } = context
	return {
		output: [
			"Token Usage:",
			`  Input:  ${usage.inputTokens.toLocaleString()} tokens`,
			`  Output: ${usage.outputTokens.toLocaleString()} tokens`,
			`  Cache read:  ${(usage.cacheReadTokens ?? 0).toLocaleString()} tokens`,
			`  Cache write: ${(usage.cacheWriteTokens ?? 0).toLocaleString()} tokens`,
			`  Total cost:  $${cost.toFixed(4)}`,
		].join("\n"),
	}
}

async function handleContext(
	_args: string,
	context: CommandContext,
): Promise<CommandResult> {
	const currentTokens = estimateTotalTokens(context.messages)
	const windowSize = getContextWindow(context.model)
	const threshold = getCompactThreshold(context.model)
	const usage = ((currentTokens / windowSize) * 100).toFixed(1)
	const bar = renderBar(currentTokens, windowSize)

	return {
		output: [
			`Context Window: ${context.model}`,
			`  ${bar}`,
			`  ${currentTokens.toLocaleString()} / ${windowSize.toLocaleString()} tokens (${usage}%)`,
			`  Auto-compact at: ${threshold.toLocaleString()} tokens (80%)`,
			`  Messages: ${context.messages.length}`,
		].join("\n"),
	}
}

function renderBar(current: number, total: number): string {
	const width = 30
	const filled = Math.round((current / total) * width)
	const color = filled / width > 0.8 ? "!" : filled / width > 0.5 ? "~" : "="
	return `[${"=".repeat(Math.min(filled, width))}${" ".repeat(Math.max(0, width - filled))}]`
}

const KNOWN_MODELS = [
	"claude-sonnet-4-20250514",
	"claude-opus-4-20250514",
	"claude-haiku-4-5-20251001",
	"deepseek-chat",
	"deepseek-reasoner",
	"gpt-4o",
	"gpt-4o-mini",
]

async function handleModel(
	args: string,
	context: CommandContext,
): Promise<CommandResult> {
	if (!args) {
		return {
			output: [
				`Current model: ${context.model}`,
				"",
				"Available models:",
				...KNOWN_MODELS.map((m) =>
					`  ${m === context.model ? "* " : "  "}${m}`,
				),
				"",
				"Switch: /model <name>",
			].join("\n"),
		}
	}

	const newModel = args.trim()
	return {
		output: `Model switched to: ${newModel}`,
		newModel,
	}
}

async function handleHistory(): Promise<CommandResult> {
	const sessions = await listSessions(10)
	if (sessions.length === 0) {
		return { output: "No saved sessions found." }
	}

	const lines = [
		"Recent sessions:",
		"",
		...sessions.map((s) => {
			const date = s.modifiedAt.toLocaleString()
			return `  ${s.id}  ${s.messageCount} msgs  ${date}`
		}),
		"",
		"Resume with: ai-shell --resume <session-id>",
	]
	return { output: lines.join("\n") }
}

async function handleTasks(): Promise<CommandResult> {
	const tasks = getBackgroundTasks()
	if (tasks.length === 0) {
		return { output: "No background tasks running." }
	}

	const lines = [
		"Background tasks:",
		"",
		...tasks.map((t) => {
			const status = t.running ? "running" : "stopped"
			const dur = Math.round(t.durationMs / 1000)
			return `  ${t.id}  PID ${t.pid}  ${status}  ${dur}s  ${t.command}`
		}),
		"",
		"Kill with: /kill <task-id>",
	]
	return { output: lines.join("\n") }
}

async function handleKill(args: string): Promise<CommandResult> {
	if (!args) {
		return { output: "Usage: /kill <task-id>  (e.g. /kill bg-1)" }
	}
	const taskId = args.trim()
	const killed = killBackgroundTask(taskId)
	if (killed) {
		return { output: `Task ${taskId} killed.` }
	}
	return { output: `Task not found: ${taskId}` }
}

async function handleExit(): Promise<CommandResult> {
	// 杀掉所有后台任务
	const tasks = getBackgroundTasks()
	for (const t of tasks) {
		killBackgroundTask(t.id)
	}
	if (tasks.length > 0) {
		return { output: `Killed ${tasks.length} background task(s). Goodbye!`, exit: true }
	}
	return { output: "Goodbye!", exit: true }
}
