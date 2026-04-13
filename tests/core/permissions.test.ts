import { describe, test, expect } from "bun:test"
import { z } from "zod"
import { buildTool } from "../../src/core/tool"
import {
	createPermissionContext,
	checkPermission,
	approveForSession,
} from "../../src/core/permissions"

const ReadOnlyTool = buildTool({
	name: "SafeRead",
	description: "A read-only tool",
	inputSchema: z.object({}),
	isReadOnly: () => true,
	async call() {
		return { content: "data" }
	},
})

const DangerousTool = buildTool({
	name: "Danger",
	description: "A destructive tool",
	inputSchema: z.object({}),
	isDestructive: () => true,
	async call() {
		return { content: "boom" }
	},
})

describe("PermissionContext", () => {
	test("bypass mode allows everything", async () => {
		const ctx = createPermissionContext("bypass")
		const result = await checkPermission(DangerousTool, {}, ctx)
		expect(result.behavior).toBe("allow")
	})

	test("deny mode denies everything", async () => {
		const ctx = createPermissionContext("deny")
		const result = await checkPermission(ReadOnlyTool, {}, ctx)
		expect(result.behavior).toBe("deny")
	})

	test("default mode allows read-only tools", async () => {
		const ctx = createPermissionContext("default")
		const result = await checkPermission(ReadOnlyTool, {}, ctx)
		expect(result.behavior).toBe("allow")
	})

	test("default mode asks for non-readonly tools", async () => {
		const ctx = createPermissionContext("default")
		const result = await checkPermission(DangerousTool, {}, ctx)
		expect(result.behavior).toBe("ask")
	})

	test("explicit allow rule overrides default", async () => {
		const ctx = createPermissionContext("default", [
			{ tool: "Danger", action: "allow" },
		])
		const result = await checkPermission(DangerousTool, {}, ctx)
		expect(result.behavior).toBe("allow")
	})

	test("explicit deny rule blocks tool", async () => {
		const ctx = createPermissionContext("default", [
			{ tool: "SafeRead", action: "deny" },
		])
		const result = await checkPermission(ReadOnlyTool, {}, ctx)
		expect(result.behavior).toBe("deny")
	})

	test("wildcard rule matches", async () => {
		const ctx = createPermissionContext("default", [
			{ tool: "*", action: "allow" },
		])
		const result = await checkPermission(DangerousTool, {}, ctx)
		expect(result.behavior).toBe("allow")
	})

	test("session approval caches decision", async () => {
		const ctx = createPermissionContext("default")
		// First time: ask
		const first = await checkPermission(DangerousTool, {}, ctx)
		expect(first.behavior).toBe("ask")

		// Approve
		approveForSession(ctx, "Danger")

		// Second time: allow
		const second = await checkPermission(DangerousTool, {}, ctx)
		expect(second.behavior).toBe("allow")
	})
})
