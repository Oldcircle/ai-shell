/**
 * Readline REPL — 终端交互模式
 *
 * 参考 Claude Code 完整 UX 细节实现：
 * - 上下文动词 spinner（Reading... / Running... / Writing...）
 * - thinking 耗时显示
 * - `!` 前缀直接执行 bash（不经过 LLM）
 * - 分类错误显示（API / rate limit / context / tool）
 * - 工具结果红绿 diff + 内容预览
 * - 流式 markdown 渲染（流式输出 → 完成后重绘）
 * - STDOUT/STDERR 分色显示
 */

import { createInterface, moveCursor } from "node:readline"
import { execSync } from "node:child_process"
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

// ─── Spinner 动词 ───

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
let spinnerInterval: ReturnType<typeof setInterval> | null = null
let spinnerFrame = 0

function startSpinner(label: string): void {
	stopSpinner()
	spinnerFrame = 0
	spinnerInterval = setInterval(() => {
		spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length
		process.stdout.write(`\r${chalk.dim(`${SPINNER_FRAMES[spinnerFrame]} ${label}`)}`)
	}, 80)
}

function updateSpinner(label: string): void {
	// 只更新文字，不重启定时器
	if (spinnerInterval) {
		process.stdout.write(`\r\x1b[2K${chalk.dim(`${SPINNER_FRAMES[spinnerFrame]} ${label}`)}`)
	}
}

function stopSpinner(): void {
	if (spinnerInterval) {
		clearInterval(spinnerInterval)
		spinnerInterval = null
		process.stdout.write("\r\x1b[2K") // 清除 spinner 行
	}
}

// ─── 主 REPL ───

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

	// ─── 欢迎信息（参考 Claude Code LogoV2）───
	const termWidth = Math.max(process.stdout.columns ?? 80, 40)
	const separator = chalk.dim("─".repeat(Math.min(termWidth - 2, 60)))

	console.log()
	console.log(`  ${chalk.bold.cyan("⚡ AI Shell")} ${chalk.dim("v0.1.0")}`)
	console.log(`  ${separator}`)
	console.log(`  ${chalk.dim("Model:")}   ${model}`)
	console.log(`  ${chalk.dim("Provider:")} ${provider.name}`)
	console.log(`  ${chalk.dim("CWD:")}     ${cwd}`)
	console.log(`  ${chalk.dim("Session:")}  ${sessionId}`)
	console.log(`  ${separator}`)
	console.log(`  ${chalk.dim("Type /help for commands · ! for bash · Ctrl+C to interrupt")}`)
	console.log()

	rl.prompt()

	rl.on("line", async (line: string) => {
		const input = line.trim()
		if (!input) {
			rl.prompt()
			return
		}

		// ─── ! 前缀直接执行 bash（不经过 LLM）───
		if (input.startsWith("!") && input.length > 1) {
			const cmd = input.slice(1).trim()
			console.log(chalk.dim(`  $ ${cmd}`))
			try {
				const output = execSync(cmd, {
					cwd,
					stdio: ["ignore", "pipe", "pipe"],
					timeout: 30_000,
					env: { ...process.env, TERM: "dumb" },
				}).toString()
				if (output.trim()) {
					console.log(output.trimEnd())
				}
			} catch (error) {
				const err = error as { stderr?: Buffer; stdout?: Buffer; status?: number }
				if (err.stderr?.length) {
					console.error(chalk.red(err.stderr.toString().trimEnd()))
				}
				if (err.stdout?.length) {
					console.log(err.stdout.toString().trimEnd())
				}
				if (err.status) {
					console.log(chalk.dim(`  exit code: ${err.status}`))
				}
			}
			console.log()
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
						`  ↻ compacted: ${compactResult.beforeTokens} → ${compactResult.afterTokens} tokens`,
					),
				)
			}
		} catch {
			// 忽略
		}

		const abortController = new AbortController()
		const sigintHandler = () => {
			abortController.abort("user-cancel")
			stopSpinner()
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

			let streamedLines = 0
			let currentSegmentText = ""
			const toolTimers = new Map<string, number>()
			let thinkingStart = 0
			console.log()

			startSpinner("Thinking...")

			for await (const event of events) {
				if (abortController.signal.aborted) break

				switch (event.type) {
					case "text":
						stopSpinner()
						process.stdout.write(event.text)
						currentSegmentText += event.text
						streamedLines += (event.text.match(/\n/g) ?? []).length
						break

					case "thinking":
						if (!thinkingStart) thinkingStart = Date.now()
						updateSpinner("Thinking...")
						break

					case "tool_start": {
						// 如果有 thinking，显示耗时
						if (thinkingStart) {
							stopSpinner()
							const dur = ((Date.now() - thinkingStart) / 1000).toFixed(1)
							console.log(chalk.dim(`  Thinking (${dur}s)`))
							thinkingStart = 0
						}

						// 文本段 → markdown 渲染
						if (currentSegmentText) {
							stopSpinner()
							clearLines(streamedLines + 1)
							console.log(renderMarkdown(currentSegmentText).trimEnd())
							currentSegmentText = ""
							streamedLines = 0
						}

						toolTimers.set(event.toolId, Date.now())
						const desc = formatToolDesc(event.toolName, event.input)

						// 上下文动词 spinner
						const verb = getToolVerb(event.toolName)
						startSpinner(`${verb} ${event.toolName}`)

						// 工具调用行
						stopSpinner()
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
							renderError(event.result.content)
						} else {
							console.log(chalk.green(`✓ ${ms}ms`))
						}

						renderToolDetail(event.toolName, event.input, event.result.content, event.result.isError ?? false)

						// 如果还有更多工具要执行，启动新 spinner
						if (toolTimers.size > 0) {
							startSpinner("Running...")
						}
						break
					}

					case "done": {
						stopSpinner()
						messages = event.messages
						totalUsage = {
							inputTokens: totalUsage.inputTokens + event.usage.inputTokens,
							outputTokens: totalUsage.outputTokens + event.usage.outputTokens,
						}
						const ic = (event.usage.inputTokens / 1_000_000) * 3
						const oc = (event.usage.outputTokens / 1_000_000) * 15
						totalCost += ic + oc

						// thinking 耗时（如果还没显示）
						if (thinkingStart) {
							const dur = ((Date.now() - thinkingStart) / 1000).toFixed(1)
							console.log(chalk.dim(`  Thinking (${dur}s)`))
							thinkingStart = 0
						}

						// 最后一段文本 → markdown 渲染
						if (currentSegmentText) {
							clearLines(streamedLines + 1)
							console.log(renderMarkdown(currentSegmentText).trimEnd())
							currentSegmentText = ""
							streamedLines = 0
						}

						// 状态栏
						console.log(
							chalk.dim(
								`\n  ${model} · ${fmtTokens(event.usage.inputTokens)}↑ ${fmtTokens(event.usage.outputTokens)}↓ · $${totalCost.toFixed(4)}`,
							),
						)
						break
					}

					case "error": {
						stopSpinner()
						renderApiError(event.error)
						break
					}
				}
			}

			saveSession(sessionId, messages).catch(() => {})
		} catch (error) {
			stopSpinner()
			if (!abortController.signal.aborted) {
				renderApiError(error as Error)
			}
		} finally {
			stopSpinner()
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

	process.on("SIGINT", () => {
		if (!isProcessing) {
			console.log(chalk.dim("\nGoodbye!"))
			process.exit(0)
		}
	})

	return new Promise(() => {})
}

// ─── 工具上下文动词 ───

function getToolVerb(toolName: string): string {
	switch (toolName) {
		case "Read": return "Reading"
		case "Write": return "Writing"
		case "Edit": return "Editing"
		case "Bash": return "Running"
		case "Glob": return "Searching"
		case "Grep": return "Searching"
		case "Agent": return "Spawning"
		default: return "Running"
	}
}

// ─── Token 格式化 ───

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}

// ─── 分类错误显示 ───

function renderApiError(error: Error): void {
	const msg = error.message.toLowerCase()

	if (msg.includes("429") || msg.includes("rate limit")) {
		console.error(chalk.yellow(`\n  ⚠ Rate limit exceeded`))
		console.error(chalk.yellow(`    ${error.message}`))
		console.error(chalk.dim("    Wait a moment and try again."))
	} else if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("api key")) {
		console.error(chalk.red(`\n  ✗ Invalid API key`))
		console.error(chalk.dim("    Check your ANTHROPIC_API_KEY or DEEPSEEK_API_KEY."))
	} else if (msg.includes("context") || msg.includes("too long") || msg.includes("max_tokens")) {
		console.error(chalk.yellow(`\n  ⚠ Context limit reached`))
		console.error(chalk.dim("    Use /compact to compress conversation, or /clear to reset."))
	} else if (msg.includes("timeout") || msg.includes("etimedout")) {
		console.error(chalk.yellow(`\n  ⚠ Request timed out`))
		console.error(chalk.dim("    The API took too long to respond. Try again."))
	} else if (msg.includes("econnrefused") || msg.includes("fetch failed")) {
		console.error(chalk.red(`\n  ✗ Connection failed`))
		console.error(chalk.dim("    Cannot reach the API. Check your network and API endpoint."))
	} else {
		console.error(chalk.red(`\n  ✗ Error: ${error.message}`))
	}
}

function renderError(content: string): void {
	const lines = content.split("\n")
	const preview = lines.slice(0, 3)
	for (const line of preview) {
		console.log(chalk.red(`    ${line}`))
	}
	if (lines.length > 3) {
		console.log(chalk.dim(`    ... (${lines.length} lines)`))
	}
}

// ─── 工具描述格式化 ───

function formatToolDesc(name: string, input: Record<string, unknown>): string {
	switch (name) {
		case "Bash": {
			const cmd = String(input.command ?? "")
			const desc = input.description ? String(input.description) : null
			if (desc) return desc
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

// ─── 工具结果详情渲染 ───

function renderToolDetail(
	toolName: string,
	input: Record<string, unknown>,
	content: string,
	isError: boolean,
): void {
	if (isError) return

	switch (toolName) {
		case "Edit": {
			const oldStr = String(input.old_string ?? "")
			const newStr = String(input.new_string ?? "")
			if (oldStr && newStr) {
				const oldLines = oldStr.split("\n")
				const newLines = newStr.split("\n")
				console.log(chalk.dim("    ┌─ diff ─"))
				for (const line of oldLines.slice(0, 12)) {
					console.log(chalk.red(`    │ - ${line}`))
				}
				if (oldLines.length > 12) console.log(chalk.dim(`    │   ... +${oldLines.length - 12} lines`))
				for (const line of newLines.slice(0, 12)) {
					console.log(chalk.green(`    │ + ${line}`))
				}
				if (newLines.length > 12) console.log(chalk.dim(`    │   ... +${newLines.length - 12} lines`))
				console.log(chalk.dim("    └─"))
			}
			break
		}
		case "Write": {
			const fileContent = String(input.content ?? "")
			const lines = fileContent.split("\n")
			console.log(chalk.dim(`    ┌─ ${lines.length} lines written ─`))
			for (const line of lines.slice(0, 8)) {
				console.log(chalk.dim("    │ ") + line)
			}
			if (lines.length > 8) console.log(chalk.dim(`    │ ... +${lines.length - 8} more lines`))
			console.log(chalk.dim("    └─"))
			break
		}
		case "Bash": {
			if (content && content !== "(no output)") {
				const lines = content.split("\n")
				for (const line of lines.slice(0, 6)) {
					console.log(chalk.dim(`    ${line}`))
				}
				if (lines.length > 6) console.log(chalk.dim(`    ... (${lines.length} lines total)`))
			}
			break
		}
		case "Read":
			console.log(chalk.dim(`    ${content.split("\n").length} lines`))
			break
		case "Grep": {
			const matches = content.split("\n").filter(Boolean)
			if (matches.length > 0 && content !== "No matches found.") {
				console.log(chalk.dim(`    ${matches.length} matches`))
			}
			break
		}
		case "Glob": {
			const files = content.split("\n").filter(Boolean)
			if (files.length > 0 && content !== "No files matched the pattern.") {
				console.log(chalk.dim(`    ${files.length} files`))
			}
			break
		}
	}
}

// ─── 终端清屏辅助 ───

function clearLines(n: number): void {
	if (n <= 0) return
	moveCursor(process.stdout, 0, -n)
	process.stdout.write("\x1b[0J")
}
