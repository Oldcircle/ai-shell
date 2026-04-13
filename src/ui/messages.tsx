/**
 * 消息渲染组件
 *
 * 渲染完整的对话历史。针对每种消息类型做不同处理：
 * - 用户输入：蓝色 ❯ 前缀
 * - AI 文本回复：直接显示
 * - 工具调用：显示工具名 + 输入摘要 + 结果
 * - Tool result（user 角色）：隐藏（内部消息）
 */

import React from "react"
import { Box, Text } from "ink"
import type {
	Message,
	ToolUseBlock,
	ToolResultBlock,
	TextBlock,
	ThinkingBlock,
} from "../core/message"
import { renderMarkdown } from "../utils/markdown"

interface MessagesProps {
	messages: Message[]
}

export function Messages({ messages }: MessagesProps) {
	return (
		<Box flexDirection="column">
			{messages.map((msg, i) => (
				<MessageRow key={i} message={msg} />
			))}
		</Box>
	)
}

function MessageRow({ message }: { message: Message }) {
	if (message.role === "user") {
		return <UserMessageRow message={message} />
	}
	return <AssistantMessageRow message={message} />
}

function UserMessageRow({ message }: { message: Message }) {
	// 隐藏 tool_result 消息（内部消息，不应该展示给用户）
	if (typeof message.content !== "string") {
		const blocks = message.content as Array<{ type: string }>
		if (blocks.some((b) => b.type === "tool_result")) {
			return null
		}
		// 提取文本块
		const text = blocks
			.filter((b): b is TextBlock => b.type === "text")
			.map((b) => b.text)
			.join("")
		if (!text) return null
		return (
			<Box marginBottom={1}>
				<Text bold color="blue">
					{"❯ "}
				</Text>
				<Text>{text}</Text>
			</Box>
		)
	}

	return (
		<Box marginBottom={1}>
			<Text bold color="blue">
				{"❯ "}
			</Text>
			<Text>{message.content}</Text>
		</Box>
	)
}

function AssistantMessageRow({ message }: { message: Message }) {
	if (typeof message.content === "string") {
		const rendered = renderMarkdown(message.content)
		return (
			<Box marginBottom={1} flexDirection="column">
				<Text>{rendered}</Text>
			</Box>
		)
	}

	const blocks = message.content as Array<
		TextBlock | ToolUseBlock | ThinkingBlock
	>

	return (
		<Box marginBottom={1} flexDirection="column">
			{blocks.map((block, i) => {
				switch (block.type) {
					case "text":
						return <Text key={i}>{renderMarkdown(block.text)}</Text>
					case "thinking":
						return <ThinkingBlockView key={i} block={block} />
					case "tool_use":
						return <ToolUseView key={i} block={block} />
					default:
						return null
				}
			})}
		</Box>
	)
}

function ThinkingBlockView({ block }: { block: ThinkingBlock }) {
	// 折叠显示 thinking，只显示前 80 字符
	const preview = block.thinking.slice(0, 80).replace(/\n/g, " ")
	return (
		<Box>
			<Text dimColor italic>
				{"  💭 "}
				{preview}
				{block.thinking.length > 80 ? "..." : ""}
			</Text>
		</Box>
	)
}

function ToolUseView({ block }: { block: ToolUseBlock }) {
	const summary = formatToolCall(block.name, block.input)
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="cyan" bold>
					{"  ⚡ "}
				</Text>
				<Text color="cyan">{block.name}</Text>
				<Text dimColor>{" — "}</Text>
				<Text dimColor>{summary}</Text>
			</Box>
		</Box>
	)
}

/** 格式化工具调用摘要 */
function formatToolCall(
	name: string,
	input: Record<string, unknown>,
): string {
	switch (name) {
		case "Bash":
			return truncate(String(input.command ?? ""), 120)
		case "Read":
			return String(input.file_path ?? "")
		case "Write":
			return `${input.file_path} (${String(input.content ?? "").split("\n").length} lines)`
		case "Edit": {
			const old = truncate(String(input.old_string ?? ""), 50)
			return `${input.file_path}: "${old}"`
		}
		case "Glob":
			return `${input.pattern}${input.path ? ` in ${input.path}` : ""}`
		case "Grep":
			return `/${input.pattern}/${input.glob ? ` in ${input.glob}` : ""}`
		default:
			return truncate(JSON.stringify(input), 100)
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max)}...` : s
}
