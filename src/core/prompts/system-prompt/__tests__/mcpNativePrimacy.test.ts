/**
 * Native-platform primacy in the MCP system-prompt section.
 *
 * Regression guard for the routing fix: when the host platform (a server that
 * opts into progressive disclosure via `_meta.hot`) is connected ALONGSIDE a
 * third-party MCP server, the prompt must (a) render the native platform first,
 * (b) frame it as the primary toolset, and (c) frame third-party servers as
 * supplementary. This is what stops the agent from routing a lightweight task
 * to a heavyweight third-party server by name-association.
 *
 * The discriminator is general (any server with a hot tool is "native") — it
 * names no specific server, per the platform-robustness principle.
 */
import "should"
import type { McpServer } from "@/shared/mcp"
import { formatMcpServersList, isNativeServer } from "../components/mcp"

function makeServer(name: string, opts: { hot?: boolean } = {}): McpServer {
	return {
		name,
		status: "connected",
		config: '{"command": "test"}',
		tools: [
			{
				name: `${name}_tool`,
				description: `A tool on ${name}`,
				inputSchema: { type: "object", properties: {} },
				...(opts.hot ? { _meta: { hot: true, domain: "watershed" } } : {}),
			},
		],
		resources: [],
		resourceTemplates: [],
	} as unknown as McpServer
}

describe("MCP native-platform primacy", () => {
	it("classifies a server with a hot tool as native, others as third-party", () => {
		isNativeServer(makeServer("aihydro-tools", { hot: true })).should.equal(true)
		isNativeServer(makeServer("swatplus-builder")).should.equal(false)
	})

	it("renders native platform first and frames both groups when both are present", () => {
		// Deliberately pass third-party FIRST to prove ordering is by class, not input order.
		const out = formatMcpServersList([makeServer("swatplus-builder"), makeServer("aihydro-tools", { hot: true })])

		out.should.containEql("# Native Platform (primary toolset)")
		out.should.containEql("# Additional Connected Servers (supplementary)")

		// Native group header must precede the third-party group header.
		out.indexOf("# Native Platform").should.be.below(out.indexOf("# Additional Connected Servers"))
		// The native server block must appear before the third-party server block.
		out.indexOf("## aihydro-tools").should.be.below(out.indexOf("## swatplus-builder"))
	})

	it("does NOT add group framing when only one class is present (single-group = plain render)", () => {
		const onlyThirdParty = formatMcpServersList([makeServer("swatplus-builder")])
		onlyThirdParty.should.not.containEql("# Native Platform")
		onlyThirdParty.should.not.containEql("# Additional Connected Servers")
		onlyThirdParty.should.containEql("## swatplus-builder")

		const onlyNative = formatMcpServersList([makeServer("aihydro-tools", { hot: true })])
		onlyNative.should.not.containEql("# Native Platform")
		onlyNative.should.containEql("## aihydro-tools")
	})
})
