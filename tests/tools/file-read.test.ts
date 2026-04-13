import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileReadTool } from "../../src/tools/file-read"

const TEST_DIR = join(tmpdir(), "ai-shell-test-" + Date.now())
const TEST_FILE = join(TEST_DIR, "test.txt")

beforeAll(async () => {
	await mkdir(TEST_DIR, { recursive: true })
	const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: content`)
	await writeFile(TEST_FILE, lines.join("\n"))
})

afterAll(async () => {
	await rm(TEST_DIR, { recursive: true, force: true })
})

describe("FileReadTool", () => {
	test("reads a file with line numbers", async () => {
		const result = await FileReadTool.call(
			{ file_path: TEST_FILE },
			{ cwd: TEST_DIR },
		)
		expect(result.isError).toBeUndefined()
		expect(result.content).toContain("1\tLine 1: content")
		expect(result.content).toContain("2\tLine 2: content")
	})

	test("respects offset", async () => {
		const result = await FileReadTool.call(
			{ file_path: TEST_FILE, offset: 10 },
			{ cwd: TEST_DIR },
		)
		expect(result.content).toContain("11\tLine 11: content")
		expect(result.content).not.toContain("1\tLine 1: content")
	})

	test("respects limit", async () => {
		const result = await FileReadTool.call(
			{ file_path: TEST_FILE, limit: 5 },
			{ cwd: TEST_DIR },
		)
		const lines = result.content.split("\n")
		// 5 content lines + "... (X more lines)" footer
		expect(lines.length).toBeGreaterThanOrEqual(5)
	})

	test("handles missing file", async () => {
		const result = await FileReadTool.call(
			{ file_path: join(TEST_DIR, "nonexistent.txt") },
			{ cwd: TEST_DIR },
		)
		expect(result.isError).toBe(true)
		expect(result.content).toContain("File not found")
	})

	test("handles directory path", async () => {
		const result = await FileReadTool.call(
			{ file_path: TEST_DIR },
			{ cwd: TEST_DIR },
		)
		expect(result.isError).toBe(true)
		expect(result.content).toContain("directory")
	})

	test("is read-only and concurrency-safe", () => {
		expect(FileReadTool.isReadOnly()).toBe(true)
		expect(FileReadTool.isConcurrencySafe()).toBe(true)
	})
})
