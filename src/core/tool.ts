/**
 * Tool 接口定义
 *
 * 整个工具系统的核心。参考 Claude Code 的设计：
 * 1. Tool 类型定义 — 工具必须实现的接口
 * 2. buildTool() 工厂 — 用安全默认值填充可选字段
 * 3. 辅助函数 — schema 转换、工具查找
 *
 * 设计原则：Fail-Closed
 * - isConcurrencySafe 默认 false（不可并发）
 * - isReadOnly 默认 false（有副作用）
 * - isDestructive 默认 false（非破坏性）
 * - checkPermissions 默认 allow（交给外部权限系统）
 */

import type { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { ToolSchema } from "../providers/types"

// ─── 权限结果 ───

export interface PermissionResult {
	behavior: "allow" | "ask" | "deny"
	message?: string
}

// ─── 工具执行结果 ───

export interface ToolResult {
	/** 返回给 LLM 的文本内容 */
	content: string
	/** 是否为错误结果 */
	isError?: boolean
}

// ─── 工具执行上下文 ───

export interface ToolUseContext {
	/** 当前工作目录 */
	cwd: string
	/** 是否处于只读模式 */
	readOnly?: boolean
}

// ─── Tool 接口 ───

export interface Tool<TInput = unknown> {
	/** 工具名称（唯一标识符） */
	name: string
	/** 别名列表 */
	aliases?: string[]
	/** 工具描述（展示给 LLM） */
	description: string
	/** 输入参数的 Zod schema */
	inputSchema: z.ZodType

	/** 执行工具 */
	call(input: TInput, context: ToolUseContext): Promise<ToolResult>

	/** 工具是否启用 */
	isEnabled(): boolean
	/** 是否可安全并发执行 */
	isConcurrencySafe(): boolean
	/** 是否只读（无副作用） */
	isReadOnly(): boolean
	/** 是否是破坏性操作 */
	isDestructive(): boolean

	/** 检查权限 */
	checkPermissions(input: TInput): Promise<PermissionResult>

	/** 渲染工具调用信息（用于 UI 显示） */
	renderToolUse(input: TInput): string
	/** 渲染工具结果信息（用于 UI 显示） */
	renderToolResult(result: ToolResult): string
}

// ─── Tool 定义（buildTool 的输入，只需要必填字段）───

export interface ToolDef<TInput = unknown> {
	name: string
	aliases?: string[]
	description: string
	inputSchema: z.ZodType
	call(input: TInput, context: ToolUseContext): Promise<ToolResult>

	// 以下全部可选，buildTool 会填充默认值
	isEnabled?: () => boolean
	isConcurrencySafe?: () => boolean
	isReadOnly?: () => boolean
	isDestructive?: () => boolean
	checkPermissions?: (input: TInput) => Promise<PermissionResult>
	renderToolUse?: (input: TInput) => string
	renderToolResult?: (result: ToolResult) => string
}

// ─── 安全默认值 ───

const TOOL_DEFAULTS = {
	isEnabled: () => true,
	isConcurrencySafe: () => false,
	isReadOnly: () => false,
	isDestructive: () => false,
	checkPermissions: async () => ({ behavior: "allow" as const }),
	renderToolUse: (_input: unknown) => "",
	renderToolResult: (result: ToolResult) =>
		result.isError ? `Error: ${result.content}` : result.content.slice(0, 200),
}

// ─── 工厂函数 ───

/**
 * 从 ToolDef 构建完整的 Tool 对象。
 * 用安全默认值填充所有可选方法，保证调用方无需做 null check。
 */
export function buildTool<TInput>(def: ToolDef<TInput>): Tool<TInput> {
	return {
		...TOOL_DEFAULTS,
		renderToolUse: (input: TInput) => `${def.name}(${JSON.stringify(input)})`,
		...def,
	} as Tool<TInput>
}

// ─── 辅助函数 ───

/** 将 Tool 的 Zod schema 转为 API 需要的 JSON Schema */
export function toolToAPISchema(tool: Tool): ToolSchema {
	const rawSchema = zodToJsonSchema(tool.inputSchema, {
		$refStrategy: "none",
	}) as Record<string, unknown>

	// 移除顶层 $schema 字段（一些 API 不接受）
	delete rawSchema.$schema

	// 清理 schema 中 OpenAI 不兼容的字段
	sanitizeSchema(rawSchema)

	return {
		name: tool.name,
		description: tool.description,
		input_schema: rawSchema,
	}
}

/**
 * 递归清理 JSON Schema 中 OpenAI 不兼容的写法：
 * - exclusiveMinimum: true + minimum → exclusiveMinimum: <number>
 * - exclusiveMaximum: true + maximum → exclusiveMaximum: <number>
 */
function sanitizeSchema(obj: Record<string, unknown>): void {
	if (typeof obj !== "object" || obj === null) return

	// 修复 draft-04 风格的 exclusiveMinimum/Maximum
	if (obj.exclusiveMinimum === true && typeof obj.minimum === "number") {
		obj.exclusiveMinimum = obj.minimum
		delete obj.minimum
	}
	if (obj.exclusiveMaximum === true && typeof obj.maximum === "number") {
		obj.exclusiveMaximum = obj.maximum
		delete obj.maximum
	}

	// 递归处理嵌套
	for (const value of Object.values(obj)) {
		if (typeof value === "object" && value !== null) {
			if (Array.isArray(value)) {
				for (const item of value) {
					if (typeof item === "object" && item !== null) {
						sanitizeSchema(item as Record<string, unknown>)
					}
				}
			} else {
				sanitizeSchema(value as Record<string, unknown>)
			}
		}
	}
}

/** 按名称或别名查找工具 */
export function findToolByName(
	tools: readonly Tool[],
	name: string,
): Tool | undefined {
	return tools.find(
		(t) => t.name === name || t.aliases?.includes(name),
	)
}

/** 检查工具是否匹配给定名称（含别名） */
export function toolMatchesName(tool: Tool, name: string): boolean {
	return tool.name === name || (tool.aliases?.includes(name) ?? false)
}

/** 获取所有启用的工具 */
export function getEnabledTools(tools: readonly Tool[]): Tool[] {
	return tools.filter((t) => t.isEnabled())
}

/** 将工具列表转为 API schema 列表 */
export function toolsToAPISchemas(tools: readonly Tool[]): ToolSchema[] {
	return tools.map(toolToAPISchema)
}
