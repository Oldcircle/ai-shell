import { describe, test, expect } from "bun:test"
import { getSystemContext, getGitStatus } from "../../src/context"

describe("getSystemContext", () => {
	test("includes platform info", () => {
		const ctx = getSystemContext()
		expect(ctx).toContain("Platform:")
		expect(ctx).toContain("darwin")
	})

	test("includes current date", () => {
		const ctx = getSystemContext()
		expect(ctx).toContain("Date:")
		expect(ctx).toMatch(/\d{4}-\d{2}-\d{2}/)
	})

	test("includes CWD", () => {
		const ctx = getSystemContext()
		expect(ctx).toContain("CWD:")
	})
})

describe("getGitStatus", () => {
	test("returns git info for a git repo", () => {
		const status = getGitStatus(process.cwd())
		// 我们在 git repo 里
		expect(status).not.toBeNull()
		expect(status).toContain("Current branch:")
	})

	test("returns null for non-git directory", () => {
		const status = getGitStatus("/tmp")
		expect(status).toBeNull()
	})
})
