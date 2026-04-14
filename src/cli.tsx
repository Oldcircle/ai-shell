#!/usr/bin/env bun
/**
 * AI Shell — CLI 入口
 *
 * 运行模式：
 * 1. 交互模式（默认）：启动 Ink REPL
 * 2. 管道模式（-p）：读取 stdin，输出到 stdout
 *
 * Provider 选择：
 * - 默认：Anthropic（需要 ANTHROPIC_API_KEY）
 * - --provider deepseek：DeepSeek（需要 DEEPSEEK_API_KEY）
 * - --provider openai：OpenAI 兼容（需要 OPENAI_API_KEY）
 */

import { Command } from "commander"
import { createAnthropicProvider } from "./providers/anthropic"
import { createOpenAICompatibleProvider } from "./providers/openai-compatible"
import type { Provider } from "./providers/types"
import { getEnabledTools, buildToolSet } from "./core/tools"
import { buildSystemPrompt } from "./context"
import { loadConfig, applyApiKeys } from "./config/settings"
import { query } from "./query"
import { createUserMessage, type Message } from "./core/message"
import { loadSession } from "./config/session"

const VERSION = "0.1.0"

function createProvider(providerName: string): { provider: Provider; model: string } {
	switch (providerName) {
		case "deepseek": {
			const provider = createOpenAICompatibleProvider({
				apiKey: process.env.DEEPSEEK_API_KEY ?? "",
				baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
				model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
				name: "deepseek",
			})
			if (!provider.isAvailable()) {
				console.error("Error: DEEPSEEK_API_KEY is required for DeepSeek provider.")
				process.exit(1)
			}
			return { provider, model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat" }
		}
		case "openai": {
			const provider = createOpenAICompatibleProvider()
			if (!provider.isAvailable()) {
				console.error("Error: OPENAI_API_KEY is required for OpenAI provider.")
				process.exit(1)
			}
			return { provider, model: process.env.OPENAI_MODEL ?? "gpt-4o" }
		}
		case "anthropic":
		default: {
			if (!process.env.ANTHROPIC_API_KEY) {
				// 自动降级到其他可用 provider
				if (process.env.DEEPSEEK_API_KEY) {
					console.error(
						"[info] ANTHROPIC_API_KEY not set, falling back to DeepSeek provider.",
					)
					return createProvider("deepseek")
				}
				if (process.env.OPENAI_API_KEY) {
					console.error(
						"[info] ANTHROPIC_API_KEY not set, falling back to OpenAI provider.",
					)
					return createProvider("openai")
				}
				console.error(
					"\n  ⚠  No API key found.\n\n" +
						"  Set one of these environment variables:\n\n" +
						"    \x1b[36mANTHROPIC_API_KEY\x1b[0m   Get one at https://console.anthropic.com\n" +
						"    \x1b[36mDEEPSEEK_API_KEY\x1b[0m    Get one at https://platform.deepseek.com\n" +
						"    \x1b[36mOPENAI_API_KEY\x1b[0m      Get one at https://platform.openai.com\n\n" +
						"  Quick start with DeepSeek (cheapest):\n\n" +
						"    export DEEPSEEK_API_KEY=sk-...\n" +
						"    ai-shell\n\n" +
						"  Or save it permanently in \x1b[36m~/.ai-shell/config.json\x1b[0m:\n\n" +
						'    {"provider":"deepseek","apiKeys":{"deepseek":"sk-..."}}\n',
				)
				process.exit(1)
			}
			const provider = createAnthropicProvider()
			return { provider, model: "claude-sonnet-4-20250514" }
		}
	}
}

const program = new Command()
	.name("ai-shell")
	.description("AI coding assistant in your terminal")
	.version(VERSION)
	.option("-m, --model <model>", "Override model name")
	.option(
		"--provider <name>",
		"API provider: anthropic, deepseek, openai",
		"anthropic",
	)
	.option("-p, --pipe", "Pipe mode: read from stdin, write to stdout")
	.option("--system <prompt>", "Override system prompt")
	.option("--no-tools", "Disable tools")
	.option("--resume <sessionId>", "Resume a previous session")
	.option("-v, --verbose", "Verbose output")
	.argument("[prompt]", "Initial prompt (non-interactive if provided with -p)")
	.action(async (promptArg, options) => {
		const cwd = process.cwd()

		// 加载配置并应用 API keys
		const config = await loadConfig(cwd)
		applyApiKeys(config)

		const providerName = options.provider ?? config.provider ?? "anthropic"
		const { provider, model: defaultModel } = createProvider(providerName)
		const model = options.model ?? config.model ?? defaultModel
		const tools = options.tools === false ? [] : buildToolSet(provider, model)
		const systemPrompt = options.system ?? (await buildSystemPrompt(cwd))

		if (options.verbose) {
			console.error(`[info] Provider: ${provider.name}, Model: ${model}`)
			console.error(`[info] Tools: ${tools.map((t) => t.name).join(", ")}`)
		}

		// ─── 管道模式（显式 -p 或 stdin 非 TTY）───
		if (options.pipe || !process.stdin.isTTY) {
			const input = promptArg ?? (await readStdin())
			if (!input) {
				console.error("No input provided. Use -p flag with a prompt or pipe text via stdin.")
				process.exit(1)
			}

			await runPipeMode({ provider, model, systemPrompt, tools, cwd, input })
			return
		}

		// ─── 恢复会话 ───
		let resumeMessages: Message[] | undefined
		if (options.resume) {
			const loaded = await loadSession(options.resume)
			if (!loaded) {
				console.error(`Session not found: ${options.resume}`)
				process.exit(1)
			}
			resumeMessages = loaded
			console.error(`[info] Resumed session: ${options.resume} (${loaded.length} messages)`)
		}

		// ─── 交互模式 ───
		// 使用 readline REPL（稳定、兼容所有终端）
		const { startRepl } = await import("./repl")
		await startRepl({
			provider,
			model,
			systemPrompt,
			tools,
			cwd,
			resumeMessages,
		})
	})

program.parse()

// ─── 辅助函数 ───

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of process.stdin) {
		chunks.push(chunk)
	}
	return Buffer.concat(chunks).toString("utf-8").trim()
}

interface PipeModeParams {
	provider: Provider
	model: string
	systemPrompt: string
	tools: readonly ReturnType<typeof getEnabledTools>[number][]
	cwd: string
	input: string
}

async function runPipeMode(params: PipeModeParams) {
	const events = query({
		provider: params.provider,
		model: params.model,
		systemPrompt: params.systemPrompt,
		messages: [createUserMessage(params.input)],
		tools: params.tools,
		toolContext: { cwd: params.cwd, readFiles: new Set() },
	})

	for await (const event of events) {
		switch (event.type) {
			case "text":
				process.stdout.write(event.text)
				break
			case "tool_start":
				process.stderr.write(`\n[${event.toolName}] `)
				break
			case "tool_end":
				if (event.result.isError) {
					process.stderr.write(`ERROR: ${event.result.content.slice(0, 100)}\n`)
				} else {
					process.stderr.write("done\n")
				}
				break
			case "error":
				console.error(`\nError: ${event.error.message}`)
				process.exit(1)
				break
			case "done":
				process.stdout.write("\n")
				break
		}
	}
}
