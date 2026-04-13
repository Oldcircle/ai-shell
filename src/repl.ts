/**
 * Readline REPL — 终端交互模式
 *
 * 参考 Claude Code 的交互体验：
 * - 流式文本输出（逐字符显示）
 * - 工具调用内联显示（⚡ 工具名 ✓/✗）
 * - Markdown 渲染（最终输出时应用）
 * - Ctrl+C 中断 + 历史 + 命令系统
 */

import { createInterface, moveCursor, clearLine } from "node:readline"
import chalk from "chalk"
import type { Provider } from "./providers/types"
import type { Tool } from "./core/tool"
import type { Message } from "./core/message"
import type { TokenUsage } from "./providers/types"
import { query } from "./query"
import { isCommand, executeCommand } from "./core/commands"
import { autoCompact } from "./core/compact"
import { saveSession, generateSessionId } from "./config/session"
import { renderMarkdown } from "./utils/markdown"

interface ReplOptions {
	provider: Provider
	model: string
	systemPrompt: string
	tools: readonly Tool[]
	cwd: string
	resumeMessages?: Message[]
}

export async function startRepl(options: ReplOptions): Promise<void> {
	let { model } = options
	const { provider, systemPrompt, tools, cwd } = options
	let messages: Message[] = options.resumeMessages ?? []
	const sessionId = generateSessionId()
	let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
	let totalCost = 0
	let isProcessing = false
	const sessionReadFiles = new Set<string>()

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: chalk.green("❯ "),
		terminal: true,
	})

	// ─── 欢迎信息 ───
	console.log()
	console.log(
		`${chalk.bold.cyan("AI Shell")} ${chalk.dim("v0.1.0")} ${chalk.dim(`(${provider.name}/${model})`)}`,
	)
	console.log(
		chalk.dim(`Session: ${sessionId} | /help for commands | Ctrl+C to interrupt`),
	)
	console.log(chalk.dim("─".repeat(60)))
	console.log()

	rl.prompt()

	rl.on("line", async (line: string) => {
		const input = line.trim()
		if (!input) {
			rl.prompt()
			return
		}

		// ─── Slash 命令 ───
		if (isCommand(input)) {
			const result = await executeCommand(input, {
				messages,
				model,
				provider,
				usage: totalUsage,
				cost: totalCost,
				cwd,
			})

			console.log(result.output)
			if (result.newMessages !== undefined) {
				messages = result.newMessages
			}
			if (result.newModel) {
				model = result.newModel
				console.log(chalk.dim(`Model switched to ${model}`))
			}
			if (result.exit) {
				rl.close()
				return
			}
			console.log()
			rl.prompt()
			return
		}

		// ─── AI 对话 ───
		isProcessing = true
		const userMessage: Message = { role: "user", content: input }
		messages.push(userMessage)

		// 自动压缩
		try {
			const compactResult = await autoCompact(messages, model, provider)
			if (compactResult) {
				messages = compactResult.messages
				console.log(
					chalk.dim(
						`  ↻ context compacted: ${compactResult.beforeTokens} → ${compactResult.afterTokens} tokens`,
					),
				)
			}
		} catch {
			// 忽略
		}

		// 创建 AbortController
		const abortController = new AbortController()
		const sigintHandler = () => {
			abortController.abort("user-cancel")
			process.stdout.write(chalk.yellow("\n  ■ interrupted\n"))
			isProcessing = false
			rl.prompt()
		}
		process.once("SIGINT", sigintHandler)

		try {
			const events = query({
				provider,
				model,
				systemPrompt,
				messages,
				tools,
				toolContext: { cwd, readFiles: sessionReadFiles },
				abortSignal: abortController.signal,
			})

			let streamedLines = 0 // 追踪已输出的行数（用于清屏重绘）
			let fullResponseText = ""
			let currentSegmentText = "" // 当前文本段（工具调用之间的文本）
			const toolTimers = new Map<string, number>()
			console.log() // 空行分隔

			for await (const event of events) {
				if (abortController.signal.aborted) break

				switch (event.type) {
					case "text":
						// 流式逐字符输出（原始文本，后续替换为 markdown）
						process.stdout.write(event.text)
						currentSegmentText += event.text
						fullResponseText += event.text
						// 统计行数
						const newlines = (event.text.match(/\n/g) ?? []).length
						streamedLines += newlines
						break

					case "thinking":
						if (!currentSegmentText) {
							process.stdout.write(chalk.dim("  thinking...\r"))
						}
						break

					case "tool_start": {
						// 文本段结束 → 清除原始文本，替换为 markdown 渲染版本
						if (currentSegmentText) {
							clearLines(streamedLines + 1)
							const rendered = renderMarkdown(currentSegmentText).trimEnd()
							console.log(rendered)
							currentSegmentText = ""
							streamedLines = 0
						}
						toolTimers.set(event.toolId, Date.now())

						const desc = formatToolDesc(event.toolName, event.input)
						process.stdout.write(
							`${chalk.cyan("  ⚡")} ${chalk.cyan(event.toolName)} ${chalk.dim(desc)} `,
						)
						break
					}

					case "tool_end": {
						const start = toolTimers.get(event.toolId) ?? Date.now()
						const ms = Date.now() - start
						toolTimers.delete(event.toolId)

						if (event.result.isError) {
							console.log(chalk.red(`✗ ${ms}ms`))
							const preview = event.result.content.split("\n")[0].slice(0, 120)
							console.log(chalk.red(`    ${preview}`))
						} else {
							console.log(chalk.green(`✓ ${ms}ms`))
						}
						break
					}

					case "done": {
						messages = event.messages
						totalUsage = {
							inputTokens: totalUsage.inputTokens + event.usage.inputTokens,
							outputTokens: totalUsage.outputTokens + event.usage.outputTokens,
						}
						const ic = (event.usage.inputTokens / 1_000_000) * 3
						const oc = (event.usage.outputTokens / 1_000_000) * 15
						totalCost += ic + oc

						// 最后一段文本 → markdown 渲染替换
						if (currentSegmentText) {
							clearLines(streamedLines + 1)
							const rendered = renderMarkdown(currentSegmentText).trimEnd()
							console.log(rendered)
							currentSegmentText = ""
							streamedLines = 0
						}

						// 状态栏
						console.log(
							chalk.dim(
								`\n  ${model} · ${event.usage.inputTokens}↑ ${event.usage.outputTokens}↓ · $${totalCost.toFixed(4)}`,
							),
						)
						break
					}

					case "error":
						console.error(chalk.red(`\n  Error: ${event.error.message}`))
						break
				}
			}

			// 自动保存
			saveSession(sessionId, messages).catch(() => {})
		} catch (error) {
			if (!abortController.signal.aborted) {
				console.error(chalk.red(`  Error: ${(error as Error).message}`))
			}
		} finally {
			process.removeListener("SIGINT", sigintHandler)
			isProcessing = false
		}

		console.log()
		rl.prompt()
	})

	rl.on("close", () => {
		console.log(chalk.dim("\nGoodbye!"))
		process.exit(0)
	})

	// SIGINT 在非处理状态时退出
	process.on("SIGINT", () => {
		if (!isProcessing) {
			console.log(chalk.dim("\nGoodbye!"))
			process.exit(0)
		}
	})

	return new Promise(() => {})
}

// ─── 工具描述格式化 ───

function formatToolDesc(
	name: string,
	input: Record<string, unknown>,
): string {
	switch (name) {
		case "Bash": {
			const cmd = String(input.command ?? "")
			return cmd.length > 80 ? `${cmd.slice(0, 80)}...` : cmd
		}
		case "Read":
			return String(input.file_path ?? "")
		case "Write": {
			const content = String(input.content ?? "")
			return `${input.file_path} (${content.split("\n").length} lines)`
		}
		case "Edit": {
			const old = String(input.old_string ?? "").slice(0, 40)
			return `${input.file_path} "${old}${String(input.old_string ?? "").length > 40 ? "..." : ""}"`
		}
		case "Glob":
			return String(input.pattern ?? "")
		case "Grep":
			return `/${input.pattern ?? ""}/${input.glob ? ` ${input.glob}` : ""}`
		case "Agent":
			return String(input.description ?? String(input.prompt ?? "").slice(0, 60))
		default:
			return JSON.stringify(input).slice(0, 80)
	}
}

// ─── 终端清屏辅助 ───

/**
 * 清除终端中最近 n 行的输出。
 * 用于将流式原始文本替换为 markdown 渲染版本。
 */
function clearLines(n: number): void {
	if (n <= 0) return
	// 移动光标到第一行开头，然后清除到屏幕底部
	moveCursor(process.stdout, 0, -n)
	process.stdout.write("\x1b[0J")
}
