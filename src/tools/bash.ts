/**
 * Bash 工具
 *
 * 在子进程中执行 shell 命令。参考 Claude Code 的安全设计：
 * - 超时控制（默认 2 分钟，最大 10 分钟）
 * - 输出大小限制（1MB）
 * - 危险命令检测与警告
 * - 工作目录持久化
 * - 非交互模式（不支持 stdin）
 */

import { spawn } from "node:child_process"
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
				'For complex commands: enough to clarify intent. E.g.: "List files" or "Find and delete all .tmp files recursively"',
		),
	timeout: z
		.number()
		.optional()
		.describe("Timeout in milliseconds (default: 120000, max: 600000)"),
	run_in_background: z
		.boolean()
		.optional()
		.describe("Set to true to run in background (output captured asynchronously)"),
})

type Input = z.infer<typeof inputSchema>

const DEFAULT_TIMEOUT = 120_000
const MAX_TIMEOUT = 600_000
const MAX_OUTPUT_SIZE = 1024 * 1024

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

const SEARCH_COMMANDS = new Set([
	"find",
	"grep",
	"rg",
	"ag",
	"fd",
	"locate",
	"which",
	"where",
	"type",
])

const READ_COMMANDS = new Set([
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"wc",
	"file",
	"stat",
])

function isDestructiveCommand(command: string): boolean {
	return DESTRUCTIVE_PATTERNS.some((p) => p.test(command))
}

function isDedicatedToolCommand(command: string): string | null {
	const firstWord = command.trim().split(/\s+/)[0]
	if (READ_COMMANDS.has(firstWord)) {
		return "Consider using the Read tool instead of " + firstWord
	}
	if (SEARCH_COMMANDS.has(firstWord) && firstWord !== "which" && firstWord !== "type") {
		return "Consider using Glob or Grep tools instead of " + firstWord
	}
	if (firstWord === "sed" || firstWord === "awk") {
		return "Consider using the Edit tool instead of " + firstWord
	}
	return null
}

// ─── 工具实现 ───

export const BashTool = buildTool<Input>({
	name: "Bash",
	description:
		"Executes a bash command in a child process and returns its output.\n\n" +
		"IMPORTANT guidelines:\n" +
		"- The working directory persists between commands. You don't need to cd back.\n" +
		"- Always quote file paths with spaces using double quotes.\n" +
		"- Prefer absolute paths to avoid ambiguity.\n" +
		"- Do NOT use bash for tasks that have dedicated tools:\n" +
		"  - Read files: use Read (not cat/head/tail)\n" +
		"  - Edit files: use Edit (not sed/awk)\n" +
		"  - Search files: use Glob (not find/ls)\n" +
		"  - Search content: use Grep (not grep/rg)\n" +
		"- For git commands:\n" +
		"  - Prefer new commits over amending\n" +
		"  - Never use --force or --no-verify unless explicitly asked\n" +
		"  - Never force-push to main/master\n" +
		"- Commands timeout after 2 minutes by default (max 10 minutes).\n" +
		"- Output is capped at 1MB.",
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
		const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

		// 检查是否应该用专用工具
		const suggestion = isDedicatedToolCommand(input.command)
		if (suggestion) {
			// 不阻塞，只是提示
		}

		return new Promise<{ content: string; isError?: boolean }>((resolve) => {
			const proc = spawn("bash", ["-c", input.command], {
				cwd: context.cwd,
				env: {
					...process.env,
					TERM: "dumb",
					// 禁止交互式提示
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
		const desc = input.description ?? input.command.slice(0, 100)
		return `$ ${desc}`
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
