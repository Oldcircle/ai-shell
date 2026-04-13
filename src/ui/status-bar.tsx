/**
 * 状态栏组件
 *
 * 显示当前模型、Token 用量、花费等信息。
 */

import React from "react"
import { Box, Text } from "ink"
import type { TokenUsage } from "../providers/types"

interface StatusBarProps {
	model: string
	usage: TokenUsage
	cost: number
	isLoading: boolean
}

export function StatusBar({ model, usage, cost, isLoading }: StatusBarProps) {
	const modelShort = model.replace("claude-", "").replace("-20250514", "")

	return (
		<Box borderStyle="single" borderColor="gray" paddingX={1}>
			<Text dimColor>
				{modelShort}
				{"  "}
				{formatTokens(usage.inputTokens)}↑ {formatTokens(usage.outputTokens)}↓
				{"  "}
				${cost.toFixed(4)}
				{isLoading ? "  thinking..." : ""}
			</Text>
		</Box>
	)
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
	return String(n)
}
