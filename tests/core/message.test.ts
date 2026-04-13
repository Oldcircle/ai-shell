import { describe, test, expect } from "bun:test"
import {
	createUserMessage,
	createAssistantMessage,
	createToolResultMessage,
	extractToolUses,
	extractText,
	toAPIMessages,
} from "../../src/core/message"

describe("message factories", () => {
	test("createUserMessage", () => {
		const msg = createUserMessage("hello")
		expect(msg.role).toBe("user")
		expect(msg.content).toBe("hello")
	})

	test("createAssistantMessage", () => {
		const msg = createAssistantMessage("world")
		expect(msg.role).toBe("assistant")
		expect(msg.content).toBe("world")
	})

	test("createToolResultMessage", () => {
		const msg = createToolResultMessage("tool-1", "result text")
		expect(msg.role).toBe("user")
		expect(Array.isArray(msg.content)).toBe(true)
		const blocks = msg.content as Array<{ type: string }>
		expect(blocks[0].type).toBe("tool_result")
	})

	test("createToolResultMessage with error", () => {
		const msg = createToolResultMessage("tool-1", "error!", true)
		const blocks = msg.content as Array<{ type: string; is_error?: boolean }>
		expect(blocks[0].is_error).toBe(true)
	})
})

describe("extractToolUses", () => {
	test("extracts tool_use blocks", () => {
		const msg = createAssistantMessage("text")
		// String content has no tool uses
		expect(extractToolUses(msg)).toEqual([])
	})

	test("extracts from content blocks", () => {
		const msg = {
			role: "assistant" as const,
			content: [
				{ type: "text" as const, text: "Let me read that" },
				{
					type: "tool_use" as const,
					id: "t1",
					name: "Read",
					input: { file_path: "/test" },
				},
			],
		}
		const uses = extractToolUses(msg)
		expect(uses.length).toBe(1)
		expect(uses[0].name).toBe("Read")
	})
})

describe("extractText", () => {
	test("from string content", () => {
		const msg = createAssistantMessage("hello world")
		expect(extractText(msg)).toBe("hello world")
	})

	test("from block content", () => {
		const msg = {
			role: "assistant" as const,
			content: [
				{ type: "text" as const, text: "part1" },
				{ type: "tool_use" as const, id: "t1", name: "X", input: {} },
				{ type: "text" as const, text: "part2" },
			],
		}
		expect(extractText(msg)).toBe("part1part2")
	})
})

describe("toAPIMessages", () => {
	test("converts messages", () => {
		const messages = [
			createUserMessage("hi"),
			createAssistantMessage("hello"),
		]
		const api = toAPIMessages(messages)
		expect(api.length).toBe(2)
		expect(api[0].role).toBe("user")
		expect(api[1].role).toBe("assistant")
	})
})
