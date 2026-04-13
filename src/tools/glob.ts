/**
 * Glob 工具
 *
 * 文件模式匹配搜索。使用 fast-glob 风格的 pattern。
 */

import { glob as globFn } from "glob"
import { resolve } from "node:path"
import { z } from "zod"
import { buildTool } from "../core/tool"

const inputSchema = z.object({
	pattern: z
		.string()
		.describe('The glob pattern to match files (e.g. "**/*.ts", "src/**/*.tsx")'),
	path: z
		.string()
		.optional()
		.describe("The directory to search in. Defaults to current working directory"),
})

type Input = z.infer<typeof inputSchema>

const MAX_RESULTS = 500

export const GlobTool = buildTool<Input>({
	name: "Glob",
	description:
		"Fast file pattern matching. " +
		'Supports glob patterns like "**/*.js" or "src/**/*.ts". ' +
		"Returns matching file paths sorted by modification time.",
	inputSchema,

	isReadOnly: () => true,
	isConcurrencySafe: () => true,

	async call(input, context) {
		const searchPath = input.path
			? resolve(context.cwd, input.path)
			: context.cwd

		try {
			const matches = await globFn(input.pattern, {
				cwd: searchPath,
				ignore: ["**/node_modules/**", "**/.git/**"],
				nodir: true,
				absolute: false,
			})

			if (matches.length === 0) {
				return { content: "No files matched the pattern." }
			}

			const sorted = matches.sort()
			const truncated = sorted.slice(0, MAX_RESULTS)

			let content = truncated.join("\n")
			if (sorted.length > MAX_RESULTS) {
				content += `\n\n... and ${sorted.length - MAX_RESULTS} more files`
			}

			return { content }
		} catch (error) {
			return {
				content: `Error searching files: ${(error as Error).message}`,
				isError: true,
			}
		}
	},

	renderToolUse(input) {
		return `Glob: ${input.pattern}${input.path ? ` in ${input.path}` : ""}`
	},
})
