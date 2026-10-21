import { expect } from "chai"
import { describe, it } from "mocha"
import type { McpServer } from "../../../mcp"
import { convertMcpServersToProtoMcpServers, convertProtoMcpServersToMcpServers } from "../mcp-server-conversion"

const server = (tools: NonNullable<McpServer["tools"]>): McpServer[] => [
	{ name: "ai-hydro", config: "{}", status: "connected", tools },
]
const roundTrip = (servers: McpServer[]) => convertProtoMcpServersToMcpServers(convertMcpServersToProtoMcpServers(servers))

describe("MCP tool annotations cross to the webview (W2-A2)", () => {
	it("carries the four hints, and keeps an absent hint absent", () => {
		const back = roundTrip(
			server([
				{ name: "a", annotations: { readOnlyHint: true, openWorldHint: false } },
				{ name: "b", annotations: { destructiveHint: false, idempotentHint: true } },
				{ name: "c" },
			]),
		)
		const [a, b, c] = back[0].tools ?? []
		expect(a.annotations).to.deep.equal({
			readOnlyHint: true,
			destructiveHint: undefined,
			idempotentHint: undefined,
			openWorldHint: false,
		})
		expect(b.annotations?.destructiveHint).to.equal(false)
		expect(b.annotations?.readOnlyHint).to.equal(undefined)
		expect(c.annotations).to.equal(undefined)
	})

	it("drops a non-boolean hint instead of coercing it", () => {
		const tool = { name: "x", annotations: { readOnlyHint: "true" as unknown as boolean } }
		const back = roundTrip(server([tool]))
		expect(back[0].tools?.[0].annotations).to.equal(undefined)
	})
})
