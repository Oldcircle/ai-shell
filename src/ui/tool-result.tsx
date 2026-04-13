/**
 * 工具执行结果展示组件
 *
 * 在工具执行完成后，简洁地显示结果摘要。
 */

import React from "react"
import { Box, Text } from "ink"

interface ToolResultViewProps {
	toolName: string
	content: string
	isError: boolean
	/** 执行耗时 ms */
	duration?: number
}

export function ToolResultView({
	toolName,
	content,
	isError,
	duration,
}: ToolResultViewProps) {
	const statusIcon = isError ? "✗" : "✓"
	const statusColor = isError ? "red" : "green"

	// 结果摘要：最多 3 行
	const lines = content.split("\n")
	const preview =
		lines.length <= 3
			? content
			: `${lines.slice(0, 3).join("\n")}\n  ... (${lines.length} lines total)`

	return (
		<Box flexDirection="column" marginLeft={2}>
			<Box>
				<Text color={statusColor} bold>
					{"  "}
					{statusIcon}{" "}
				</Text>
				<Text color={statusColor}>{toolName}</Text>
				{duration !== undefined && (
					<Text dimColor> ({duration}ms)</Text>
				)}
			</Box>
			{isError && (
				<Box marginLeft={4}>
					<Text color="red">{preview.slice(0, 200)}</Text>
				</Box>
			)}
		</Box>
	)
}
