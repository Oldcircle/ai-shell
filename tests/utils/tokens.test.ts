import { describe, test, expect } from "bun:test"
import {
	estimateTokens,
	estimateMessageTokens,
	estimateTotalTokens,
	getContextWindow,
	getCompactThreshold,
	shouldCompact,
} from "../../src/utils/tokens"
import type { Message } from "../../src/core/message"

describe("estimateTokens", () => {
	test("empty string returns 0", () => {
		expect(estimateTokens("")).toBe(0)
	})

	test("short English text", () => {
		const tokens = estimateTokens("Hello, world!")
		expect(tokens).toBeGreaterThan(1)
		expect(tokens).toBeLessThan(10)
	})

	test("Chinese text gives higher token density", () => {
		const en = estimateTokens("Hello world, how are you today?")
		const zh = estimateTokens("你好世界，今天怎么样？")
		// Chinese should have more tokens per character
		const enRatio = en / "Hello world, how are you today?".length
		const zhRatio = zh / "你好世界，今天怎么样？".length
		expect(zhRatio).toBeGreaterThan(enRatio)
	})

	test("code text", () => {
		const tokens = estimateTokens('function hello() { return "world"; }')
		expect(tokens).toBeGreaterThan(5)
	})
})

describe("estimateMessageTokens", () => {
	test("simple text message", () => {
		const msg: Message = { role: "user", content: "Hello!" }
		const tokens = estimateMessageTokens(msg)
		expect(tokens).toBeGreaterThan(4) // at least role overhead
	})

	test("message with blocks", () => {
		const msg: Message = {
			role: "assistant",
			content: [
				{ type: "text", text: "Let me read that file." },
				{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/test.txt" } },
			],
		}
		const tokens = estimateMessageTokens(msg)
		expect(tokens).toBeGreaterThan(10)
	})
})

describe("estimateTotalTokens", () => {
	test("sums all messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there!" },
			{ role: "user", content: "How are you?" },
		]
		const total = estimateTotalTokens(messages)
		expect(total).toBeGreaterThan(12) // 3 messages × 4 role tokens minimum
	})
})

describe("context window", () => {
	test("known model returns correct window", () => {
		expect(getContextWindow("deepseek-chat")).toBe(64_000)
	})

	test("unknown model returns default", () => {
		expect(getContextWindow("unknown-model")).toBe(64_000)
	})

	test("compact threshold is 80% of window", () => {
		const window = getContextWindow("deepseek-chat")
		const threshold = getCompactThreshold("deepseek-chat")
		expect(threshold).toBe(Math.floor(window * 0.8))
	})
})

describe("shouldCompact", () => {
	test("returns false for short conversations", () => {
		const messages: Message[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi!" },
		]
		expect(shouldCompact(messages, "deepseek-chat")).toBe(false)
	})

	test("returns true for very long conversations", () => {
		// Generate a very long conversation
		const messages: Message[] = []
		for (let i = 0; i < 1000; i++) {
			messages.push({ role: "user", content: "x".repeat(500) })
			messages.push({ role: "assistant", content: "y".repeat(500) })
		}
		// This should be well over any threshold
		expect(shouldCompact(messages, "deepseek-chat")).toBe(true)
	})
})
