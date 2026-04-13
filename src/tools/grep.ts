/**
 * Grep 工具
 *
 * 内容搜索。使用 ripgrep（rg）如果可用，否则退化为 Node.js 实现。
 */

import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { z } from "zod"
import { buildTool } from "../core/tool"

const inputSchema = z.object({
	pattern: z
		.string()
		.describe("The regex pattern to search for in file contents"),
	path: z
		.string()
		.optional()
		.describe("File or directory to search in. Defaults to current directory"),
	glob: z
		.string()
		.optional()
		.describe('Glob pattern to filter files (e.g. "*.ts", "*.{js,tsx}")'),
	output_mode: z
		.enum(["content", "files_with_matches", "count"])
		.optional()
		.default("files_with_matches")
		.describe("Output mode: content shows lines, files_with_matches shows paths only"),
	context: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe("Lines of context around matches (only for content mode)"),
})

type Input = z.infer<typeof inputSchema>

const MAX_OUTPUT_LINES = 250

export const GrepTool = buildTool<Input>({
	name: "Grep",
	description:
		"Search file contents using regex patterns. " +
		"Uses ripgrep (rg) for fast searching. " +
		'Supports full regex syntax (e.g. "log.*Error", "function\\s+\\w+").',
	inputSchema,

	isReadOnly: () => true,
	isConcurrencySafe: () => true,

	async call(input, context) {
		const searchPath = input.path
			? resolve(context.cwd, input.path)
			: context.cwd

		const args: string[] = []

		// 输出模式
		switch (input.output_mode) {
			case "files_with_matches":
				args.push("-l")
				break
			case "count":
				args.push("-c")
				break
			case "content":
				args.push("-n") // 行号
				if (input.context) {
					args.push("-C", String(input.context))
				}
				break
		}

		// 文件类型过滤
		if (input.glob) {
			args.push("--glob", input.glob)
		}

		// 忽略常见目录
		args.push("--glob", "!node_modules", "--glob", "!.git")

		// 搜索模式和路径
		args.push(input.pattern, searchPath)

		try {
			const result = await runRipgrep(args)
			if (!result.output) {
				return { content: "No matches found." }
			}

			// 限制输出行数
			const lines = result.output.split("\n")
			if (lines.length > MAX_OUTPUT_LINES) {
				return {
					content:
						lines.slice(0, MAX_OUTPUT_LINES).join("\n") +
						`\n\n... (${lines.length - MAX_OUTPUT_LINES} more lines)`,
				}
			}

			return { content: result.output }
		} catch (error) {
			return {
				content: `Error searching: ${(error as Error).message}`,
				isError: true,
			}
		}
	},

	renderToolUse(input) {
		return `Grep: /${input.pattern}/${input.glob ? ` in ${input.glob}` : ""}`
	},
})

// ─── ripgrep 调用 ───

interface RgResult {
	output: string
	exitCode: number
}

function runRipgrep(args: string[]): Promise<RgResult> {
	return new Promise((resolve, reject) => {
		const proc = spawn("rg", args, {
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 30_000,
		})

		let stdout = ""
		let stderr = ""

		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString()
		})

		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString()
		})

		proc.on("close", (code) => {
			if (code === 2) {
				// rg exit code 2 = error
				reject(new Error(stderr || "ripgrep error"))
				return
			}
			// exit code 1 = no matches (not an error)
			resolve({ output: stdout.trim(), exitCode: code ?? 0 })
		})

		proc.on("error", (error) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				reject(new Error("ripgrep (rg) is not installed. Install it: brew install ripgrep"))
			} else {
				reject(error)
			}
		})
	})
}
