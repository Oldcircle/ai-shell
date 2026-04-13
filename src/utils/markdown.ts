/**
 * Markdown → 终端 ANSI 渲染
 *
 * 使用 marked lexer 解析 markdown tokens，然后自定义渲染为带 ANSI 颜色的终端文本。
 * 参考 Claude Code 的模式：不用 HTML 输出，而是递归遍历 token 树生成终端格式。
 */

import { Lexer, type Token, type Tokens } from "marked"
import chalk from "chalk"

let highlightFn: ((code: string, options: { language?: string }) => string) | null = null

// 延迟加载 cli-highlight（可能失败）
async function getHighlight() {
	if (highlightFn !== null) return highlightFn
	try {
		const mod = await import("cli-highlight")
		highlightFn = mod.highlight
	} catch {
		highlightFn = (code: string) => code
	}
	return highlightFn
}

/** 将 markdown 文本渲染为终端 ANSI 字符串 */
export function renderMarkdown(text: string): string {
	const lexer = new Lexer()
	const tokens = lexer.lex(text)
	return renderTokens(tokens)
}

function renderTokens(tokens: Token[]): string {
	return tokens.map(renderToken).join("")
}

function renderToken(token: Token): string {
	switch (token.type) {
		case "heading":
			return renderHeading(token as Tokens.Heading)
		case "paragraph":
			return renderParagraph(token as Tokens.Paragraph)
		case "code":
			return renderCode(token as Tokens.Code)
		case "blockquote":
			return renderBlockquote(token as Tokens.Blockquote)
		case "list":
			return renderList(token as Tokens.List)
		case "list_item":
			return renderListItem(token as Tokens.ListItem)
		case "table":
			return renderTable(token as Tokens.Table)
		case "hr":
			return `${chalk.dim("─".repeat(40))}\n`
		case "space":
			return "\n"
		case "text":
			return renderInlineText(token as Tokens.Text)
		case "html":
			return (token as Tokens.HTML).text
		default:
			// 未知 token 类型，原样返回
			if ("text" in token && typeof token.text === "string") {
				return token.text
			}
			if ("raw" in token && typeof token.raw === "string") {
				return token.raw
			}
			return ""
	}
}

// ─── Block Renderers ───

function renderHeading(token: Tokens.Heading): string {
	const text = renderInline(token.tokens)
	switch (token.depth) {
		case 1:
			return `\n${chalk.bold.underline(text)}\n\n`
		case 2:
			return `\n${chalk.bold(text)}\n\n`
		case 3:
			return `\n${chalk.bold.dim(text)}\n\n`
		default:
			return `${chalk.bold(text)}\n\n`
	}
}

function renderParagraph(token: Tokens.Paragraph): string {
	const text = renderInline(token.tokens)
	return `${text}\n\n`
}

function renderCode(token: Tokens.Code): string {
	const lang = token.lang ?? ""
	const header = lang ? chalk.dim(`  ${lang}`) : ""
	const border = chalk.dim("  │ ")

	const lines = token.text.split("\n")
	const formatted = lines.map((line) => `${border}${line}`).join("\n")

	return `${header ? `${header}\n` : ""}${formatted}\n\n`
}

function renderBlockquote(token: Tokens.Blockquote): string {
	const inner = renderTokens(token.tokens)
	const lines = inner.trimEnd().split("\n")
	const formatted = lines
		.map((line) => `${chalk.dim("  │")} ${chalk.italic(line)}`)
		.join("\n")
	return `${formatted}\n\n`
}

function renderList(token: Tokens.List): string {
	const items = token.items.map((item, i) => {
		const marker = token.ordered
			? chalk.dim(`${Number(token.start ?? 1) + i}. `)
			: chalk.dim("  • ")
		const content = renderTokens(item.tokens).trimEnd()
		return `${marker}${content}`
	})
	return `${items.join("\n")}\n\n`
}

function renderListItem(token: Tokens.ListItem): string {
	return renderTokens(token.tokens)
}

function renderTable(token: Tokens.Table): string {
	// 计算列宽
	const allRows = [token.header, ...token.rows]
	const colWidths: number[] = []

	for (const row of allRows) {
		row.forEach((cell, i) => {
			const text = renderInline(cell.tokens)
			const width = stripAnsi(text).length
			colWidths[i] = Math.max(colWidths[i] ?? 0, width)
		})
	}

	// 渲染表头
	const headerRow = token.header
		.map((cell, i) => {
			const text = renderInline(cell.tokens)
			return chalk.bold(padRight(text, colWidths[i]))
		})
		.join(chalk.dim(" │ "))

	// 分隔线
	const separator = colWidths
		.map((w) => "─".repeat(w))
		.join(chalk.dim("─┼─"))

	// 数据行
	const dataRows = token.rows.map((row) =>
		row
			.map((cell, i) => {
				const text = renderInline(cell.tokens)
				return padRight(text, colWidths[i])
			})
			.join(chalk.dim(" │ ")),
	)

	return [
		`  ${headerRow}`,
		`  ${chalk.dim(separator)}`,
		...dataRows.map((r) => `  ${r}`),
		"",
	].join("\n") + "\n"
}

// ─── Inline Renderers ───

function renderInline(tokens: Token[]): string {
	return tokens.map(renderInlineToken).join("")
}

function renderInlineToken(token: Token): string {
	switch (token.type) {
		case "text":
			// text token 可能有子 tokens（如 nested emphasis）
			if ("tokens" in token && Array.isArray(token.tokens)) {
				return renderInline(token.tokens)
			}
			return (token as Tokens.Text).text
		case "strong":
			return chalk.bold(renderInline((token as Tokens.Strong).tokens))
		case "em":
			return chalk.italic(renderInline((token as Tokens.Em).tokens))
		case "del":
			return chalk.strikethrough(renderInline((token as Tokens.Del).tokens))
		case "codespan":
			return chalk.cyan(`\`${(token as Tokens.Codespan).text}\``)
		case "link": {
			const t = token as Tokens.Link
			const text = renderInline(t.tokens)
			return `${chalk.blue.underline(text)}`
		}
		case "image":
			return chalk.dim(`[image: ${(token as Tokens.Image).text}]`)
		case "br":
			return "\n"
		case "escape":
			return (token as Tokens.Escape).text
		default:
			if ("text" in token && typeof token.text === "string") {
				return token.text
			}
			if ("raw" in token && typeof token.raw === "string") {
				return token.raw
			}
			return ""
	}
}

function renderInlineText(token: Tokens.Text): string {
	if (token.tokens) {
		return renderInline(token.tokens)
	}
	return token.text
}

// ─── Utilities ───

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape
	return str.replace(/\x1b\[[0-9;]*m/g, "")
}

function padRight(str: string, width: number): string {
	const visible = stripAnsi(str).length
	const padding = Math.max(0, width - visible)
	return str + " ".repeat(padding)
}
