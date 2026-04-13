import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { writeFile, mkdir, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileWriteTool } from "../../src/tools/file-write"
import { FileReadTool } from "../../src/tools/file-read"

const TEST_DIR = join(tmpdir(), "ai-shell-write-test-" + Date.now())

beforeAll(async () => {
	await mkdir(TEST_DIR, { recursive: true })
})

afterAll(async () => {
	await rm(TEST_DIR, { recursive: true, force: true })
})

describe("FileWriteTool", () => {
	test("creates a new file", async () => {
		const filePath = join(TEST_DIR, "new.txt")
		const ctx = { cwd: TEST_DIR, readFiles: new Set<string>() }

		const result = await FileWriteTool.call(
			{ file_path: filePath, content: "hello world" },
			ctx,
		)
		expect(result.isError).toBeUndefined()
		expect(result.content).toContain("successfully")

		const content = await readFile(filePath, "utf-8")
		expect(content).toBe("hello world")
	})

	test("creates parent directories", async () => {
		const filePath = join(TEST_DIR, "deep", "nested", "file.txt")
		const ctx = { cwd: TEST_DIR, readFiles: new Set<string>() }

		const result = await FileWriteTool.call(
			{ file_path: filePath, content: "nested" },
			ctx,
		)
		expect(result.isError).toBeUndefined()
	})

	test("BLOCKS overwrite of unread file", async () => {
		const filePath = join(TEST_DIR, "existing.txt")
		await writeFile(filePath, "original content")

		const ctx = { cwd: TEST_DIR, readFiles: new Set<string>() }

		const result = await FileWriteTool.call(
			{ file_path: filePath, content: "overwrite!" },
			ctx,
		)
		expect(result.isError).toBe(true)
		expect(result.content).toContain("must read it first")

		// 原内容不变
		const content = await readFile(filePath, "utf-8")
		expect(content).toBe("original content")
	})

	test("ALLOWS overwrite after Read", async () => {
		const filePath = join(TEST_DIR, "read-first.txt")
		await writeFile(filePath, "original")

		const ctx = { cwd: TEST_DIR, readFiles: new Set<string>() }

		// 先读
		await FileReadTool.call({ file_path: filePath }, ctx)
		expect(ctx.readFiles.has(filePath)).toBe(true)

		// 再写
		const result = await FileWriteTool.call(
			{ file_path: filePath, content: "updated" },
			ctx,
		)
		expect(result.isError).toBeUndefined()

		const content = await readFile(filePath, "utf-8")
		expect(content).toBe("updated")
	})

	test("marks written files as read for subsequent edits", async () => {
		const filePath = join(TEST_DIR, "auto-track.txt")
		const ctx = { cwd: TEST_DIR, readFiles: new Set<string>() }

		// 创建新文件
		await FileWriteTool.call(
			{ file_path: filePath, content: "initial" },
			ctx,
		)

		// 再次写入应该成功（因为 Write 会自动标记为已读）
		const result = await FileWriteTool.call(
			{ file_path: filePath, content: "updated" },
			ctx,
		)
		expect(result.isError).toBeUndefined()
	})
})
