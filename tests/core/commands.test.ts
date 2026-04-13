import { describe, test, expect } from "bun:test"
import { isCommand, executeCommand, type CommandContext } from "../../src/core/commands"
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible"

const mockContext: CommandContext = {
	messages: [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: "hi" },
	],
	model: "test-model",
	provider: createOpenAICompatibleProvider({
		apiKey: "test",
		baseUrl: "http://localhost",
		model: "test",
		name: "test",
	}),
	usage: { inputTokens: 1000, outputTokens: 500 },
	cost: 0.05,
	cwd: "/tmp",
}

describe("isCommand", () => {
	test("detects slash commands", () => {
		expect(isCommand("/help")).toBe(true)
		expect(isCommand("/clear")).toBe(true)
		expect(isCommand("/exit")).toBe(true)
	})

	test("rejects non-commands", () => {
		expect(isCommand("hello")).toBe(false)
		expect(isCommand("")).toBe(false)
		expect(isCommand("/")).toBe(false)
	})
})

describe("executeCommand", () => {
	test("/help lists commands", async () => {
		const result = await executeCommand("/help", mockContext)
		expect(result.output).toContain("Available commands")
		expect(result.output).toContain("/help")
		expect(result.output).toContain("/compact")
	})

	test("/clear resets messages", async () => {
		const result = await executeCommand("/clear", mockContext)
		expect(result.newMessages).toEqual([])
		expect(result.output).toContain("cleared")
	})

	test("/cost shows usage", async () => {
		const result = await executeCommand("/cost", mockContext)
		expect(result.output).toContain("1,000")
		expect(result.output).toContain("500")
		expect(result.output).toContain("$0.0500")
	})

	test("/context shows window info", async () => {
		const result = await executeCommand("/context", mockContext)
		expect(result.output).toContain("Context Window")
		expect(result.output).toContain("Messages: 2")
	})

	test("/model shows current model", async () => {
		const result = await executeCommand("/model", mockContext)
		expect(result.output).toContain("test-model")
	})

	test("/exit sets exit flag", async () => {
		const result = await executeCommand("/exit", mockContext)
		expect(result.exit).toBe(true)
	})

	test("unknown command shows error", async () => {
		const result = await executeCommand("/foobar", mockContext)
		expect(result.output).toContain("Unknown command")
	})
})
