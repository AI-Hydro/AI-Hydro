import { expect } from "chai"
import { describe, it } from "mocha"
import { compactSchema, renderSchema } from "../components/compactSchema"
import { formatMcpServersList } from "../components/mcp"
import fixture from "./fixtures/aihydro-tools-input-schemas.json"
import thirdParty from "./fixtures/third-party-input-schemas.json"

// The fixture is the inputSchema of every tool from a real tools/list of the first-party server (aihydro-tools, origin/main
// d7c2954: 179 tools, 45 hot), so these tests run on what the model is really given, not on a hand-made schema.
const TOOLS = fixture as Array<{ name: string; hot: boolean; inputSchema: any }>

/** Everything in a schema that constrains a call, as comparable strings. Titles, null alternatives and null defaults are not facts. */
function facts(node: any, path = "$", out: string[] = []): string[] {
	if (node === null || typeof node !== "object" || Array.isArray(node)) {
		return out
	}
	for (const [name, child] of Object.entries(node.properties ?? {})) {
		out.push(`${path}.${name}`)
		facts(child, `${path}.${name}`, out)
	}
	if (Array.isArray(node.required)) {
		out.push(`${path}!required=${[...node.required].sort().join(",")}`)
	}
	const types = new Set<string>()
	const addType = (n: any) => {
		for (const t of Array.isArray(n?.type) ? n.type : n?.type ? [n.type] : []) {
			if (t !== "null") {
				types.add(t)
			}
		}
	}
	addType(node)
	for (const alt of [...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
		addType(alt)
		for (const key of ["enum", "const", "format", "minimum", "maximum"]) {
			if (alt && key in alt) {
				out.push(`${path}!${key}=${JSON.stringify(alt[key])}`)
			}
		}
		facts(alt, path, out)
	}
	if (types.size) {
		out.push(`${path}!type=${[...types].sort().join("|")}`)
	}
	for (const key of ["enum", "const", "format", "minimum", "maximum", "minLength", "maxLength", "pattern"]) {
		if (key in node) {
			out.push(`${path}!${key}=${JSON.stringify(node[key])}`)
		}
	}
	if ("default" in node && node.default !== null) {
		out.push(`${path}!default=${JSON.stringify(node.default)}`)
	}
	if (node.items) {
		facts(node.items, `${path}[]`, out)
	}
	if (node.additionalProperties && typeof node.additionalProperties === "object") {
		facts(node.additionalProperties, `${path}{}`, out)
	}
	return out
}

describe("compactSchema", () => {
	it("keeps every call-constraining fact on all real tool schemas", () => {
		expect(TOOLS.length).to.be.greaterThan(150)
		for (const tool of TOOLS) {
			// A set: a type reached through an `anyOf` alternative and then through the folded node is one fact.
			const before = [...new Set(facts(tool.inputSchema))].sort()
			const after = [...new Set(facts(compactSchema(tool.inputSchema)))].sort()
			expect(after, tool.name).to.deep.equal(before)
		}
	})

	it("keeps descriptions (they are the parameter documentation)", () => {
		const texts = (n: any, out: string[] = []): string[] => {
			if (n && typeof n === "object") {
				if (typeof n.description === "string") {
					out.push(n.description)
				}
				Object.values(n).forEach((v) => texts(v, out))
			}
			return out
		}
		for (const tool of TOOLS) {
			expect(texts(compactSchema(tool.inputSchema)).sort(), tool.name).to.deep.equal(texts(tool.inputSchema).sort())
		}
	})

	it("removes the generated boilerplate and nothing else", () => {
		const schema = {
			title: "start_sessionArguments",
			type: "object",
			properties: {
				session_id: {
					anyOf: [{ type: "string" }, { type: "null" }],
					default: null,
					title: "Session Id",
					description: "Study id",
				},
				title: { type: "string", title: "Title", description: "A property that is really called title" },
				mode: { type: "string", enum: ["a", "b"], default: "a" },
				limit: { anyOf: [{ type: "integer" }, { type: "string" }], default: null },
				nullable_only: { type: "null" },
			},
			required: ["mode"],
		}
		const out: any = compactSchema(schema)
		expect(out).to.deep.equal({
			title: "start_sessionArguments", // no description beside it: kept
			type: "object",
			properties: {
				session_id: { type: "string", description: "Study id" },
				title: { type: "string", description: "A property that is really called title" },
				mode: { type: "string", enum: ["a", "b"], default: "a" },
				limit: { anyOf: [{ type: "integer" }, { type: "string" }] },
				nullable_only: { type: "null" },
			},
			required: ["mode"],
		})
		// A property named "title" survives, and so does its schema; the input was not mutated.
		expect(Object.keys(out.properties)).to.include("title")
		expect(schema.properties.session_id.anyOf).to.have.length(2)
	})

	it("keeps 'or null' on a required parameter, and a title where there is no description", () => {
		const schema = {
			type: "object",
			properties: {
				milestone: { anyOf: [{ type: "integer" }, { type: "null" }], description: "Milestone, or null for none" },
				assignee: { anyOf: [{ type: "string" }, { type: "null" }], default: null, title: "Assignee" },
				plain: { type: "string", title: "Plain" },
			},
			required: ["milestone"],
		}
		const out: any = compactSchema(schema)
		expect(out.properties.milestone.anyOf).to.deep.equal([{ type: "integer" }, { type: "null" }])
		// optional: folded; its generated title has no description to stand beside, so it stays
		expect(out.properties.assignee).to.deep.equal({ type: "string", title: "Assignee" })
		expect(out.properties.plain).to.deep.equal({ type: "string", title: "Plain" })
	})

	it("third-party style schemas (zod-to-json-schema, additionalProperties false, nested arrays) keep every fact and their wrapper keywords", () => {
		const tools = thirdParty as Array<{ name: string; inputSchema: any }>
		for (const tool of tools) {
			expect([...new Set(facts(compactSchema(tool.inputSchema)))].sort(), tool.name).to.deep.equal(
				[...new Set(facts(tool.inputSchema))].sort(),
			)
		}
		const read: any = compactSchema(tools[0].inputSchema)
		expect(read.additionalProperties).to.equal(false)
		expect(read.$schema).to.equal("http://json-schema.org/draft-07/schema#")
		const search: any = compactSchema(tools[1].inputSchema)
		expect(search.properties.milestone.anyOf).to.have.length(2) // required: kept
		expect(search.properties.assignee).to.deep.equal({ type: "string", title: "Assignee" }) // optional: folded
		const table: any = compactSchema(tools[2].inputSchema)
		expect(table.properties.columns.items.properties.default.anyOf).to.deep.equal([{ type: "string" }, { type: "number" }]) // optional: null dropped
	})

	it("pinned measurement on the real first-party hot tools (45): schema block characters and lines", () => {
		const hot = TOOLS.filter((t) => t.hot)
		const pretty = hot
			.map((t) => `    Input Schema:\n    ${JSON.stringify(t.inputSchema, null, 2).split("\n").join("\n    ")}`)
			.join("")
		const compact = hot.map((t) => `    Input Schema: ${renderSchema(t.inputSchema)}`).join("")
		expect(hot).to.have.length(45)
		expect(pretty.length).to.equal(43522)
		expect(compact.length).to.equal(13195)
		expect(pretty.split("\n").length).to.equal(2195)
		expect(compact.split("\n").length).to.equal(1)
	})

	it("does not rewrite enum, default or example values that look like schema keywords", () => {
		const schema = {
			type: "object",
			properties: { x: { type: "string", enum: ["title", "null"], examples: [{ title: "t", default: null }] } },
		}
		expect(compactSchema(schema)).to.deep.equal(schema)
	})

	it("renders one line, and the rendered listing keeps every tool name and shrinks the real hot block", () => {
		expect(renderSchema({ type: "object", properties: { a: { type: "string" } } })).to.equal(
			'{"type":"object","properties":{"a":{"type":"string"}}}',
		)
		const server: any = {
			name: "aihydro-tools",
			status: "connected",
			config: JSON.stringify({ command: "x" }),
			tools: TOOLS.map((t) => ({
				name: t.name,
				description: `Tool ${t.name}.`,
				inputSchema: t.inputSchema,
				_meta: { hot: t.hot, domain: "d" },
			})),
		}
		const compact = formatMcpServersList([server])
		for (const t of TOOLS) {
			expect(compact, t.name).to.include(t.name)
		}
		const pretty = TOOLS.filter((t) => t.hot)
			.map((t) => JSON.stringify(t.inputSchema, null, 2))
			.join("")
		const hotCompact = TOOLS.filter((t) => t.hot)
			.map((t) => renderSchema(t.inputSchema))
			.join("")
		expect(hotCompact.length).to.be.lessThan(pretty.length * 0.4)
	})
})
