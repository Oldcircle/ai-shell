import { describe, test, expect } from "bun:test"
import { z } from "zod"
import { buildTool, findToolByName, toolToAPISchema } from "../../src/core/tool"

describe("buildTool", () => {
	const TestTool = buildTool({
		name: "TestTool",
		aliases: ["test"],
		description: "A test tool",
		inputSchema: z.object({ value: z.string() }),
		async call(input) {
			return { content: `Got: ${input.value}` }
		},
	})

	test("fills in default values", () => {
		expect(TestTool.name).toBe("TestTool")
		expect(TestTool.isEnabled()).toBe(true)
		expect(TestTool.isConcurrencySafe()).toBe(false)
		expect(TestTool.isReadOnly()).toBe(false)
		expect(TestTool.isDestructive()).toBe(false)
	})

	test("call() works", async () => {
		const result = await TestTool.call(
			{ value: "hello" },
			{ cwd: "/tmp" },
		)
		expect(result.content).toBe("Got: hello")
		expect(result.isError).toBeUndefined()
	})

	test("checkPermissions defaults to allow", async () => {
		const perm = await TestTool.checkPermissions({ value: "x" })
		expect(perm.behavior).toBe("allow")
	})
})

describe("findToolByName", () => {
	const Tool1 = buildTool({
		name: "Alpha",
		aliases: ["a"],
		description: "First",
		inputSchema: z.object({}),
		async call() {
			return { content: "" }
		},
	})

	const Tool2 = buildTool({
		name: "Beta",
		description: "Second",
		inputSchema: z.object({}),
		async call() {
			return { content: "" }
		},
	})

	test("finds by name", () => {
		const found = findToolByName([Tool1, Tool2], "Alpha")
		expect(found?.name).toBe("Alpha")
	})

	test("finds by alias", () => {
		const found = findToolByName([Tool1, Tool2], "a")
		expect(found?.name).toBe("Alpha")
	})

	test("returns undefined for unknown", () => {
		const found = findToolByName([Tool1, Tool2], "Gamma")
		expect(found).toBeUndefined()
	})
})

describe("toolToAPISchema", () => {
	const tool = buildTool({
		name: "MyTool",
		description: "Does stuff",
		inputSchema: z.object({
			path: z.string().describe("File path"),
			count: z.number().optional(),
		}),
		async call() {
			return { content: "" }
		},
	})

	test("converts to API format", () => {
		const schema = toolToAPISchema(tool)
		expect(schema.name).toBe("MyTool")
		expect(schema.description).toBe("Does stuff")
		expect(schema.input_schema).toBeDefined()
		expect((schema.input_schema as Record<string, unknown>).type).toBe("object")
	})
})
