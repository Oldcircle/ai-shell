/**
 * 输入提示组件
 *
 * 功能：
 * - 单行输入 + 回车提交
 * - 上/下箭头翻阅历史
 * - Ctrl+C：加载中时中断请求，空闲时退出
 */

import React, { useState, useRef } from "react"
import { Box, Text, useInput } from "ink"

interface PromptInputProps {
	onSubmit: (text: string) => void
	onInterrupt?: () => void
	disabled?: boolean
	isLoading?: boolean
	placeholder?: string
}

export function PromptInput({
	onSubmit,
	onInterrupt,
	disabled = false,
	isLoading = false,
	placeholder = "Type a message...",
}: PromptInputProps) {
	const [input, setInput] = useState("")
	const historyRef = useRef<string[]>([])
	const historyIndexRef = useRef(-1)

	useInput((ch, key) => {
		// Ctrl+C 处理
		if (ch === "c" && key.ctrl) {
			if (isLoading && onInterrupt) {
				onInterrupt()
			} else if (!input) {
				process.exit(0)
			} else {
				// 清空当前输入
				setInput("")
			}
			return
		}

		if (disabled) return

		// 回车提交
		if (key.return) {
			if (input.trim()) {
				// 添加到历史
				historyRef.current.push(input.trim())
				historyIndexRef.current = -1
				onSubmit(input.trim())
				setInput("")
			}
			return
		}

		// 退格
		if (key.backspace || key.delete) {
			setInput((prev) => prev.slice(0, -1))
			return
		}

		// 上箭头 — 翻阅历史
		if (key.upArrow) {
			const history = historyRef.current
			if (history.length === 0) return
			const newIndex =
				historyIndexRef.current === -1
					? history.length - 1
					: Math.max(0, historyIndexRef.current - 1)
			historyIndexRef.current = newIndex
			setInput(history[newIndex])
			return
		}

		// 下箭头 — 向前翻阅
		if (key.downArrow) {
			const history = historyRef.current
			if (historyIndexRef.current === -1) return
			const newIndex = historyIndexRef.current + 1
			if (newIndex >= history.length) {
				historyIndexRef.current = -1
				setInput("")
			} else {
				historyIndexRef.current = newIndex
				setInput(history[newIndex])
			}
			return
		}

		// Ctrl+U — 清空行
		if (ch === "u" && key.ctrl) {
			setInput("")
			return
		}

		// 普通字符输入
		if (ch && !key.ctrl && !key.meta) {
			setInput((prev) => prev + ch)
			historyIndexRef.current = -1 // 打字时退出历史模式
		}
	})

	return (
		<Box>
			<Text bold color={isLoading ? "yellow" : "green"}>
				{isLoading ? "⏳ " : "❯ "}
			</Text>
			{input ? (
				<Text>{input}</Text>
			) : (
				<Text dimColor>
					{isLoading ? "Press Ctrl+C to interrupt" : placeholder}
				</Text>
			)}
			{!isLoading && <Text>{"█"}</Text>}
		</Box>
	)
}
