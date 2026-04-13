import { describe, test, expect } from "bun:test"
import { z } from "zod"
import { buildTool, toolToAPISchema } from "../../src/core/tool"

describe("schema sanitization", () => {
	test("converts draft-04 exclusiveMinimum to draft-07+", () => {
		const tool = buildTool({
			name: "Test",
			description: "test",
			inputSchema: z.object({
				count: z.number().int().positive(), // positive() → exclusiveMinimum: 0
			}),
			async call() {
				return { content: "" }
			},
		})

		const schema = toolToAPISchema(tool)
		const props = (schema.input_schema as Record<string, unknown>)
			.properties as Record<string, Record<string, unknown>>

		// 不应该有 boolean 形式的 exclusiveMinimum
		expect(props.count.exclusiveMinimum).not.toBe(true)
		// 应该转为数字形式
		expect(typeof props.count.exclusiveMinimum).toBe("number")
	})

	test("removes $schema field", () => {
		const tool = buildTool({
			name: "Test",
			description: "test",
			inputSchema: z.object({ x: z.string() }),
			async call() {
				return { content: "" }
			},
		})

		const schema = toolToAPISchema(tool)
		expect(schema.input_schema.$schema).toBeUndefined()
	})

	test("nested schemas are also sanitized", () => {
		const tool = buildTool({
			name: "Test",
			description: "test",
			inputSchema: z.object({
				nested: z.object({
					value: z.number().positive(),
				}).optional(),
			}),
			async call() {
				return { content: "" }
			},
		})

		const schema = toolToAPISchema(tool)
		const props = (schema.input_schema as Record<string, unknown>)
			.properties as Record<string, Record<string, unknown>>

		const nestedProps = props.nested.properties as Record<
			string,
			Record<string, unknown>
		>
		expect(nestedProps.value.exclusiveMinimum).not.toBe(true)
	})
})
