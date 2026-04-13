/**
 * Grep 工具
 *
 * 参考 Claude Code 完整参数支持：
 * - 三种输出模式：content / files_with_matches / count
 * - 大小写控制 (-i)
 * - 上下文行 (-A/-B/-C)
 * - 结果分页 (head_limit / offset)
 * - 多行模式 (multiline)
 * - 文件类型过滤 (type)
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
	type: z
		.string()
		.optional()
		.describe('File type to search (e.g. "js", "py", "rust"). More efficient than glob.'),
	output_mode: z
		.enum(["content", "files_with_matches", "count"])
		.optional()
		.default("files_with_matches")
		.describe(
			'Output mode: "content" shows matching lines with context, ' +
				'"files_with_matches" shows only file paths (default), ' +
				'"count" shows match counts per file.',
		),
	"-i": z
		.boolean()
		.optional()
		.describe("Case insensitive search"),
	"-A": z
		.number()
		.optional()
		.describe("Number of lines to show AFTER each match (content mode only)"),
	"-B": z
		.number()
		.optional()
		.describe("Number of lines to show BEFORE each match (content mode only)"),
	"-C": z
		.number()
		.optional()
		.describe("Number of context lines before AND after (alias for -A and -B)"),
	context: z
		.number()
		.optional()
		.describe("Alias for -C"),
	head_limit: z
		.number()
		.optional()
		.describe(
			"Limit output to first N lines/entries. Defaults to 250. Pass 0 for unlimited (use sparingly).",
		),
	offset: z
		.number()
		.optional()
		.describe("Skip first N lines/entries before applying head_limit"),
	multiline: z
		.boolean()
		.optional()
		.describe("Enable multiline mode where patterns can span lines (rg -U)"),
})

type Input = z.infer<typeof inputSchema>

const DEFAULT_HEAD_LIMIT = 250

export const GrepTool = buildTool<Input>({
	name: "Grep",
	description:
		"Search file contents using regex patterns. Uses ripgrep (rg) for fast searching.\n\n" +
		"Usage:\n" +
		'- Supports full regex syntax (e.g. "log.*Error", "function\\\\s+\\\\w+")\n' +
		'- Filter files with glob (e.g. "*.ts") or type (e.g. "js", "py")\n' +
		'- Output modes: "content" (matching lines), "files_with_matches" (paths only, default), "count" (match counts)\n' +
		"- Use -i for case insensitive, -A/-B/-C for context lines\n" +
		"- Default limit is 250 results. Pass head_limit: 0 for unlimited.\n" +
		'- For multiline patterns, use multiline: true (e.g. "struct \\\\{[\\\\s\\\\S]*?field")',
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
				break
		}

		// 大小写
		if (input["-i"]) {
			args.push("-i")
		}

		// 上下文行（仅 content 模式）
		if (input.output_mode === "content") {
			const contextLines = input["-C"] ?? input.context
			if (contextLines !== undefined) {
				args.push("-C", String(contextLines))
			} else {
				if (input["-A"] !== undefined) args.push("-A", String(input["-A"]))
				if (input["-B"] !== undefined) args.push("-B", String(input["-B"]))
			}
		}

		// 多行模式
		if (input.multiline) {
			args.push("-U", "--multiline-dotall")
		}

		// 文件类型过滤
		if (input.type) {
			args.push("--type", input.type)
		}
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

			// 分页处理
			let lines = result.output.split("\n")
			const offset = input.offset ?? 0
			const headLimit = input.head_limit ?? DEFAULT_HEAD_LIMIT

			if (offset > 0) {
				lines = lines.slice(offset)
			}

			if (headLimit > 0 && lines.length > headLimit) {
				const total = lines.length
				lines = lines.slice(0, headLimit)
				return {
					content:
						lines.join("\n") +
						`\n\n... (${total - headLimit} more results. Use offset: ${offset + headLimit} to see next page.)`,
				}
			}

			return { content: lines.join("\n") }
		} catch (error) {
			return {
				content: `Error searching: ${(error as Error).message}`,
				isError: true,
			}
		}
	},

	renderToolUse(input) {
		const flags: string[] = []
		if (input["-i"]) flags.push("-i")
		if (input.multiline) flags.push("-U")
		const flagStr = flags.length > 0 ? ` ${flags.join(" ")}` : ""
		return `Grep: /${input.pattern}/${flagStr}${input.glob ? ` in ${input.glob}` : ""}`
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
				reject(new Error(stderr || "ripgrep error"))
				return
			}
			resolve({ output: stdout.trim(), exitCode: code ?? 0 })
		})

		proc.on("error", (error) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				reject(
					new Error(
						"ripgrep (rg) is not installed. Install it: brew install ripgrep",
					),
				)
			} else {
				reject(error)
			}
		})
	})
}
