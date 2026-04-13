/**
 * 会话持久化
 *
 * 参考 Claude Code 的 transcript 系统：
 * - JSONL 格式（每行一个消息 JSON）
 * - 增量追加写入
 * - 支持 resume 加载
 *
 * 存储位置: ~/.ai-shell/sessions/{sessionId}.jsonl
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Message } from "../core/message"

const SESSIONS_DIR = join(homedir(), ".ai-shell", "sessions")

// ─── 确保目录存在 ───

async function ensureDir(): Promise<void> {
	if (!existsSync(SESSIONS_DIR)) {
		await mkdir(SESSIONS_DIR, { recursive: true })
	}
}

// ─── 保存 ───

export async function saveSession(
	sessionId: string,
	messages: Message[],
): Promise<string> {
	await ensureDir()
	const filePath = join(SESSIONS_DIR, `${sessionId}.jsonl`)
	const content = messages.map((m) => JSON.stringify(m)).join("\n") + "\n"
	await writeFile(filePath, content, "utf-8")
	return filePath
}

/** 追加消息到现有会话 */
export async function appendToSession(
	sessionId: string,
	messages: Message[],
): Promise<void> {
	await ensureDir()
	const filePath = join(SESSIONS_DIR, `${sessionId}.jsonl`)
	const lines = messages.map((m) => JSON.stringify(m)).join("\n") + "\n"

	const { appendFile } = await import("node:fs/promises")
	await appendFile(filePath, lines, "utf-8")
}

// ─── 加载 ───

export async function loadSession(sessionId: string): Promise<Message[] | null> {
	const filePath = join(SESSIONS_DIR, `${sessionId}.jsonl`)
	if (!existsSync(filePath)) return null

	try {
		const content = await readFile(filePath, "utf-8")
		const lines = content.trim().split("\n").filter(Boolean)
		return lines.map((line) => JSON.parse(line) as Message)
	} catch {
		return null
	}
}

// ─── 列出会话 ───

export interface SessionInfo {
	id: string
	path: string
	modifiedAt: Date
	messageCount: number
}

export async function listSessions(limit = 20): Promise<SessionInfo[]> {
	await ensureDir()

	try {
		const files = await readdir(SESSIONS_DIR)
		const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"))

		const infos: SessionInfo[] = []
		for (const file of jsonlFiles) {
			const filePath = join(SESSIONS_DIR, file)
			const fileStat = await stat(filePath)
			const content = await readFile(filePath, "utf-8")
			const lineCount = content.trim().split("\n").filter(Boolean).length

			infos.push({
				id: file.replace(".jsonl", ""),
				path: filePath,
				modifiedAt: fileStat.mtime,
				messageCount: lineCount,
			})
		}

		// 按修改时间倒序
		infos.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
		return infos.slice(0, limit)
	} catch {
		return []
	}
}

// ─── 会话 ID 生成 ───

export function generateSessionId(): string {
	const now = new Date()
	const date = now.toISOString().slice(0, 10).replace(/-/g, "")
	const time = now.toISOString().slice(11, 19).replace(/:/g, "")
	const rand = Math.random().toString(36).slice(2, 6)
	return `${date}-${time}-${rand}`
}
