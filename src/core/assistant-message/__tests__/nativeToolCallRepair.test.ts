import { expect } from "chai"
import { type NativeToolCallContext, repairNativeToolCalls } from "../nativeToolCallRepair"
import { parseAssistantMessageV2 } from "../parse-assistant-message"

// The exact shape from the 01031500 session study (ui row 34).
const STUDY_SHAPE =
	'<tool_calls>\n<invoke name="delineate_watershed">\n<parameter name="gauge_id">01031500</parameter>\n<parameter name="session_id">01031500</parameter>\n<parameter name="workspace_dir">/Users/mgalib/Documents/try</parameter>\n</invoke>\n</tool_calls>'

const ctx: NativeToolCallContext = {
	servers: [
		{
			name: "aihydro-tools",
			tools: [
				{
					name: "delineate_watershed",
					inputSchema: {
						properties: { gauge_id: { type: "string" }, buffer_km: { type: "number" }, flags: { type: "object" } },
					},
				},
				{ name: "shared_tool" },
			],
		},
		{ name: "other", tools: [{ name: "shared_tool" }] },
	],
}

describe("repairNativeToolCalls (DeepSeek native tool-call envelope)", () => {
	it("turns the exact study shape into a use_mcp_tool call, keeping string ids as strings", () => {
		const out = repairNativeToolCalls(STUDY_SHAPE, ctx, true)
		expect(out.repaired).to.equal(1)
		expect(out.malformed).to.deep.equal([])
		const blocks = parseAssistantMessageV2(out.text)
		const tool = blocks.find((b) => b.type === "tool_use") as any
		expect(tool.name).to.equal("use_mcp_tool")
		expect(tool.params.server_name).to.equal("aihydro-tools")
		expect(tool.params.tool_name).to.equal("delineate_watershed")
		const args = JSON.parse(tool.params.arguments)
		expect(args).to.deep.equal({ gauge_id: "01031500", session_id: "01031500", workspace_dir: "/Users/mgalib/Documents/try" })
		expect(blocks.some((b) => b.type === "text" && /tool_calls|invoke/.test((b as any).content))).to.equal(false)
	})

	it("coerces numeric and object arguments by the tool's input schema", () => {
		const text =
			'<tool_calls><invoke name="delineate_watershed"><parameter name="buffer_km">2.5</parameter><parameter name="flags">{"a":1}</parameter></invoke></tool_calls>'
		const tool = parseAssistantMessageV2(repairNativeToolCalls(text, ctx, true).text).find(
			(b) => b.type === "tool_use",
		) as any
		expect(JSON.parse(tool.params.arguments)).to.deep.equal({ buffer_km: 2.5, flags: { a: 1 } })
	})

	it("keeps surrounding prose and maps a built-in tool name directly", () => {
		const text =
			'Reading it.\n<tool_calls><invoke name="read_file"><parameter name="path">a.txt</parameter></invoke></tool_calls>'
		const blocks = parseAssistantMessageV2(repairNativeToolCalls(text, ctx, true).text)
		expect((blocks[0] as any).content.trim()).to.equal("Reading it.")
		const tool = blocks.find((b) => b.type === "tool_use") as any
		expect(tool.name).to.equal("read_file")
		expect(tool.params.path).to.equal("a.txt")
	})

	it("never guesses: unknown tool, ambiguous tool, and unknown built-in params are malformed", () => {
		for (const name of ["no_such_tool", "shared_tool"]) {
			const text = `<tool_calls><invoke name="${name}"><parameter name="x">1</parameter></invoke></tool_calls>`
			const out = repairNativeToolCalls(text, ctx, true)
			expect(out.repaired).to.equal(0)
			expect(out.malformed).to.deep.equal([text])
			expect(out.text).to.equal("")
		}
		const bad = '<tool_calls><invoke name="read_file"><parameter name="nope">1</parameter></invoke></tool_calls>'
		expect(repairNativeToolCalls(bad, ctx, true).malformed).to.have.length(1)
	})

	it("hides an unterminated envelope while streaming and reports it as malformed at the end", () => {
		const partial = 'ok\n<tool_calls>\n<invoke name="delineate_watershed">\n<parameter name="gauge_id">0103'
		const streaming = repairNativeToolCalls(partial, ctx, false)
		expect(streaming.text).to.equal("ok\n")
		expect(streaming.malformed).to.deep.equal([])
		const done = repairNativeToolCalls(partial, ctx, true)
		expect(done.malformed).to.have.length(1)
		expect(done.malformed[0]).to.include("<tool_calls>")
	})

	it("leaves envelopes inside code fences or inline code alone (documentation, not a call)", () => {
		const fenced = "Example:\n```\n" + STUDY_SHAPE + "\n```\n"
		expect(repairNativeToolCalls(fenced, ctx, true)).to.deep.equal({ text: fenced, repaired: 0, malformed: [] })
		const inline = "Use `<tool_calls>` envelopes? No."
		expect(repairNativeToolCalls(inline, ctx, true).repaired).to.equal(0)
		expect(repairNativeToolCalls(inline, ctx, true).text).to.equal(inline)
	})

	it("is a no-op on ordinary protocol XML", () => {
		const text = "<read_file>\n<path>a.txt</path>\n</read_file>"
		expect(repairNativeToolCalls(text, ctx, true)).to.deep.equal({ text, repaired: 0, malformed: [] })
	})

	it("treats stray content inside an invoke as malformed", () => {
		const text = '<tool_calls><invoke name="delineate_watershed">hello<parameter name="a">1</parameter></invoke></tool_calls>'
		expect(repairNativeToolCalls(text, ctx, true).malformed).to.have.length(1)
	})
})
