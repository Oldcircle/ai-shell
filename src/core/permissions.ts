/**
 * 权限系统
 *
 * 控制工具执行的安全层。设计参考 Claude Code：
 * - 三种模式：default（交互审批）、bypass（自动允许）、deny（自动拒绝）
 * - 工具自身声明安全属性（isReadOnly, isDestructive）
 * - 会话级规则缓存（允许一次后不再询问）
 */

import type { Tool, PermissionResult } from "./tool"

// ─── 权限模式 ───

export type PermissionMode = "default" | "bypass" | "deny"

// ─── 权限规则 ───

export interface PermissionRule {
	/** 工具名称或通配符模式 */
	tool: string
	/** 动作 */
	action: "allow" | "deny"
}

// ─── 权限上下文 ───

export interface PermissionContext {
	mode: PermissionMode
	rules: PermissionRule[]
	/** 本次会话中已批准的工具调用缓存 */
	sessionApprovals: Set<string>
}

export function createPermissionContext(
	mode: PermissionMode = "default",
	rules: PermissionRule[] = [],
): PermissionContext {
	return {
		mode,
		rules,
		sessionApprovals: new Set(),
	}
}

// ─── 权限检查 ───

/**
 * 检查是否允许执行工具
 *
 * 优先级：
 * 1. bypass 模式 → 始终允许
 * 2. deny 模式 → 始终拒绝
 * 3. 显式规则匹配 → 按规则执行
 * 4. 会话缓存 → 已批准则允许
 * 5. 只读工具 → 自动允许
 * 6. 其他 → 需要用户审批（ask）
 */
export async function checkPermission(
	tool: Tool,
	input: unknown,
	context: PermissionContext,
): Promise<PermissionResult> {
	// 1. 模式判断
	if (context.mode === "bypass") {
		return { behavior: "allow" }
	}
	if (context.mode === "deny") {
		return { behavior: "deny", message: "Permission mode is set to deny" }
	}

	// 2. 显式规则匹配
	const rule = findMatchingRule(tool.name, context.rules)
	if (rule) {
		return {
			behavior: rule.action === "allow" ? "allow" : "deny",
			message: rule.action === "deny" ? `Denied by rule: ${rule.tool}` : undefined,
		}
	}

	// 3. 会话缓存
	const cacheKey = `${tool.name}`
	if (context.sessionApprovals.has(cacheKey)) {
		return { behavior: "allow" }
	}

	// 4. 只读工具自动允许
	if (tool.isReadOnly()) {
		return { behavior: "allow" }
	}

	// 5. 工具自身的权限检查
	const toolPermission = await tool.checkPermissions(input)
	if (toolPermission.behavior !== "allow") {
		return toolPermission
	}

	// 6. 需要用户审批
	return { behavior: "ask" }
}

/** 将工具添加到会话批准缓存 */
export function approveForSession(
	context: PermissionContext,
	toolName: string,
): void {
	context.sessionApprovals.add(toolName)
}

// ─── 规则匹配 ───

function findMatchingRule(
	toolName: string,
	rules: PermissionRule[],
): PermissionRule | undefined {
	return rules.find((rule) => matchPattern(rule.tool, toolName))
}

function matchPattern(pattern: string, name: string): boolean {
	if (pattern === "*") return true
	if (pattern === name) return true

	// 简单通配符：`Bash:git *` 匹配 `Bash`
	if (pattern.includes(":")) {
		const [toolPart] = pattern.split(":")
		return toolPart === name
	}

	// glob 风格通配符
	if (pattern.includes("*")) {
		const regex = new RegExp(
			`^${pattern.replace(/\*/g, ".*")}$`,
		)
		return regex.test(name)
	}

	return false
}
