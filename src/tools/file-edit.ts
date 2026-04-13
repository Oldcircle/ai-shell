/**
 * FileEdit 工具
 *
 * 基于精确字符串匹配的文件编辑。参考 Claude Code 增强：
 * - 智能引号归一化（curly quotes → straight quotes）
 * - 更好的错误提示（显示最接近的匹配）
 * - 缩进保护（检测 tab/space 混用）
 */

import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"
import { buildTool } from "../core/tool"

const inputSchema = z.object({
	file_path: z.string().describe("The absolute path to the file to modify"),
	old_string: z.string().describe("The exact text to find and replace"),
	new_string: z
		.string()
		.describe("The text to replace old_string with (must be different from old_string)"),
	replace_all: z
		.boolean()
		.optional()
		.default(false)
		.describe(
			"Replace all occurrences (default: false). " +
				"Set to true only when you intend to rename a variable or replace every instance.",
		),
})

type Input = z.infer<typeof inputSchema>

// ─── 引号归一化 ───

const QUOTE_MAP: Record<string, string> = {
	"\u2018": "'", // '
	"\u2019": "'", // '
	"\u201C": '"', // "
	"\u201D": '"', // "
	"\u00AB": '"', // «
	"\u00BB": '"', // »
}

function normalizeQuotes(text: string): string {
	let result = text
	for (const [fancy, plain] of Object.entries(QUOTE_MAP)) {
		result = result.replaceAll(fancy, plain)
	}
	return result
}

// ─── 最近匹配查找（辅助错误提示）───

function findClosestMatch(
	content: string,
	target: string,
	maxDistance = 5,
): string | null {
	const targetLines = target.split("\n")
	const contentLines = content.split("\n")

	if (targetLines.length === 0) return null

	// 尝试匹配第一行
	const firstLine = targetLines[0].trim()
	if (!firstLine) return null

	for (let i = 0; i < contentLines.length; i++) {
		if (contentLines[i].trim() === firstLine) {
			// 找到首行匹配，检查后续行
			const snippet = contentLines
				.slice(i, i + targetLines.length)
				.join("\n")
			if (snippet !== target) {
				return `Found similar text at line ${i + 1}, but it doesn't match exactly. Check whitespace and indentation.`
			}
		}
	}

	// 检查引号差异
	const normalizedTarget = normalizeQuotes(target)
	if (normalizedTarget !== target && content.includes(normalizedTarget)) {
		return "The file uses straight quotes but old_string contains curly/smart quotes. Try with straight quotes."
	}

	// 检查 tab/space 差异
	if (target.includes("\t") && !content.includes("\t")) {
		return "old_string uses tabs but the file uses spaces for indentation."
	}
	if (!target.includes("\t") && content.includes("\t")) {
		return "old_string uses spaces but the file uses tabs for indentation."
	}

	return null
}

// ─── 工具实现 ───

export const FileEditTool = buildTool<Input>({
	name: "Edit",
	description:
		"Performs exact string replacements in files.\n\n" +
		"IMPORTANT rules:\n" +
		"- You MUST read the file with Read tool first before editing.\n" +
		"- old_string must match EXACTLY (including whitespace and indentation).\n" +
		"- old_string must be unique in the file (unless replace_all is true).\n" +
		"- If old_string is not unique, provide more surrounding context to make it unique.\n" +
		"- Prefer Edit over Write for modifying existing files — it only sends the diff.\n" +
		"- Never include line number prefixes in old_string (the Read tool shows line numbers for reference only).\n" +
		"- old_string and new_string must be different.",
	inputSchema,

	async call(input, context) {
		const filePath = resolve(context.cwd, input.file_path)

		if (input.old_string === input.new_string) {
			return {
				content:
					"old_string and new_string are identical. No changes needed.",
				isError: true,
			}
		}

		try {
			const content = await readFile(filePath, "utf-8")

			// 尝试直接匹配
			let searchString = input.old_string
			let occurrences = content.split(searchString).length - 1

			// 如果直接匹配失败，尝试引号归一化
			if (occurrences === 0) {
				const normalized = normalizeQuotes(input.old_string)
				if (normalized !== input.old_string) {
					const normalizedOccurrences =
						content.split(normalized).length - 1
					if (normalizedOccurrences > 0) {
						searchString = normalized
						occurrences = normalizedOccurrences
					}
				}
			}

			if (occurrences === 0) {
				// 提供有用的错误信息
				const hint = findClosestMatch(content, input.old_string)
				let msg = `old_string not found in ${filePath}.`
				msg +=
					"\nMake sure it matches exactly, including whitespace and indentation."
				msg +=
					"\nDo NOT include line number prefixes from Read output."
				if (hint) {
					msg += `\nHint: ${hint}`
				}
				return { content: msg, isError: true }
			}

			// 非 replace_all 模式下，old_string 必须唯一
			if (!input.replace_all && occurrences > 1) {
				return {
					content:
						`old_string found ${occurrences} times in ${filePath}. ` +
						"Provide more surrounding context to make it unique, " +
						"or set replace_all: true to replace all occurrences.",
					isError: true,
				}
			}

			// 执行替换
			let newContent: string
			if (input.replace_all) {
				newContent = content.replaceAll(searchString, input.new_string)
			} else {
				newContent = content.replace(searchString, input.new_string)
			}

			await writeFile(filePath, newContent, "utf-8")

			const replacements = input.replace_all ? occurrences : 1
			return {
				content: `Successfully replaced ${replacements} occurrence(s) in ${filePath}`,
			}
		} catch (error) {
			const err = error as NodeJS.ErrnoException
			if (err.code === "ENOENT") {
				return { content: `File not found: ${filePath}`, isError: true }
			}
			return {
				content: `Error editing file: ${err.message}`,
				isError: true,
			}
		}
	},

	renderToolUse(input) {
		const preview = input.old_string.slice(0, 50)
		return `Edit ${input.file_path}: "${preview}${input.old_string.length > 50 ? "..." : ""}"`
	},
})
