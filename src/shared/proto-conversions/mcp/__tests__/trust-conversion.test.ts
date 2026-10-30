import { expect } from "chai"
import { describe, it } from "mocha"
import { getRecordedFirstPartyLauncher, setRecordedFirstPartyLauncher } from "../../../aihydro/firstPartyServers"
import type { McpServer } from "../../../mcp"
import { convertMcpServersToProtoMcpServers, convertProtoMcpServersToMcpServers } from "../mcp-server-conversion"

describe("MCP server trust state crosses to the webview", () => {
	it("carries trusted/reason through the proto round trip", () => {
		const saved = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher({ name: "ai-hydro", command: "aihydro-mcp", args: [] })
		try {
			const servers: McpServer[] = [
				{
					name: "ai-hydro",
					config: JSON.stringify({ type: "stdio", command: "aihydro-mcp", args: [] }),
					status: "connected",
				},
				{
					name: "aihydro-tools",
					config: JSON.stringify({ type: "stdio", command: "aihydro-mcp", args: [] }),
					status: "connected",
				},
				{ name: "swat", config: JSON.stringify({ type: "stdio", command: "swat" }), status: "connected" },
			]
			const back = convertProtoMcpServersToMcpServers(convertMcpServersToProtoMcpServers(servers))
			expect(back.map((s) => s.trust?.trusted)).to.deep.equal([true, false, false])
			expect(back[1].trust?.reason).to.include("running from a new location")
			expect(back[2].trust?.reason).to.include("third-party")
		} finally {
			setRecordedFirstPartyLauncher(saved)
		}
	})
})
