/**
 * FileRead 工具
 *
 * 读取文件内容，支持行号偏移和行数限制。
 * 输出格式模仿 `cat -n`，带行号方便 LLM 引用。
 */

import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"
import { buildTool } from "../core/tool"

const inputSchema = z.object({
	file_path: z.string().describe("The absolute path to the file to read"),
	offset: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe("The line number to start reading from (0-based)"),
	limit: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("The number of lines to read. Defaults to 2000"),
})

type Input = z.infer<typeof inputSchema>

const DEFAULT_LIMIT = 2000
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export const FileReadTool = buildTool<Input>({
	name: "Read",
	description:
		"Reads a file from the local filesystem. Returns content with line numbers (cat -n format).\n\n" +
		"Usage notes:\n" +
		"- The file_path must be an absolute path.\n" +
		"- By default reads up to 2000 lines from the start.\n" +
		"- For large files, use offset and limit to read specific portions.\n" +
		"- Results include line numbers for reference — do NOT copy these into Edit tool's old_string.\n" +
		"- You MUST read a file before editing it with the Edit tool.",
	inputSchema,

	isReadOnly: () => true,
	isConcurrencySafe: () => true,

	async call(input, context) {
		const filePath = resolve(context.cwd, input.file_path)
		const offset = input.offset ?? 0
		const limit = input.limit ?? DEFAULT_LIMIT

		try {
			// 检查文件大小
			const fileInfo = await stat(filePath)
			if (fileInfo.size > MAX_FILE_SIZE) {
				return {
					content: `File is too large (${(fileInfo.size / 1024 / 1024).toFixed(1)}MB). Maximum supported size is ${MAX_FILE_SIZE / 1024 / 1024}MB. Use offset and limit to read portions.`,
					isError: true,
				}
			}

			if (fileInfo.isDirectory()) {
				return {
					content: `${filePath} is a directory, not a file. Use the Bash tool with 'ls' to list directory contents.`,
					isError: true,
				}
			}

			const content = await readFile(filePath, "utf-8")
			const lines = content.split("\n")
			const selectedLines = lines.slice(offset, offset + limit)

			// 格式化为带行号的输出
			const numbered = selectedLines
				.map((line, i) => `${offset + i + 1}\t${line}`)
				.join("\n")

			let result = numbered
			if (offset + limit < lines.length) {
				result += `\n\n... (${lines.length - offset - limit} more lines)`
			}

			return { content: result }
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			if (err.code === "ENOENT") {
				return { content: `File not found: ${filePath}`, isError: true }
			}
			if (err.code === "EACCES") {
				return { content: `Permission denied: ${filePath}`, isError: true }
			}
			return {
				content: `Error reading file: ${err.message}`,
				isError: true,
			}
		}
	},

	renderToolUse(input) {
		let desc = `Read ${input.file_path}`
		if (input.offset) desc += ` (from line ${input.offset})`
		if (input.limit) desc += ` (${input.limit} lines)`
		return desc
	},

	renderToolResult(result) {
		if (result.isError) return result.content
		const lines = result.content.split("\n").length
		return `${lines} lines`
	},
})
