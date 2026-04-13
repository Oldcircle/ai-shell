/**
 * 工具注册表
 *
 * 集中管理所有内置工具的注册和检索。
 * 静态工具直接导入，动态工具（如 AgentTool）在运行时创建。
 */

import type { Tool } from "./tool"
import type { Provider } from "../providers/types"
import { FileReadTool } from "../tools/file-read"
import { FileWriteTool } from "../tools/file-write"
import { FileEditTool } from "../tools/file-edit"
import { BashTool } from "../tools/bash"
import { GlobTool } from "../tools/glob"
import { GrepTool } from "../tools/grep"
import { createAgentTool } from "../tools/agent"

// ─── 静态工具（不需要运行时参数）───

const STATIC_TOOLS: Tool[] = [
	// 文件操作
	FileReadTool,
	FileWriteTool,
	FileEditTool,
	// 搜索
	GlobTool,
	GrepTool,
	// 执行
	BashTool,
]

/**
 * 获取启用的静态工具列表
 */
export function getEnabledTools(): readonly Tool[] {
	return STATIC_TOOLS.filter((t) => t.isEnabled())
}

/**
 * 构建完整工具列表（含动态工具如 AgentTool）
 * 在 CLI 初始化时调用，注入 provider 和 model
 */
export function buildToolSet(
	provider: Provider,
	model: string,
): readonly Tool[] {
	const staticTools = getEnabledTools()
	const agentTool = createAgentTool(provider, model, staticTools)
	return [...staticTools, agentTool]
}
