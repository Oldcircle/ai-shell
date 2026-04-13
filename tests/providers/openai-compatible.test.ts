import { describe, test, expect } from "bun:test"
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible"

describe("OpenAI Compatible Provider", () => {
	test("creates provider with config", () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: "test-key",
			baseUrl: "https://api.example.com",
			model: "test-model",
			name: "test",
		})
		expect(provider.name).toBe("test")
		expect(provider.isAvailable()).toBe(true)
	})

	test("unavailable without config", () => {
		// 临时清除环境变量
		const saved = {
			deepseek: process.env.DEEPSEEK_API_KEY,
			openai: process.env.OPENAI_API_KEY,
		}
		delete process.env.DEEPSEEK_API_KEY
		delete process.env.OPENAI_API_KEY

		const provider = createOpenAICompatibleProvider()
		expect(provider.isAvailable()).toBe(false)

		// 恢复
		if (saved.deepseek) process.env.DEEPSEEK_API_KEY = saved.deepseek
		if (saved.openai) process.env.OPENAI_API_KEY = saved.openai
	})

	test("max output tokens returns default", () => {
		const provider = createOpenAICompatibleProvider({
			apiKey: "k",
			baseUrl: "u",
			model: "m",
			name: "n",
		})
		expect(provider.getMaxOutputTokens("any")).toBe(8192)
	})
})
