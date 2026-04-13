/**
 * Bash 工具
 *
 * 参考 Claude Code 完整实现：
 * - 前台执行（默认）：等待命令完成，返回输出
 * - 后台执行（run_in_background）：立即返回，进程继续运行
 * - 长驻进程检测：自动警告 dev server 类命令
 * - 超时控制 + 输出限制 + 危险命令检测
 */

import { spawn, type ChildProcess } from "node:child_process"
import { writeFile, readFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { z } from "zod"
import { buildTool } from "../core/tool"

const inputSchema = z.object({
	command: z.string().describe("The bash command to execute"),
	description: z
		.string()
		.optional()
		.describe(
			"Clear, concise description of what this command does. " +
				"For simple commands: 5-10 words. " +
				'For complex commands: enough to clarify intent.',
		),
	timeout: z
		.number()
		.optional()
		.describe("Timeout in milliseconds (default: 120000, max: 600000)"),
	run_in_background: z
		.boolean()
		.optional()
		.describe(
			"Set to true to run in the background. The command starts immediately and " +
				"you get a task ID back. Use this for dev servers, long builds, or any " +
				"command that runs indefinitely. You will be notified when it completes.",
		),
})

type Input = z.infer<typeof inputSchema>

const DEFAULT_TIMEOUT = 120_000
const MAX_TIMEOUT = 600_000
const MAX_OUTPUT_SIZE = 1024 * 1024

// ─── 后台任务管理 ───

interface BackgroundTask {
	id: string
	command: string
	pid: number
	process: ChildProcess
	outputFile: string
	startTime: number
}

const backgroundTasks = new Map<string, BackgroundTask>()
let taskCounter = 0

function generateTaskId(): string {
	return `bg-${++taskCounter}`
}

/** 获取后台任务列表（供命令系统使用）*/
export function getBackgroundTasks(): Array<{
	id: string
	command: string
	pid: number
	running: boolean
	durationMs: number
}> {
	return Array.from(backgroundTasks.values()).map((t) => ({
		id: t.id,
		command: t.command.slice(0, 80),
		pid: t.pid,
		running: !t.process.killed && t.process.exitCode === null,
		durationMs: Date.now() - t.startTime,
	}))
}

/** 杀掉后台任务 */
export function killBackgroundTask(taskId: string): boolean {
	const task = backgroundTasks.get(taskId)
	if (!task) return false
	task.process.kill("SIGTERM")
	setTimeout(() => {
		if (!task.process.killed) task.process.kill("SIGKILL")
	}, 3000)
	backgroundTasks.delete(taskId)
	return true
}

// ─── 长驻进程检测 ───

const SERVER_PATTERNS = [
	/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve)\b/,
	/\bnext\s+dev\b/,
	/\bvite\b(?!\s+(build|preview))/,
	/\bwebpack\s+serve\b/,
	/\bnode\s+.*server/i,
	/\btail\s+-f\b/,
	/\bwatch\b/,
	/\bnodemon\b/,
	/\bpython\s+-m\s+http\.server\b/,
	/\bhttp-server\b/,
	/\blive-server\b/,
	/\bflask\s+run\b/,
	/\buvicorn\b/,
	/\bgunicorn\b/,
	/\brails\s+s(erver)?\b/,
	/\bcargo\s+(run|watch)\b/,
]

function isLikelyServer(command: string): boolean {
	return SERVER_PATTERNS.some((p) => p.test(command))
}

// ─── 危险命令检测 ───

const DESTRUCTIVE_PATTERNS = [
	/\brm\s+(-[a-zA-Z]*r|-[a-zA-Z]*f|--recursive|--force)/,
	/\bgit\s+(push\s+--force|reset\s+--hard|checkout\s+--\s|clean\s+-f|branch\s+-D)/,
	/\bgit\s+push\s+.*\b(main|master)\b/,
	/\bdropdb\b/,
	/\bdrop\s+(table|database)\b/i,
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
	/\bmkfs\b/,
	/\bdd\s+if=/,
	/>\s*\/dev\/(sd|hd|nvme)/,
	/\bkill\s+-9\b/,
	/\bpkill\b/,
	/\bsudo\s/,
]

function isDestructiveCommand(command: string): boolean {
	return DESTRUCTIVE_PATTERNS.some((p) => p.test(command))
}

// ─── 工具实现 ───

export const BashTool = buildTool<Input>({
	name: "Bash",
	description:
		"Executes a bash command in a child process and returns its output.\n\n" +
		"IMPORTANT guidelines:\n" +
		"- The working directory persists between commands.\n" +
		"- Always quote file paths with spaces using double quotes.\n" +
		"- Do NOT use bash for tasks that have dedicated tools:\n" +
		"  - Read files: use Read (not cat/head/tail)\n" +
		"  - Edit files: use Edit (not sed/awk)\n" +
		"  - Search files: use Glob (not find/ls)\n" +
		"  - Search content: use Grep (not grep/rg)\n" +
		"- For git commands: prefer new commits over amending. Never --force or --no-verify.\n" +
		"- Commands timeout after 2 minutes by default (max 10 minutes).\n" +
		"- Output is capped at 1MB.\n\n" +
		"BACKGROUND MODE:\n" +
		"- Use `run_in_background: true` for dev servers, long builds, or any command that runs indefinitely.\n" +
		"- Background commands return immediately with a task ID.\n" +
		"- Do NOT run dev servers (npm run dev, pnpm dev, vite, etc.) without run_in_background — they will hang.\n" +
		"- Do NOT use sleep loops to poll — you will be notified when background tasks complete.",
	inputSchema,

	isDestructive: () => true,

	async checkPermissions(input: Input) {
		if (isDestructiveCommand(input.command)) {
			return {
				behavior: "ask" as const,
				message: `Potentially destructive command detected: ${input.command.slice(0, 100)}`,
			}
		}
		return { behavior: "allow" as const }
	},

	async call(input, context) {
		// ─── 长驻进程自动检测 ───
		if (isLikelyServer(input.command) && !input.run_in_background) {
			return {
				content:
					`This command looks like a dev server or long-running process: "${input.command.slice(0, 80)}"\n` +
					"It will run indefinitely and block the conversation.\n\n" +
					"Please re-run with run_in_background: true to start it in the background.\n" +
					"Example: Bash({ command: \"...\", run_in_background: true })",
				isError: true,
			}
		}

		// ─── 后台执行 ───
		if (input.run_in_background) {
			return runInBackground(input.command, context.cwd)
		}

		// ─── 前台执行 ───
		const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

		return new Promise<{ content: string; isError?: boolean }>((resolve) => {
			const proc = spawn("bash", ["-c", input.command], {
				cwd: context.cwd,
				env: {
					...process.env,
					TERM: "dumb",
					GIT_TERMINAL_PROMPT: "0",
					CI: "true",
				},
				stdio: ["ignore", "pipe", "pipe"],
				timeout,
			})

			let stdout = ""
			let stderr = ""
			let outputSize = 0
			let truncated = false

			proc.stdout.on("data", (chunk: Buffer) => {
				const text = chunk.toString()
				outputSize += text.length
				if (outputSize <= MAX_OUTPUT_SIZE) {
					stdout += text
				} else {
					truncated = true
				}
			})

			proc.stderr.on("data", (chunk: Buffer) => {
				const text = chunk.toString()
				outputSize += text.length
				if (outputSize <= MAX_OUTPUT_SIZE) {
					stderr += text
				} else {
					truncated = true
				}
			})

			proc.on("close", (code) => {
				let content = ""
				if (stdout) content += stdout
				if (stderr) content += (content ? "\n" : "") + stderr
				if (!content) content = "(no output)"

				if (truncated) {
					content += "\n\n... (output truncated, exceeded 1MB limit)"
				}

				if (code !== 0 && code !== null) {
					content = `Exit code: ${code}\n${content}`
				}

				resolve({
					content,
					isError: code !== 0 && code !== null,
				})
			})

			proc.on("error", (error) => {
				resolve({
					content: `Failed to execute command: ${error.message}`,
					isError: true,
				})
			})
		})
	},

	renderToolUse(input) {
		const bg = input.run_in_background ? " (background)" : ""
		const desc = input.description ?? input.command.slice(0, 100)
		return `$ ${desc}${bg}`
	},

	renderToolResult(result) {
		if (result.isError) {
			const lines = result.content.split("\n")
			return lines.slice(0, 5).join("\n")
		}
		const lines = result.content.split("\n")
		if (lines.length <= 3) return result.content
		return `${lines.slice(0, 3).join("\n")}\n... (${lines.length} lines)`
	},
})

// ─── 后台执行实现 ───

async function runInBackground(
	command: string,
	cwd: string,
): Promise<{ content: string; isError?: boolean }> {
	const taskId = generateTaskId()
	const outputDir = join(tmpdir(), "ai-shell-bg")
	await mkdir(outputDir, { recursive: true })
	const outputFile = join(outputDir, `${taskId}.log`)

	// 创建空日志文件
	await writeFile(outputFile, "", "utf-8")

	const proc = spawn("bash", ["-c", command], {
		cwd,
		env: {
			...process.env,
			TERM: "dumb",
			GIT_TERMINAL_PROMPT: "0",
		},
		stdio: ["ignore", "pipe", "pipe"],
		detached: true, // 不随父进程退出
	})

	// 输出写入文件
	const { createWriteStream } = await import("node:fs")
	const logStream = createWriteStream(outputFile, { flags: "a" })
	proc.stdout.pipe(logStream)
	proc.stderr.pipe(logStream)

	const task: BackgroundTask = {
		id: taskId,
		command,
		pid: proc.pid ?? 0,
		process: proc,
		outputFile,
		startTime: Date.now(),
	}
	backgroundTasks.set(taskId, task)

	// 进程退出时清理
	proc.on("close", (code) => {
		logStream.end()
		// 保留任务信息供查询，但标记完成
	})

	// 不等待进程结束，立即返回
	proc.unref()

	// 等待 500ms 检查是否立即崩溃
	await new Promise((r) => setTimeout(r, 500))

	if (proc.exitCode !== null) {
		// 进程立即退出了
		const output = await readFile(outputFile, "utf-8")
		backgroundTasks.delete(taskId)
		return {
			content: `Background command exited immediately (code ${proc.exitCode}):\n${output.slice(0, 2000)}`,
			isError: proc.exitCode !== 0,
		}
	}

	return {
		content:
			`Background task started.\n` +
			`  Task ID: ${taskId}\n` +
			`  PID: ${proc.pid}\n` +
			`  Command: ${command.slice(0, 100)}\n` +
			`  Output: ${outputFile}\n\n` +
			`The process is running in the background. You can continue working.\n` +
			`To check output: Bash({ command: "tail -20 ${outputFile}" })\n` +
			`To stop: Bash({ command: "kill ${proc.pid}" })`,
	}
}
