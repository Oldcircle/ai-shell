/**
 * 简单日志工具
 */

const VERBOSE = process.env.AI_SHELL_VERBOSE === "1"

export function debug(...args: unknown[]): void {
	if (VERBOSE) {
		console.error("[debug]", ...args)
	}
}

export function info(...args: unknown[]): void {
	console.error("[info]", ...args)
}

export function warn(...args: unknown[]): void {
	console.error("[warn]", ...args)
}

export function error(...args: unknown[]): void {
	console.error("[error]", ...args)
}
