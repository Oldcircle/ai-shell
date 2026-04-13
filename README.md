# AI Shell

> **Build your own Claude Code from scratch.** A fully-featured AI coding assistant that lives in your terminal.

```
  AI Shell v0.1.0 (deepseek/deepseek-chat)
  Session: 20260413-123752-l5cs | /help for commands | Ctrl+C to interrupt
  ────────────────────────────────────────────────────────────

  ❯ Read package.json and tell me the project name
    ⚡ Read /Users/me/project/package.json ✓ 2ms
  The project name is **ai-shell**.

    deepseek-chat · 10285↑ 62↓ · $0.0318

  ❯ 
```

## Why AI Shell?

Claude Code is a phenomenal tool — but it's closed-source. AI Shell is a **from-scratch reimplementation** that helps you understand how AI coding assistants actually work under the hood:

- **Async generator query loop** — streaming responses with tool execution cycles
- **`buildTool()` factory pattern** — type-safe tool definitions with fail-closed defaults
- **Provider abstraction** — Anthropic, DeepSeek, OpenAI, Ollama with one interface
- **Permission system** — interactive Y/N/A approval dialogs for destructive operations
- **Context compaction** — automatic conversation summarization at 80% token threshold

**5,590 lines of TypeScript. 89 tests. Zero dependencies on Claude Code.**

## Features

### 7 Built-in Tools

| Tool | Type | Description |
|------|------|-------------|
| `Read` | Read-only | Read files with line numbers, offset, and limit |
| `Write` | Destructive | Create or overwrite files |
| `Edit` | Destructive | Precise string replacement with smart quote normalization |
| `Bash` | Destructive | Execute shell commands with security checks |
| `Glob` | Read-only | Fast file pattern matching |
| `Grep` | Read-only | Content search via ripgrep |
| `Agent` | Destructive | Spawn independent sub-agents for parallel tasks |

### 9 Slash Commands

```
/help      Show available commands
/clear     Clear conversation history
/compact   Compress conversation to free context space
/cost      Show token usage and cost breakdown
/context   Show context window usage with progress bar
/model     Show or switch models at runtime
/history   List saved sessions
/exit      Exit AI Shell
/quit      Alias for /exit
```

### Multi-Provider Support

```bash
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-xxx ai-shell

# DeepSeek
DEEPSEEK_API_KEY=sk-xxx ai-shell --provider deepseek

# OpenAI / Ollama / any OpenAI-compatible API
OPENAI_API_KEY=sk-xxx OPENAI_BASE_URL=http://localhost:11434/v1 ai-shell --provider openai
```

### Safety & Permissions

- **Dangerous command detection** — `rm -rf`, `git push --force`, `sudo`, `dd`, etc.
- **Interactive permission dialogs** — `[Y]es / [N]o / [A]lways allow`
- **Read-only tools auto-approved** — no prompts for Read, Glob, Grep
- **Session-level caching** — "Always allow" remembers your choice

### Context Intelligence

- **CLAUDE.md auto-discovery** — walks from CWD up to root, loads project instructions
- **Git status injection** — branch, changes, recent commits in system prompt
- **Auto-compaction** — summarizes old messages when hitting 80% of context window
- **Token estimation** — adaptive CJK/Latin character counting

### Session Persistence

- **Auto-save** — conversations saved as JSONL in `~/.ai-shell/sessions/`
- **Resume** — `ai-shell --resume <session-id>` picks up where you left off
- **Config file** — `~/.ai-shell/config.json` for default provider, model, API keys

## Quick Start

```bash
# Prerequisites: Bun >= 1.2, ripgrep (for Grep tool)
git clone https://github.com/Oldcircle/ai-shell.git
cd ai-shell
bun install

# Interactive mode
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek

# Pipe mode (for scripting)
echo "explain this error" | DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek -p

# Single prompt
DEEPSEEK_API_KEY=sk-xxx bun run dev --provider deepseek -p "list all TODO comments"
```

## Architecture

```
User Input → Slash Command? → Execute locally (/help, /compact, /cost...)
                ↓ no
           Auto-Compact? → LLM summarizes old messages
                ↓
           Query Loop → Provider.stream() → Streaming response
                ↓ tool_use?
           Permission Check → Ask? → Dialog (Y/N/A)
                ↓ allow
           Zod Validate → Tool.call() → Result → Continue loop
                ↓ end_turn
           Render (Markdown) + Auto-save JSONL
```

### Core Modules

| Module | Lines | Description |
|--------|-------|-------------|
| `query.ts` | 340 | Async generator query loop with tool execution |
| `context.ts` | 210 | System prompt builder (role + tools + git + CLAUDE.md) |
| `core/tool.ts` | 200 | Tool interface + `buildTool()` factory + schema sanitization |
| `core/compact.ts` | 250 | Context compaction with LLM summarization |
| `core/commands.ts` | 260 | Slash command system |
| `providers/openai-compatible.ts` | 400 | OpenAI/DeepSeek/Ollama adapter with SSE parsing |
| `providers/anthropic.ts` | 180 | Anthropic SDK streaming adapter |
| `repl.ts` | 220 | Readline REPL with tool display |
| `utils/markdown.ts` | 220 | Markdown → ANSI terminal renderer |

### Design Principles

1. **Streaming-first** — async generators everywhere, interruptible responses
2. **Fail-closed security** — tools default to non-concurrent, non-readonly, require permission
3. **Type-safe tools** — Zod schemas validated at runtime, JSON Schema sanitized for API compatibility
4. **Provider-agnostic** — one interface, swap Anthropic/DeepSeek/OpenAI/Ollama freely

## Development

```bash
bun run dev          # Run in dev mode
bun test             # Run 89 tests
bun run typecheck    # TypeScript strict check
bun run lint         # Biome lint
bun run format       # Biome format
```

## Project Stats

```
34 source files  ·  5,590 lines of code
13 test files    ·    971 lines of tests
89 tests         ·  0 failures
```

## Acknowledgments

Architecture inspired by studying [Claude Code](https://claude.ai/code) by Anthropic. Built from scratch as a learning project — no code was copied.

## License

MIT
