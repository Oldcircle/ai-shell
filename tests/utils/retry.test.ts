import { describe, test, expect } from "bun:test"
import { withRetry } from "../../src/utils/retry"

describe("withRetry", () => {
	test("succeeds on first try", async () => {
		let calls = 0
		const result = await withRetry(async () => {
			calls++
			return "ok"
		})
		expect(result).toBe("ok")
		expect(calls).toBe(1)
	})

	test("retries on retryable error", async () => {
		let calls = 0
		const result = await withRetry(
			async () => {
				calls++
				if (calls < 3) throw new Error("429 rate limit")
				return "ok"
			},
			{ maxRetries: 3, baseDelayMs: 10 },
		)
		expect(result).toBe("ok")
		expect(calls).toBe(3)
	})

	test("throws immediately on non-retryable error", async () => {
		let calls = 0
		try {
			await withRetry(
				async () => {
					calls++
					throw new Error("401 unauthorized")
				},
				{ maxRetries: 3, baseDelayMs: 10 },
			)
		} catch (e) {
			expect((e as Error).message).toContain("401")
		}
		expect(calls).toBe(1)
	})

	test("throws after max retries", async () => {
		let calls = 0
		try {
			await withRetry(
				async () => {
					calls++
					throw new Error("500 internal server error")
				},
				{ maxRetries: 2, baseDelayMs: 10 },
			)
		} catch (e) {
			expect((e as Error).message).toContain("500")
		}
		expect(calls).toBe(3) // initial + 2 retries
	})
})
