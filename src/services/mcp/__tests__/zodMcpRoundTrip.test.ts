import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { expect } from "chai"
import { after, before, describe, it } from "mocha"
import * as path from "path"
import { z } from "zod"
import { findLoosenings, type ServersLike } from "../policyGate"
import { ServerConfigSchema } from "../schemas"

// Runtime pin for the zod 4 move (GHSA-mrhx-c7xc-m3w5): a real stdio client talks to a stub server through the
// installed MCP SDK, so a later zod or SDK bump that breaks the SDK's own schemas fails here, not in production.
describe("MCP SDK round trip on the installed zod", () => {
	let client: Client
	const notifications: unknown[] = []

	before(async function () {
		this.timeout(20000)
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [path.join(__dirname, "fixtures", "zodRoundTripStub.cjs")],
			cwd: path.resolve(__dirname, "../../../.."),
		})
		client = new Client({ name: "c", version: "1" }, { capabilities: {} })
		// Same shape McpHub registers for server log notifications.
		const NotificationMessageSchema = z.object({
			method: z.literal("notifications/message"),
			params: z
				.object({
					level: z.enum(["debug", "info", "warning", "error"]).optional(),
					data: z.string().optional(),
				})
				.optional(),
		})
		client.setNotificationHandler(NotificationMessageSchema as any, async (n: any) => {
			notifications.push(n)
		})
		await client.connect(transport)
	})

	after(async () => {
		await client?.close()
	})

	it("listTools keeps annotations", async () => {
		const res = await client.listTools()
		expect(res.tools).to.have.length(1)
		expect(res.tools[0].name).to.equal("echo")
		expect(res.tools[0].annotations).to.deep.equal({ readOnlyHint: true })
	})

	it("callTool returns content", async () => {
		const res: any = await client.callTool({ name: "echo", arguments: { x: "y" } })
		expect(res.content[0]).to.deep.equal({ type: "text", text: "hi y" })
	})

	it("listResources returns the stub resource", async () => {
		const res = await client.listResources()
		expect(res.resources.map((r) => r.uri)).to.deep.equal(["a://b"])
	})

	it("delivers notifications/message to the registered handler", async function () {
		this.timeout(5000)
		const deadline = Date.now() + 4000
		while (notifications.length === 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 50))
		}
		expect(notifications).to.have.length.greaterThan(0)
		expect((notifications[0] as any).params.data).to.equal("hello")
	})
})

describe("ServerConfigSchema autoApprove default (zod 4)", () => {
	it("injects autoApprove: [] when the field is absent (zod 4 applies the inner .default through .optional())", () => {
		expect(ServerConfigSchema.parse({ command: "x" }).autoApprove).to.deep.equal([])
	})

	it("keeps an explicit list", () => {
		expect(ServerConfigSchema.parse({ command: "x", autoApprove: ["t"] }).autoApprove).to.deep.equal(["t"])
	})

	it("policyGate asList treats an absent autoApprove and [] the same, so the injected default is not a loosening", () => {
		const s = (o: Record<string, Record<string, unknown>>) => o as ServersLike
		expect(findLoosenings(s({ srv: {} }), s({ srv: { autoApprove: [] } }))).to.have.length(0)
		expect(findLoosenings(s({ srv: { autoApprove: [] } }), s({ srv: {} }))).to.have.length(0)
	})
})
