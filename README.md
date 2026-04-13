<p align="center">
  <h1 align="center">⚡ AI Shell</h1>
</p>

<p align="center">
  <strong>Build your own Claude Code from scratch.</strong><br>
  A fully-featured AI coding assistant that lives in your terminal.
</p>

<p align="center">
  <a href="https://github.com/Oldcircle/ai-shell/actions"><img src="https://img.shields.io/badge/tests-89%20passed-brightgreen?style=for-the-badge" alt="Tests"></a>
  <a href="https://github.com/Oldcircle/ai-shell"><img src="https://img.shields.io/badge/TypeScript-strict-blue?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/Oldcircle/ai-shell/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=for-the-badge&logo=bun&logoColor=white" alt="Bun"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="docs/architecture.md">Docs</a> ·
  <a href="README.zh-CN.md">中文</a>
</p>

---

**If you want to understand how Claude Code works under the hood — the streaming query loop, tool execution, permission system, context management — this is the codebase to read.**

AI Shell is a from-scratch reimplementation covering every core subsystem: async generator streaming, `buildTool()` factory pattern, multi-provider abstraction, interactive permission dialogs, automatic context compaction, session persistence, and Markdown terminal rendering.

**5,590 lines of TypeScript. 89 tests. Zero dependencies on Claude Code.**

```
  ⚡ AI Shell v0.1.0 (deepseek/deepseek-chat)
  Session: 20260413-123752-l5cs | /help for commands | Ctrl+C to interrupt
  ────────────────────────────────────────────────────────────

  ❯ Create a fibonacci function in Python, test it, add a docstring

    ⚡ Write /tmp/fib.py (12 lines) ✓ 1ms
    ⚡ Bash python3 /tmp/fib.py ✓ 45ms
    ⚡ Edit /tmp/fib.py "def fibonacci(n):" ✓ 2ms
    ⚡ Read /tmp/fib.py ✓ 1ms

  Done. Created fibonacci function, tested (fib(0)=0 through fib(9)=34),
  and added docstring with Args/Returns documentation.

    deepseek-chat · 19157↑ 74↓ · $0.0586

  ❯ _
```

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) >= 1.2, [ripgrep](https://github.com/BurntSushi/ripgrep) (for Grep tool)

```bash
git clone https://github.com/Oldcircle/ai-shell.git
cd ai-shell
bun install
```

**Run with DeepSeek** (cheapest option):
```bash
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek
```

**Run with Anthropic** (Claude):
```bash
ANTHROPIC_API_KEY=sk-ant-xxx bun run dev
```

**Run with any OpenAI-compatible API** (Ollama, vLLM, Together):
```bash
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=http://localhost:11434/v1 bun run dev --provider openai
```

**Pipe mode** (for scripting):
```bash
ai-shell -p "explain this error log" < error.txt
ai-shell -p "list all TODO comments in src/"
```

### Persistent Config

Save your API key once, use `ai-shell` everywhere:

```json5
// ~/.ai-shell/config.json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "apiKeys": {
    "deepseek": "sk-xxx"
  }
}
```

Then just: `bun run dev`

---

## Features

### Highlights

- **[7 Built-in Tools](#tools)** — Read, Write, Edit, Bash, Glob, Grep, Agent — covering file operations, search, shell execution, and parallel sub-agents
- **[Multi-Provider](#providers)** — Anthropic, DeepSeek, OpenAI, Ollama through a single `Provider` interface with automatic fallback
- **[Permission System](#safety)** — Interactive `[Y]es / [N]o / [A]lways allow` dialogs for destructive operations, with dangerous command detection
- **[Context Compaction](#context-intelligence)** — Automatic conversation summarization at 80% token threshold, preserving tool call pairs
- **[Session Persistence](#session-persistence)** — JSONL auto-save with `--resume` for continuing conversations across terminal sessions
- **[Markdown Rendering](#markdown)** — Terminal-native rendering with bold, italic, code blocks, tables, lists, and blockquotes via ANSI escapes
- **[9 Slash Commands](#slash-commands)** — `/help`, `/compact`, `/cost`, `/context`, `/model`, `/history`, `/clear`, `/exit`, `/quit`
- **[Smart Edit](#tools)** — Curly quote normalization, whitespace hint on mismatch, closest-match suggestions on failure

### Tools

| Tool | Safety | Concurrent | Description |
|------|--------|------------|-------------|
| `Read` | read-only | ✓ | Read files with line numbers. Supports offset/limit for large files. |
| `Write` | destructive | — | Create or overwrite files. Auto-creates parent directories. |
| `Edit` | destructive | — | Precise string replacement. Smart quote normalization. Uniqueness check. |
| `Bash` | destructive | — | Shell execution with timeout, output cap, and dangerous command detection. |
| `Glob` | read-only | ✓ | Fast file pattern matching. Ignores `node_modules` and `.git`. |
| `Grep` | read-only | ✓ | Content search via ripgrep. Regex, glob filter, context lines. |
| `Agent` | destructive | — | Spawn independent sub-agent with its own query loop and message history. |

**Concurrency:** Read-only tools run in parallel when the LLM requests multiple at once. Destructive tools execute sequentially.

### Providers

```
┌──────────────────────────────────────────────┐
│              Provider Interface               │
│          stream() → AsyncGenerator            │
├──────────┬───────────┬───────────┬───────────┤
│ Anthropic│ DeepSeek  │  OpenAI   │  Ollama   │
│ (SDK)    │ (SSE)     │  (SSE)    │  (SSE)    │
└──────────┴───────────┴───────────┴───────────┘
```

All providers are adapted to the same `StreamEvent` interface. Swap freely with `--provider`:

```bash
ai-shell --provider deepseek    # DeepSeek API
ai-shell --provider anthropic   # Claude (default)
ai-shell --provider openai      # Any OpenAI-compatible endpoint
```

The OpenAI-compatible provider handles DeepSeek's `reasoning_content` (thinking) and JSON Schema draft-04/07 differences automatically.

### Safety

**Dangerous command detection** — Bash tool scans for 12+ high-risk patterns before execution:

```
rm -rf    git push --force    git reset --hard    sudo
dd if=    chmod -R 777        dropdb              mkfs
kill -9   git branch -D       git checkout --     pkill
```

When detected, the permission dialog appears:

```
┌─────────────────────────────────────────────┐
│ ? Bash wants to execute:                    │
│   $ rm -rf /tmp/test-dir                    │
│                                             │
│   [Y]es / [N]o / [A]lways allow             │
└─────────────────────────────────────────────┘
```

- **Read-only tools** (Read, Glob, Grep) — auto-approved, no prompt
- **Always allow** — remembered per tool for the session
- **`GIT_TERMINAL_PROMPT=0`** — prevents git from hanging on auth prompts

### Context Intelligence

```
❯ /context
Context Window: deepseek-chat
  [===============               ]
  25,600 / 64,000 tokens (40.0%)
  Auto-compact at: 51,200 tokens (80%)
  Messages: 42
```

- **CLAUDE.md auto-discovery** — walks CWD → parent → root, loads `CLAUDE.md` and `AGENTS.md`, checks `.claude/` subdirectories, loads global `~/.claude/CLAUDE.md`
- **Git status injection** — current branch, main branch name, working tree changes, 5 recent commits
- **Auto-compaction** — when conversation hits 80% of the model's context window, old messages are summarized by the LLM. Tool use/result pairs are never split.
- **Token estimation** — adaptive for CJK (1.5 chars/token) and Latin (3.8 chars/token) text

### Session Persistence

Conversations are auto-saved as JSONL to `~/.ai-shell/sessions/`:

```bash
# List recent sessions
ai-shell   # then type /history

# Resume a session
ai-shell --resume 20260413-123752-l5cs
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands and keyboard shortcuts |
| `/clear` | Reset conversation history |
| `/compact` | Manually compress conversation to free context space |
| `/cost` | Token usage breakdown (input, output, cache, cost) |
| `/context` | Context window usage with visual progress bar |
| `/model` | Show current model or switch (`/model deepseek-reasoner`) |
| `/history` | List saved sessions with message counts |
| `/exit` | Exit AI Shell |

**Keyboard shortcuts:** `Ctrl+C` interrupt request · `↑↓` browse history · `Ctrl+U` clear line

---

## Architecture

```
User Input
    │
    ├─ /command? ──→ Execute locally (commands.ts)
    │
    ├─ Auto-compact? ──→ LLM summarizes old messages (compact.ts)
    │
    └─ Query Loop (query.ts)
         │
         ├─ Provider.stream() ──→ Streaming SSE response
         │
         ├─ tool_use? ──→ Permission check (permissions.ts)
         │                    │
         │                    ├─ allow ──→ Zod validate → Tool.call()
         │                    ├─ ask ──→ Dialog (Y/N/A)
         │                    └─ deny ──→ Error to LLM
         │
         ├─ tool_result ──→ Merge into user message → Continue loop
         │
         └─ end_turn ──→ Render (markdown.ts) + Auto-save (session.ts)
```

### Core Modules

| Module | Lines | Role |
|--------|------:|------|
| `query.ts` | 340 | Async generator query loop — streaming, tool execution, parallel dispatch |
| `context.ts` | 210 | System prompt assembly — role, tools, git, CLAUDE.md, environment |
| `core/tool.ts` | 200 | `Tool` interface, `buildTool()` factory, JSON Schema sanitization |
| `core/compact.ts` | 250 | Context compaction — LLM summarization, tool pair preservation |
| `core/commands.ts` | 260 | Slash command registry and handlers |
| `core/permissions.ts` | 140 | Three-mode permission system (default / bypass / deny) |
| `providers/openai-compatible.ts` | 400 | SSE stream parser for DeepSeek/OpenAI/Ollama |
| `providers/anthropic.ts` | 180 | Anthropic SDK streaming adapter |
| `repl.ts` | 220 | Readline REPL with inline tool display |
| `utils/markdown.ts` | 220 | `marked` lexer → ANSI terminal renderer |
| `utils/tokens.ts` | 86 | Token estimation with CJK-aware counting |
| `utils/retry.ts` | 89 | Exponential backoff (429/5xx auto-retry) |

### Design Principles

1. **Streaming-first** — async generators at every layer, interruptible via AbortController
2. **Fail-closed security** — tools default to `isConcurrencySafe: false`, `isReadOnly: false`; permission check required
3. **Type-safe tools** — Zod schemas for runtime validation, auto-sanitized to JSON Schema draft-07 for API compatibility
4. **Provider-agnostic** — single `Provider` interface; all API differences absorbed in the adapter layer

---

## Development

```bash
bun run dev          # Run in dev mode (bun run src/cli.tsx)
bun test             # 89 tests across 13 files
bun run typecheck    # TypeScript strict, zero errors
bun run lint         # Biome lint
bun run format       # Biome format
```

### Adding a New Tool

```typescript
// src/tools/my-tool.ts
import { z } from "zod"
import { buildTool } from "../core/tool"

export const MyTool = buildTool({
  name: "MyTool",
  description: "What this tool does and when to use it",
  inputSchema: z.object({
    param: z.string().describe("Description for the LLM"),
  }),
  isReadOnly: () => true,        // safe defaults
  isConcurrencySafe: () => true,  // can run in parallel

  async call(input, context) {
    // implement
    return { content: "result" }
  },
})
```

Register in `src/core/tools.ts`, done.

### Adding a New Provider

Implement the `Provider` interface — the key method is `stream()` which converts your API's response format into the unified `StreamEvent` async generator.

---

## Project Stats

```
34 source files  ·  5,590 lines of code
13 test files    ·    971 lines of tests
89 unit tests    ·  0 failures
 + expect integration tests (REPL startup → commands → AI chat → tools → exit)
```

## Acknowledgments

Architecture inspired by studying [Claude Code](https://claude.ai/code) by Anthropic. Reference implementation: [claude-code-best](https://github.com/claude-code-best/claude-code). Built entirely from scratch — no code was copied.

## License

[MIT](LICENSE) — do whatever you want.
