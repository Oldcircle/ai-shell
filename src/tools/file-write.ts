/**
 * FileWrite 工具
 *
 * 将内容写入文件。如果文件不存在则创建，如果存在则覆盖。
 * 自动创建中间目录。
 */

import { writeFile, mkdir } from "node:fs/promises"
import { resolve, dirname } from "node:path"
import { z } from "zod"
import { buildTool } from "../core/tool"

const inputSchema = z.object({
	file_path: z.string().describe("The absolute path to the file to write"),
	content: z.string().describe("The content to write to the file"),
})

type Input = z.infer<typeof inputSchema>

export const FileWriteTool = buildTool<Input>({
	name: "Write",
	description:
		"Writes content to a file. Creates the file if it doesn't exist, " +
		"overwrites if it does. Automatically creates parent directories.",
	inputSchema,

	isDestructive: () => true,

	async call(input, context) {
		const filePath = resolve(context.cwd, input.file_path)

		try {
			// 确保目录存在
			await mkdir(dirname(filePath), { recursive: true })

			await writeFile(filePath, input.content, "utf-8")

			return {
				content: `File written successfully: ${filePath}`,
			}
		} catch (error) {
			return {
				content: `Error writing file: ${(error as Error).message}`,
				isError: true,
			}
		}
	},

	renderToolUse(input) {
		return `Write ${input.file_path} (${input.content.split("\n").length} lines)`
	},
})
