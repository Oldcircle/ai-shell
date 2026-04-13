import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { writeFile, mkdir, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileEditTool } from "../../src/tools/file-edit"

const TEST_DIR = join(tmpdir(), "ai-shell-edit-test-" + Date.now())
const TEST_FILE = join(TEST_DIR, "edit-test.txt")

beforeAll(async () => {
	await mkdir(TEST_DIR, { recursive: true })
	await writeFile(TEST_FILE, "Hello World\nFoo Bar\nHello World\n")
})

afterAll(async () => {
	await rm(TEST_DIR, { recursive: true, force: true })
})

describe("FileEditTool", () => {
	test("replaces unique string", async () => {
		await writeFile(TEST_FILE, "Hello World\nFoo Bar\n")
		const result = await FileEditTool.call(
			{ file_path: TEST_FILE, old_string: "Foo Bar", new_string: "Baz Qux", replace_all: false },
			{ cwd: TEST_DIR, readFiles: new Set() },
		)
		expect(result.isError).toBeUndefined()
		const content = await readFile(TEST_FILE, "utf-8")
		expect(content).toBe("Hello World\nBaz Qux\n")
	})

	test("fails on non-unique string without replace_all", async () => {
		await writeFile(TEST_FILE, "aaa\nbbb\naaa\n")
		const result = await FileEditTool.call(
			{ file_path: TEST_FILE, old_string: "aaa", new_string: "ccc", replace_all: false },
			{ cwd: TEST_DIR, readFiles: new Set() },
		)
		expect(result.isError).toBe(true)
		expect(result.content).toContain("2 times")
	})

	test("replace_all replaces all occurrences", async () => {
		await writeFile(TEST_FILE, "aaa\nbbb\naaa\n")
		const result = await FileEditTool.call(
			{ file_path: TEST_FILE, old_string: "aaa", new_string: "ccc", replace_all: true },
			{ cwd: TEST_DIR, readFiles: new Set() },
		)
		expect(result.isError).toBeUndefined()
		const content = await readFile(TEST_FILE, "utf-8")
		expect(content).toBe("ccc\nbbb\nccc\n")
	})

	test("fails when old_string not found", async () => {
		await writeFile(TEST_FILE, "Hello World\n")
		const result = await FileEditTool.call(
			{ file_path: TEST_FILE, old_string: "not here", new_string: "xxx", replace_all: false },
			{ cwd: TEST_DIR, readFiles: new Set() },
		)
		expect(result.isError).toBe(true)
		expect(result.content).toContain("not found")
	})

	test("fails when old and new are identical", async () => {
		const result = await FileEditTool.call(
			{ file_path: TEST_FILE, old_string: "same", new_string: "same", replace_all: false },
			{ cwd: TEST_DIR, readFiles: new Set() },
		)
		expect(result.isError).toBe(true)
	})

	test("fails on missing file", async () => {
		const result = await FileEditTool.call(
			{
				file_path: join(TEST_DIR, "nope.txt"),
				old_string: "a",
				new_string: "b",
				replace_all: false,
			},
			{ cwd: TEST_DIR, readFiles: new Set() },
		)
		expect(result.isError).toBe(true)
		expect(result.content).toContain("File not found")
	})
})
