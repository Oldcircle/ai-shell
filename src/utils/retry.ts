/**
 * 指数退避重试
 *
 * 用于 API 调用的错误恢复。参考 Claude Code 的 withRetry：
 * - 可重试错误：429 (rate limit), 500, 502, 503, 529 (overloaded)
 * - 不可重试错误：400, 401, 403, 404
 * - 指数退避 + 抖动
 */

interface RetryOptions {
	maxRetries?: number
	baseDelayMs?: number
	maxDelayMs?: number
	/** 自定义判断是否可重试 */
	isRetryable?: (error: unknown) => boolean
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	baseDelayMs: 1000,
	maxDelayMs: 30_000,
	isRetryable: defaultIsRetryable,
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options?: RetryOptions,
): Promise<T> {
	const opts = { ...DEFAULT_OPTIONS, ...options }
	let lastError: unknown

	for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
		try {
			return await fn()
		} catch (error) {
			lastError = error

			if (attempt >= opts.maxRetries || !opts.isRetryable(error)) {
				throw error
			}

			const delay = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs)
			await sleep(delay)
		}
	}

	throw lastError
}

function calculateDelay(
	attempt: number,
	baseMs: number,
	maxMs: number,
): number {
	// 指数退避：base * 2^attempt
	const exponential = baseMs * 2 ** attempt
	// 添加 ±25% 抖动
	const jitter = exponential * (0.75 + Math.random() * 0.5)
	return Math.min(jitter, maxMs)
}

function defaultIsRetryable(error: unknown): boolean {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase()

		// HTTP 状态码检查
		if (msg.includes("429") || msg.includes("rate limit")) return true
		if (msg.includes("500") || msg.includes("internal server")) return true
		if (msg.includes("502") || msg.includes("bad gateway")) return true
		if (msg.includes("503") || msg.includes("service unavailable")) return true
		if (msg.includes("529") || msg.includes("overloaded")) return true

		// 网络错误
		if (msg.includes("econnreset") || msg.includes("econnrefused")) return true
		if (msg.includes("timeout") || msg.includes("etimedout")) return true
		if (msg.includes("fetch failed")) return true

		// 不可重试
		if (msg.includes("400") || msg.includes("invalid")) return false
		if (msg.includes("401") || msg.includes("unauthorized")) return false
		if (msg.includes("403") || msg.includes("forbidden")) return false
	}

	return false
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
