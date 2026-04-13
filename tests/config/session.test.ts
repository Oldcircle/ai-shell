import { describe, test, expect, afterAll } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import {
	saveSession,
	loadSession,
	listSessions,
	generateSessionId,
} from "../../src/config/session"
import type { Message } from "../../src/core/message"

const TEST_SESSION_ID = `test-${Date.now()}`

afterAll(async () => {
	// 清理测试会话
	const path = join(homedir(), ".ai-shell", "sessions", `${TEST_SESSION_ID}.jsonl`)
	await rm(path, { force: true }).catch(() => {})
})

describe("Session persistence", () => {
	const testMessages: Message[] = [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: "Hi! How can I help?" },
		{ role: "user", content: "what is 2+2?" },
		{ role: "assistant", content: "4" },
	]

	test("generateSessionId creates unique IDs", () => {
		const id1 = generateSessionId()
		const id2 = generateSessionId()
		expect(id1).not.toBe(id2)
		expect(id1).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/)
	})

	test("saveSession writes JSONL", async () => {
		const path = await saveSession(TEST_SESSION_ID, testMessages)
		expect(path).toContain(TEST_SESSION_ID)
	})

	test("loadSession reads back correctly", async () => {
		const loaded = await loadSession(TEST_SESSION_ID)
		expect(loaded).not.toBeNull()
		expect(loaded!.length).toBe(4)
		expect(loaded![0].role).toBe("user")
		expect(loaded![0].content).toBe("hello")
		expect(loaded![3].content).toBe("4")
	})

	test("loadSession returns null for missing session", async () => {
		const loaded = await loadSession("nonexistent-session")
		expect(loaded).toBeNull()
	})

	test("listSessions includes our test session", async () => {
		const sessions = await listSessions()
		const found = sessions.find((s) => s.id === TEST_SESSION_ID)
		expect(found).toBeDefined()
		expect(found!.messageCount).toBe(4)
	})
})
