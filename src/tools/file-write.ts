/**
 * FileWrite 工具
 *
 * 将内容写入文件。参考 Claude Code 的安全设计：
 * - 如果文件已存在但本次会话未读取过，拒绝覆写（防止盲覆写）
 * - 新文件直接创建
 * - 自动创建中间目录
 */

import { writeFile, mkdir, stat } from "node:fs/promises"
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
		"overwrites if it does. Automatically creates parent directories.\n\n" +
		"IMPORTANT:\n" +
		"- You MUST use the Read tool first before overwriting an existing file.\n" +
		"- This tool will FAIL if the file exists but was not read in this session.\n" +
		"- For modifying existing files, prefer the Edit tool — it only sends the diff.\n" +
		"- Only use Write for creating NEW files or for complete rewrites after reading.",
	inputSchema,

	isDestructive: () => true,

	async call(input, context) {
		const filePath = resolve(context.cwd, input.file_path)

		try {
			// 安全检查：文件已存在但未读取过 → 拒绝盲覆写
			const exists = await stat(filePath)
				.then(() => true)
				.catch(() => false)

			if (exists && !context.readFiles.has(filePath)) {
				return {
					content:
						`File already exists: ${filePath}\n` +
						"You must read it first with the Read tool before overwriting.\n" +
						"This prevents accidentally destroying file content the model hasn't seen.\n" +
						"If you want to modify specific parts, use the Edit tool instead.",
					isError: true,
				}
			}

			// 确保目录存在
			await mkdir(dirname(filePath), { recursive: true })

			await writeFile(filePath, input.content, "utf-8")

			// 写入后也标记为已读（后续编辑不会再报错）
			context.readFiles.add(filePath)

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
