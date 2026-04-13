/**
 * 配置系统
 *
 * 两层配置：
 * 1. 全局: ~/.ai-shell/config.json
 * 2. 项目: .ai-shell/config.json（当前目录）
 *
 * 项目级覆盖全局级。环境变量覆盖一切。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// ─── 配置类型 ───

export interface Config {
	/** 默认 provider */
	provider?: string
	/** 默认模型 */
	model?: string
	/** API keys */
	apiKeys?: {
		anthropic?: string
		deepseek?: string
		openai?: string
	}
	/** 权限模式 */
	permissionMode?: "default" | "bypass"
	/** 允许的工具规则 */
	allowRules?: string[]
	/** 拒绝的工具规则 */
	denyRules?: string[]
	/** 自动压缩 */
	autoCompact?: boolean
	/** verbose 模式 */
	verbose?: boolean
}

// ─── 路径 ───

const GLOBAL_CONFIG_DIR = join(homedir(), ".ai-shell")
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json")

function getProjectConfigPath(cwd: string): string {
	return join(cwd, ".ai-shell", "config.json")
}

// ─── 加载 ───

async function loadJsonFile(path: string): Promise<Partial<Config>> {
	if (!existsSync(path)) return {}
	try {
		const content = await readFile(path, "utf-8")
		return JSON.parse(content) as Partial<Config>
	} catch {
		return {}
	}
}

/**
 * 加载合并后的配置
 * 优先级：环境变量 > 项目配置 > 全局配置 > 默认值
 */
export async function loadConfig(cwd: string): Promise<Config> {
	const globalConfig = await loadJsonFile(GLOBAL_CONFIG_PATH)
	const projectConfig = await loadJsonFile(getProjectConfigPath(cwd))

	const merged: Config = {
		...globalConfig,
		...projectConfig,
	}

	// 环境变量覆盖
	if (process.env.AI_SHELL_PROVIDER) {
		merged.provider = process.env.AI_SHELL_PROVIDER
	}
	if (process.env.AI_SHELL_MODEL) {
		merged.model = process.env.AI_SHELL_MODEL
	}
	if (process.env.ANTHROPIC_API_KEY) {
		merged.apiKeys = { ...merged.apiKeys, anthropic: process.env.ANTHROPIC_API_KEY }
	}
	if (process.env.DEEPSEEK_API_KEY) {
		merged.apiKeys = { ...merged.apiKeys, deepseek: process.env.DEEPSEEK_API_KEY }
	}
	if (process.env.OPENAI_API_KEY) {
		merged.apiKeys = { ...merged.apiKeys, openai: process.env.OPENAI_API_KEY }
	}

	return merged
}

// ─── 保存 ───

export async function saveGlobalConfig(config: Partial<Config>): Promise<void> {
	await mkdir(GLOBAL_CONFIG_DIR, { recursive: true })
	const existing = await loadJsonFile(GLOBAL_CONFIG_PATH)
	const merged = { ...existing, ...config }
	await writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(merged, null, 2) + "\n", "utf-8")
}

// ─── API Key 应用 ───

/**
 * 将配置中的 API key 设置到环境变量
 * 仅在环境变量未设置时才应用
 */
export function applyApiKeys(config: Config): void {
	if (config.apiKeys?.anthropic && !process.env.ANTHROPIC_API_KEY) {
		process.env.ANTHROPIC_API_KEY = config.apiKeys.anthropic
	}
	if (config.apiKeys?.deepseek && !process.env.DEEPSEEK_API_KEY) {
		process.env.DEEPSEEK_API_KEY = config.apiKeys.deepseek
	}
	if (config.apiKeys?.openai && !process.env.OPENAI_API_KEY) {
		process.env.OPENAI_API_KEY = config.apiKeys.openai
	}
}
