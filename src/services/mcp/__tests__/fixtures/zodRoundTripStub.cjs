// Minimal stdio MCP server used by zodMcpRoundTrip.test.ts. Plain CommonJS so the test can spawn it with `node`.
const { Server } = require("@modelcontextprotocol/sdk/server/index.js")
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js")
const { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema } = require("@modelcontextprotocol/sdk/types.js")

const server = new Server({ name: "stub", version: "1" }, { capabilities: { tools: {}, resources: {}, logging: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{
			name: "echo",
			description: "echo",
			inputSchema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
			annotations: { readOnlyHint: true },
		},
	],
}))
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
	content: [{ type: "text", text: `hi ${req.params.arguments.x}` }],
}))
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: "a://b", name: "b" }] }))

server.connect(new StdioServerTransport()).then(() => {
	setTimeout(() => server.notification({ method: "notifications/message", params: { level: "info", data: "hello" } }), 300)
})
