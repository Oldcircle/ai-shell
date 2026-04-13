/**
 * 根应用组件（重写）
 *
 * REPL 核心，参考 Claude Code 的架构改进：
 * 1. AbortController + Ctrl+C 中断（不退出进程）
 * 2. 权限对话框（allow/deny/always allow）
 * 3. Ref-based 消息追踪（避免闭包陈旧）
 * 4. 工具执行结果展示
 * 5. 会话自动保存
 */

import React, { useState, useCallback, useRef, useEffect } from "react"
import { Box, Text } from "ink"
import { Messages } from "./messages"
import { PromptInput } from "./prompt-input"
import { StatusBar } from "./status-bar"
import { Spinner } from "./spinner"
import { ToolResultView } from "./tool-result"
import {
	PermissionDialog,
	type PermissionRequest,
} from "./permission-dialog"
import type { Message } from "../core/message"
import type { Tool } from "../core/tool"
import { findToolByName } from "../core/tool"
import type { Provider, TokenUsage } from "../providers/types"
import {
	createPermissionContext,
	checkPermission,
	approveForSession,
	type PermissionContext,
} from "../core/permissions"
import { query, type QueryEvent } from "../query"
import { saveSession, generateSessionId } from "../config/session"
import { isCommand, executeCommand } from "../core/commands"
import { autoCompact } from "../core/compact"

interface AppProps {
	provider: Provider
	model: string
	systemPrompt: string
	tools: readonly Tool[]
	cwd: string
	/** 恢复的会话消息 */
	resumeMessages?: Message[]
}

/** 工具执行记录（用于 UI 展示） */
interface ToolExecution {
	toolName: string
	toolId: string
	content: string
	isError: boolean
	duration: number
}

export function App({
	provider,
	model: initialModel,
	systemPrompt,
	tools,
	cwd,
	resumeMessages,
}: AppProps) {
	const [currentModel, setCurrentModel] = useState(initialModel)
	// Use currentModel everywhere below instead of model
	const model = currentModel
	// ─── 核心状态 ───
	const [messages, setMessages] = useState<Message[]>(resumeMessages ?? [])
	const [isLoading, setIsLoading] = useState(false)
	const [streamingText, setStreamingText] = useState("")
	const [toolStatus, setToolStatus] = useState<string | null>(null)
	const [toolResults, setToolResults] = useState<ToolExecution[]>([])
	const [totalUsage, setTotalUsage] = useState<TokenUsage>({
		inputTokens: 0,
		outputTokens: 0,
	})
	const [totalCost, setTotalCost] = useState(0)

	// ─── 权限状态 ───
	const [permissionRequest, setPermissionRequest] =
		useState<PermissionRequest | null>(null)
	const permissionResolveRef =
		useRef<((action: "allow" | "deny" | "always") => void) | null>(null)
	const permContextRef = useRef<PermissionContext>(
		createPermissionContext("default"),
	)

	// ─── Ref 追踪（避免闭包陈旧）───
	const messagesRef = useRef(messages)
	messagesRef.current = messages
	const abortControllerRef = useRef<AbortController | null>(null)
	const sessionIdRef = useRef(generateSessionId())
	const toolStartTimeRef = useRef<Map<string, number>>(new Map())

	// ─── 自动保存 ───
	useEffect(() => {
		if (messages.length > 0) {
			saveSession(sessionIdRef.current, messages).catch(() => {})
		}
	}, [messages])

	// ─── 权限检查 Hook（注入到 query loop）───
	const checkToolPermission = useCallback(
		async (
			toolName: string,
			toolId: string,
			input: Record<string, unknown>,
		): Promise<boolean> => {
			const tool = findToolByName(tools, toolName)
			if (!tool) return true // 未知工具让 query loop 处理

			const result = await checkPermission(
				tool,
				input,
				permContextRef.current,
			)

			if (result.behavior === "allow") return true
			if (result.behavior === "deny") return false

			// behavior === "ask" → 显示权限对话框
			return new Promise<boolean>((resolve) => {
				const request: PermissionRequest = {
					toolName,
					toolId,
					input,
					description: tool.renderToolUse(input),
				}
				setPermissionRequest(request)
				permissionResolveRef.current = (action) => {
					setPermissionRequest(null)
					permissionResolveRef.current = null

					if (action === "always") {
						approveForSession(permContextRef.current, toolName)
						resolve(true)
					} else if (action === "allow") {
						resolve(true)
					} else {
						resolve(false)
					}
				}
			})
		},
		[tools],
	)

	// ─── 提交处理 ───
	const handleSubmit = useCallback(
		async (userInput: string) => {
			// ─── Slash 命令 ───
			if (isCommand(userInput)) {
				const result = await executeCommand(userInput, {
					messages: messagesRef.current,
					model,
					provider,
					usage: totalUsage,
					cost: totalCost,
					cwd,
				})

				setToolStatus(result.output)
				if (result.newMessages !== undefined) {
					setMessages(result.newMessages)
					setToolResults([])
					setStreamingText("")
				}
				if (result.newModel) {
					setCurrentModel(result.newModel)
				}
				if (result.exit) {
					process.exit(0)
				}
				return
			}

			const userMessage: Message = { role: "user", content: userInput }
			// 使用 ref 获取最新消息，避免闭包陈旧
			let currentMessages = [...messagesRef.current, userMessage]

			setMessages(currentMessages)
			setIsLoading(true)
			setStreamingText("")
			setToolStatus(null)
			setToolResults([])

			// ─── 自动压缩检查 ───
			try {
				const compactResult = await autoCompact(currentMessages, model, provider)
				if (compactResult) {
					currentMessages = compactResult.messages
					setMessages(currentMessages)
					setToolStatus(
						`Auto-compacted: ${compactResult.beforeTokens} → ${compactResult.afterTokens} tokens`,
					)
				}
			} catch {
				// 压缩失败不阻塞，继续发送
			}

			// 创建 AbortController
			const abortController = new AbortController()
			abortControllerRef.current = abortController

			try {
				const events = query({
					provider,
					model,
					systemPrompt,
					messages: currentMessages,
					tools,
					toolContext: { cwd, readFiles: new Set() },
					abortSignal: abortController.signal,
				})

				let accumulatedText = ""

				for await (const event of events) {
					// 检查是否已中止
					if (abortController.signal.aborted) break

					handleQueryEvent(event, accumulatedText, (t) => {
						accumulatedText = t
					})
				}
			} catch (error) {
				if (!abortController.signal.aborted) {
					setToolStatus(`Error: ${(error as Error).message}`)
				}
			} finally {
				setIsLoading(false)
				abortControllerRef.current = null
			}
		},
		[provider, model, systemPrompt, tools, cwd, totalCost, totalUsage],
	)

	// ─── 事件处理 ───
	const handleQueryEvent = useCallback(
		(
			event: QueryEvent,
			accumulatedText: string,
			setAccumulated: (t: string) => void,
		) => {
			switch (event.type) {
				case "text":
					setAccumulated(accumulatedText + event.text)
					setStreamingText(accumulatedText + event.text)
					break

				case "thinking":
					setToolStatus(`Thinking...`)
					break

				case "tool_start":
					setToolStatus(`Running: ${event.toolName}`)
					toolStartTimeRef.current.set(
						event.toolId,
						Date.now(),
					)
					break

				case "tool_end": {
					const startTime =
						toolStartTimeRef.current.get(event.toolId) ??
						Date.now()
					const duration = Date.now() - startTime
					toolStartTimeRef.current.delete(event.toolId)

					setToolResults((prev) => [
						...prev,
						{
							toolName: event.toolName,
							toolId: event.toolId,
							content: event.result.content,
							isError: event.result.isError ?? false,
							duration,
						},
					])
					setToolStatus(null)
					break
				}

				case "done":
					setMessages(event.messages)
					setStreamingText("")
					setToolStatus(null)
					setTotalUsage((prev) => ({
						inputTokens:
							prev.inputTokens + event.usage.inputTokens,
						outputTokens:
							prev.outputTokens + event.usage.outputTokens,
					}))
					setTotalCost((prev) => {
						const ic =
							(event.usage.inputTokens / 1_000_000) * 3
						const oc =
							(event.usage.outputTokens / 1_000_000) * 15
						return prev + ic + oc
					})
					break

				case "error":
					setStreamingText("")
					setToolStatus(`Error: ${event.error.message}`)
					break
			}
		},
		[],
	)

	// ─── 中断处理 ───
	const handleInterrupt = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort("user-cancel")
			setIsLoading(false)
			setStreamingText("")
			setToolStatus("Interrupted by user")
		}
	}, [])

	// ─── 渲染 ───
	return (
		<Box flexDirection="column" padding={1}>
			{/* 标题 */}
			<Box marginBottom={1}>
				<Text bold color="cyan">
					AI Shell
				</Text>
				<Text dimColor>
					{" "}
					— {provider.name}/{model.replace("claude-", "").replace("-20250514", "")}
				</Text>
				<Text dimColor> (session: {sessionIdRef.current.slice(-8)})</Text>
			</Box>

			{/* 消息列表 */}
			<Messages messages={messages} />

			{/* 流式输出 */}
			{streamingText && (
				<Box marginBottom={1}>
					<Text>{streamingText}</Text>
				</Box>
			)}

			{/* 工具执行结果 */}
			{toolResults.map((tr) => (
				<ToolResultView
					key={tr.toolId}
					toolName={tr.toolName}
					content={tr.content}
					isError={tr.isError}
					duration={tr.duration}
				/>
			))}

			{/* 权限对话框 */}
			{permissionRequest && (
				<PermissionDialog
					request={permissionRequest}
					onAllow={() => permissionResolveRef.current?.("allow")}
					onDeny={() => permissionResolveRef.current?.("deny")}
					onAlwaysAllow={() =>
						permissionResolveRef.current?.("always")
					}
				/>
			)}

			{/* 工具状态 / 加载动画 */}
			{isLoading && !permissionRequest && (
				<Box marginBottom={1}>
					{toolStatus ? (
						<Spinner label={toolStatus} />
					) : (
						<Spinner />
					)}
				</Box>
			)}

			{/* 非加载状态的 toolStatus（如错误信息、命令反馈）*/}
			{!isLoading && toolStatus && (
				<Box marginBottom={1}>
					<Text dimColor>{toolStatus}</Text>
				</Box>
			)}

			{/* 输入框 */}
			<PromptInput
				onSubmit={handleSubmit}
				onInterrupt={handleInterrupt}
				disabled={isLoading && !permissionRequest}
				isLoading={isLoading}
			/>

			{/* 状态栏 */}
			<StatusBar
				model={model}
				usage={totalUsage}
				cost={totalCost}
				isLoading={isLoading}
			/>
		</Box>
	)
}
