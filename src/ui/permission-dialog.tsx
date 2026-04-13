/**
 * 权限审批对话框
 *
 * 当工具需要用户确认时显示。参考 Claude Code 的 PermissionRequest：
 * - 显示工具名称和输入摘要
 * - 三个选项：允许 / 拒绝 / 始终允许
 * - 键盘操作：y=允许, n=拒绝, a=始终允许, Ctrl+C=拒绝
 */

import React from "react"
import { Box, Text, useInput } from "ink"

export interface PermissionRequest {
	toolName: string
	toolId: string
	input: Record<string, unknown>
	/** 工具的 renderToolUse 输出 */
	description: string
}

interface PermissionDialogProps {
	request: PermissionRequest
	onAllow: () => void
	onDeny: () => void
	onAlwaysAllow: () => void
}

export function PermissionDialog({
	request,
	onAllow,
	onDeny,
	onAlwaysAllow,
}: PermissionDialogProps) {
	useInput((ch, key) => {
		if (ch === "y" || ch === "Y") {
			onAllow()
			return
		}
		if (ch === "n" || ch === "N") {
			onDeny()
			return
		}
		if (ch === "a" || ch === "A") {
			onAlwaysAllow()
			return
		}
		if (key.return) {
			onAllow()
			return
		}
		if (ch === "c" && key.ctrl) {
			onDeny()
		}
	})

	// 格式化输入摘要
	const inputSummary = formatInput(request.toolName, request.input)

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="yellow"
			paddingX={1}
			paddingY={0}
		>
			<Box marginBottom={0}>
				<Text bold color="yellow">
					{"? "}
				</Text>
				<Text bold>
					{request.toolName}
				</Text>
				<Text dimColor> wants to execute:</Text>
			</Box>

			{/* 输入摘要 */}
			<Box marginLeft={2} marginBottom={0} flexDirection="column">
				{inputSummary.map((line, i) => (
					<Text key={i} dimColor>
						{line}
					</Text>
				))}
			</Box>

			{/* 选项 */}
			<Box marginTop={0}>
				<Text dimColor>
					{"  "}
				</Text>
				<Text color="green" bold>
					[Y]es
				</Text>
				<Text dimColor>{" / "}</Text>
				<Text color="red" bold>
					[N]o
				</Text>
				<Text dimColor>{" / "}</Text>
				<Text color="cyan" bold>
					[A]lways allow
				</Text>
			</Box>
		</Box>
	)
}

function formatInput(
	toolName: string,
	input: Record<string, unknown>,
): string[] {
	const lines: string[] = []

	switch (toolName) {
		case "Bash": {
			const cmd = String(input.command ?? "")
			lines.push(`$ ${cmd.length > 200 ? `${cmd.slice(0, 200)}...` : cmd}`)
			if (input.description) {
				lines.push(`  (${input.description})`)
			}
			break
		}
		case "Write": {
			const path = String(input.file_path ?? "")
			const content = String(input.content ?? "")
			const lineCount = content.split("\n").length
			lines.push(`${path} (${lineCount} lines)`)
			break
		}
		case "Edit": {
			const path = String(input.file_path ?? "")
			const old = String(input.old_string ?? "").slice(0, 60)
			lines.push(`${path}`)
			lines.push(`  "${old}${String(input.old_string ?? "").length > 60 ? "..." : ""}"`)
			break
		}
		default: {
			// 通用：列出每个参数
			for (const [key, value] of Object.entries(input)) {
				const v = typeof value === "string" ? value : JSON.stringify(value)
				lines.push(`${key}: ${v.length > 100 ? `${v.slice(0, 100)}...` : v}`)
			}
		}
	}

	return lines
}
