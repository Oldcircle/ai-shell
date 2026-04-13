/**
 * AgentTool — 子 Agent
 *
 * 在独立的消息流中启动子 Agent 执行任务。
 * 参考 Claude Code：同进程内运行独立 query loop，共享工具但隔离消息。
 *
 * 用途：
 * - 并行研究多个问题
 * - 将复杂任务分解为独立子任务
 * - 沙箱式探索（不影响主对话）
 */

import { z } from "zod"
import { buildTool, type ToolUseContext } from "../core/tool"
import type { Tool } from "../core/tool"
import type { Provider } from "../providers/types"
import { query } from "../query"
import type { Message } from "../core/message"

const inputSchema = z.object({
	prompt: z.string().describe(
		"The task for the sub-agent to perform. Be specific and self-contained — " +
		"the agent starts with no context from the current conversation.",
	),
	description: z
		.string()
		.optional()
		.describe("A short description of what this agent will do"),
})

type Input = z.infer<typeof inputSchema>

/** 创建 AgentTool 需要注入 provider 和 tools */
export function createAgentTool(
	provider: Provider,
	model: string,
	tools: readonly Tool[],
): Tool {
	return buildTool<Input>({
		name: "Agent",
		description:
			"Launch a sub-agent to handle a task independently. " +
			"The agent runs in its own conversation with access to the same tools. " +
			"Use this for parallel research, complex sub-tasks, or exploratory work " +
			"that shouldn't pollute the main conversation.",
		inputSchema,

		// Agent 不是只读的（子 agent 可能修改文件）
		isDestructive: () => true,

		async call(input: Input, context: ToolUseContext) {
			const systemPrompt = [
				"You are a sub-agent launched to handle a specific task.",
				"Complete the task thoroughly and report your findings concisely.",
				"You have access to tools for file operations, search, and command execution.",
				`Working directory: ${context.cwd}`,
			].join("\n")

			const messages: Message[] = [
				{ role: "user", content: input.prompt },
			]

			// 运行子 query loop
			let resultText = ""
			let toolLog: string[] = []

			try {
				const events = query({
					provider,
					model,
					systemPrompt,
					messages,
					tools,
					toolContext: context,
					maxTurns: 15, // 子 agent 限制轮次
				})

				for await (const event of events) {
					switch (event.type) {
						case "text":
							resultText += event.text
							break
						case "tool_start":
							toolLog.push(`[${event.toolName}]`)
							break
						case "tool_end":
							if (event.result.isError) {
								toolLog.push(
									`  ✗ ${event.toolName}: ${event.result.content.slice(0, 100)}`,
								)
							}
							break
						case "error":
							return {
								content: `Agent error: ${event.error.message}`,
								isError: true,
							}
					}
				}
			} catch (error) {
				return {
					content: `Agent execution failed: ${(error as Error).message}`,
					isError: true,
				}
			}

			// 组装结果
			const parts: string[] = []
			if (toolLog.length > 0) {
				parts.push(`Tools used: ${toolLog.join(", ")}`)
			}
			if (resultText) {
				parts.push(resultText)
			} else {
				parts.push("Agent completed but produced no text output.")
			}

			return { content: parts.join("\n\n") }
		},

		renderToolUse(input: Input) {
			const desc = input.description ?? input.prompt.slice(0, 80)
			return `Agent: ${desc}`
		},

		renderToolResult(result) {
			if (result.isError) return `Agent error: ${result.content.slice(0, 100)}`
			const lines = result.content.split("\n")
			if (lines.length > 5) {
				return `${lines.slice(0, 5).join("\n")}\n... (${lines.length} lines)`
			}
			return result.content
		},
	})
}
