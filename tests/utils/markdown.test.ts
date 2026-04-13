import { describe, test, expect } from "bun:test"
import { renderMarkdown } from "../../src/utils/markdown"

describe("renderMarkdown", () => {
	test("renders plain text", () => {
		const result = renderMarkdown("Hello world")
		expect(result).toContain("Hello world")
	})

	test("renders bold text with ANSI", () => {
		const result = renderMarkdown("**bold text**")
		// Should contain ANSI escape sequences for bold
		expect(result).toContain("bold text")
		expect(result.length).toBeGreaterThan("bold text".length)
	})

	test("renders headings", () => {
		const result = renderMarkdown("# Title\n\nContent")
		expect(result).toContain("Title")
		expect(result).toContain("Content")
	})

	test("renders code blocks", () => {
		const result = renderMarkdown("```js\nconst x = 1\n```")
		expect(result).toContain("const x = 1")
	})

	test("renders inline code", () => {
		const result = renderMarkdown("Use `npm install`")
		expect(result).toContain("`npm install`")
	})

	test("renders lists", () => {
		const result = renderMarkdown("- item 1\n- item 2\n- item 3")
		expect(result).toContain("item 1")
		expect(result).toContain("item 2")
		expect(result).toContain("item 3")
	})

	test("renders numbered lists", () => {
		const result = renderMarkdown("1. first\n2. second\n3. third")
		expect(result).toContain("first")
		expect(result).toContain("second")
	})

	test("renders blockquotes", () => {
		const result = renderMarkdown("> This is a quote")
		expect(result).toContain("This is a quote")
	})

	test("renders tables", () => {
		const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |"
		const result = renderMarkdown(md)
		expect(result).toContain("Name")
		expect(result).toContain("Alice")
		expect(result).toContain("Bob")
	})

	test("renders horizontal rules", () => {
		const result = renderMarkdown("---")
		expect(result).toContain("─")
	})

	test("handles empty input", () => {
		const result = renderMarkdown("")
		expect(result).toBe("")
	})

	test("handles mixed content", () => {
		const md = `# Title

Some **bold** and *italic* text.

\`\`\`typescript
const x: number = 42
\`\`\`

- Item 1
- Item 2
`
		const result = renderMarkdown(md)
		expect(result).toContain("Title")
		expect(result).toContain("bold")
		expect(result).toContain("italic")
		expect(result).toContain("const x")
		expect(result).toContain("Item 1")
	})
})
