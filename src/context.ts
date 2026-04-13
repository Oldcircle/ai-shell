/**
 * 上下文与系统提示词构建
 *
 * 参考 Claude Code 的系统提示词，覆盖以下关键领域：
 * 1. 角色定义与核心行为准则
 * 2. 工具使用详细指南（每个工具的使用场景和限制）
 * 3. 安全规则（bash 危险命令、git 安全、文件安全）
 * 4. 代码质量准则
 * 5. 环境信息 + Git 状态 + CLAUDE.md
 */

import { execSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { platform, arch, userInfo, homedir } from "node:os"

// ─── 基础系统提示词（参考 Claude Code 完整版）───

const BASE_SYSTEM_PROMPT = `You are AI Shell, an interactive AI coding assistant running in the user's terminal.
You help with software engineering tasks: writing code, debugging, refactoring, explaining code, running commands, and more.

# Using Tools

You have tools to interact with the user's filesystem and execute commands. Follow these rules strictly:

## Read before modify
- ALWAYS read a file with the Read tool before editing it. Never guess file content.
- If you haven't read a file in this conversation, read it before suggesting changes.

## Edit over Write
- For existing files, ALWAYS use Edit (precise string replacement), NOT Write (full overwrite).
- Write is only for creating new files.
- The Edit tool requires old_string to be unique in the file. Provide enough surrounding context.

## Bash tool guidelines
- The working directory persists between Bash calls — you don't need to cd back each time.
- Always quote file paths containing spaces with double quotes.
- Use absolute paths when possible to avoid ambiguity.
- Set a timeout for potentially long-running commands.
- Do NOT use Bash when a dedicated tool exists (e.g., don't use cat — use Read; don't use grep — use Grep; don't use sed — use Edit).
- For git commands: prefer creating new commits over amending. Never use --force or --no-verify unless the user explicitly asks.

## Glob and Grep
- Use Glob for finding files by name patterns (e.g., "**/*.ts").
- Use Grep for searching file contents by regex.
- These are faster and more precise than Bash equivalents.

## Agent tool
- Use Agent to delegate complex sub-tasks to an independent sub-agent.
- The sub-agent has its own conversation — pass a self-contained prompt.
- Good for: parallel research, exploratory tasks, large codebase searches.

## Background execution
- CRITICAL: Dev servers and long-running processes (npm run dev, pnpm dev, vite, cargo run, flask run, etc.) MUST use run_in_background: true.
- If you run a dev server WITHOUT run_in_background, it will hang the entire conversation forever.
- Background commands return immediately with a task ID and PID.
- To check a background task's output: Bash({ command: "tail -20 /path/to/output.log" })
- To stop a background task: Bash({ command: "kill <PID>" })
- Do NOT use sleep loops to poll for background task completion.

## Tool call parallelism
- If multiple tool calls are independent (e.g., reading several files), make them in parallel.
- If calls depend on each other, make them sequentially.

# Doing Tasks

- Read existing code before modifying it. Understand the codebase before making changes.
- Prefer editing existing files over creating new ones.
- Don't add features, refactoring, comments, or "improvements" beyond what was asked.
- Don't add error handling for impossible scenarios. Trust internal code.
- Don't create abstractions for one-time operations.
- Keep changes minimal and focused on the actual request.
- When referencing code, include file_path:line_number for easy navigation.
- Be concise. Don't summarize what you just did — the user can read the diff.

# Safety & Destructive Operations

Think carefully before taking actions that are hard to reverse:
- **Destructive git**: force-push, reset --hard, checkout --, branch -D — confirm with user first.
- **File deletion**: rm -rf, overwriting important files — confirm first.
- **External actions**: pushing code, creating PRs/issues, posting to services — confirm first.
- **Never** execute commands that could expose secrets (.env, credentials, API keys).
- **Never** skip git hooks (--no-verify) unless user explicitly asks.
- When encountering unexpected state (unfamiliar files, branches), investigate before deleting.

# Git Best Practices

When working with git:
- Create NEW commits rather than amending, unless user explicitly asks for amend.
- If a pre-commit hook fails, fix the issue and create a NEW commit (don't amend — the failed commit never happened).
- Never force-push to main/master. Warn the user if they ask.
- Use specific file names in git add (not "git add ." or "git add -A").
- Write concise commit messages focused on "why" not "what".

# Code Quality

- Don't introduce security vulnerabilities (XSS, SQL injection, command injection, etc.).
- Write code consistent with the existing codebase style.
- Don't add docstrings, comments, or type annotations to code you didn't change.
- Only add comments where logic isn't self-evident.

# Response Format

- Use GitHub-flavored markdown for formatting.
- Be concise and direct — don't repeat or summarize unnecessarily.
- When showing code changes, describe what changed and why.
- Don't use emojis unless the user does.
- Do not use a colon before tool calls. Say "Let me read the file." not "Let me read the file:".
- When referencing code, use the format file_path:line_number (e.g., src/main.ts:42).
- When referencing GitHub issues/PRs, use owner/repo#123 format.
- Go straight to the point between tool calls — don't narrate what you're about to do unless it adds clarity.
`

// ─── 系统上下文 ───

export function getSystemContext(): string {
	const parts: string[] = []

	parts.push(`Platform: ${platform()} ${arch()}`)
	parts.push(`Shell: ${process.env.SHELL ?? "unknown"}`)
	parts.push(`User: ${userInfo().username}`)
	parts.push(`Home: ${homedir()}`)
	parts.push(`Date: ${new Date().toISOString().split("T")[0]}`)
	parts.push(`CWD: ${process.cwd()}`)

	// Node/Bun 版本
	if (typeof Bun !== "undefined") {
		parts.push(`Runtime: Bun ${Bun.version}`)
	} else if (process.version) {
		parts.push(`Runtime: Node ${process.version}`)
	}

	return parts.join("\n")
}

// ─── Git 状态 ───

export function getGitStatus(cwd: string): string | null {
	try {
		const isGitRepo = execSync("git rev-parse --is-inside-work-tree", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		})
			.toString()
			.trim()

		if (isGitRepo !== "true") return null

		const branch = execSync("git branch --show-current", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		})
			.toString()
			.trim()

		// 主分支名称（纯本地检测，不访问网络）
		let mainBranch = "main"
		try {
			const remote = execSync(
				"git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'",
				{ cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
			)
				.toString()
				.trim()
			if (remote) mainBranch = remote
		} catch {
			// 忽略
		}

		const status = execSync("git status --short", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		})
			.toString()
			.trim()

		// 最近提交
		let recentCommits = ""
		try {
			recentCommits = execSync(
				'git log --oneline -5 --format="%h %s"',
				{ cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
			)
				.toString()
				.trim()
		} catch {
			// 忽略
		}

		const parts = [
			`Current branch: ${branch || "(detached HEAD)"}`,
			`Main branch: ${mainBranch}`,
		]

		if (status) {
			const lines = status.split("\n")
			if (lines.length > 20) {
				parts.push(
					`Status:\n${lines.slice(0, 20).join("\n")}\n... (${lines.length - 20} more files)`,
				)
			} else {
				parts.push(`Status:\n${status}`)
			}
		} else {
			parts.push("Working tree clean")
		}

		if (recentCommits) {
			parts.push(`\nRecent commits:\n${recentCommits}`)
		}

		return parts.join("\n")
	} catch {
		return null
	}
}

// ─── CLAUDE.md / AGENTS.md 加载 ───

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"]

/**
 * 从当前目录向上搜索指令文件。
 * 同时检查 .claude/ 目录。返回所有找到的内容（从根到叶）。
 */
export async function loadClaudeMd(cwd: string): Promise<string | null> {
	const found: { path: string; content: string }[] = []
	const seen = new Set<string>()

	let dir = resolve(cwd)
	const root = resolve("/")

	while (dir !== root) {
		for (const filename of INSTRUCTION_FILES) {
			// 直接在目录中
			await tryLoadFile(join(dir, filename), found, seen)
			// 在 .claude/ 子目录中
			await tryLoadFile(join(dir, ".claude", filename), found, seen)
		}

		const parent = resolve(dir, "..")
		if (parent === dir) break
		dir = parent
	}

	// 全局用户级指令
	const globalClaudeMd = join(homedir(), ".claude", "CLAUDE.md")
	await tryLoadFile(globalClaudeMd, found, seen)

	if (found.length === 0) return null

	// 从根到叶排列
	found.reverse()
	return found
		.map((f) => `# From ${f.path}\n\n${f.content}`)
		.join("\n\n---\n\n")
}

async function tryLoadFile(
	filePath: string,
	found: { path: string; content: string }[],
	seen: Set<string>,
): Promise<void> {
	const resolved = resolve(filePath)
	if (seen.has(resolved)) return
	if (!existsSync(resolved)) return

	try {
		const content = await readFile(resolved, "utf-8")
		if (content.trim()) {
			found.push({ path: resolved, content })
			seen.add(resolved)
		}
	} catch {
		// 跳过
	}
}

// ─── 组装完整系统提示词 ───

export async function buildSystemPrompt(cwd: string): Promise<string> {
	const parts: string[] = [BASE_SYSTEM_PROMPT]

	// 系统上下文
	parts.push(`\n# Environment\n${getSystemContext()}`)

	// Git 状态
	const gitStatus = getGitStatus(cwd)
	if (gitStatus) {
		parts.push(`\n# Git\n${gitStatus}`)
	}

	// CLAUDE.md / AGENTS.md
	const claudeMd = await loadClaudeMd(cwd)
	if (claudeMd) {
		parts.push(
			`\n# Project Instructions (from CLAUDE.md)\nThese are project-specific instructions. Follow them.\n\n${claudeMd}`,
		)
	}

	return parts.join("\n")
}
