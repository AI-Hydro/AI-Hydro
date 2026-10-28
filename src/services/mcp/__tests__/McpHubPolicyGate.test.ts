import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { findLoosenings, policySnapshot } from "../policyGate"

/**
 * B3 integration (security review of PR 61, finding 4): edit -> refresh -> still not auto-approved -> revert.
 * A real McpHub, a real settings file and the real watcher path. Only the webview stream
 * (subscribeToMcpServers) is stubbed, because it pulls the controller graph that does not compile under ts-node.
 */
const Module = require("module")
const originalRequire = Module.prototype.require
const STUBBED = "@core/controller/mcp/subscribeToMcpServers"

/** A minimal real stdio MCP server with two tools, so McpHub connects and lists tools for real. */
const SERVER_SCRIPT = (sdk: string) => `
const { Server } = require(${JSON.stringify(sdk + "/server/index.js")})
const { StdioServerTransport } = require(${JSON.stringify(sdk + "/server/stdio.js")})
const { ListToolsRequestSchema, CallToolRequestSchema } = require(${JSON.stringify(sdk + "/types.js")})
const server = new Server({ name: "stub", version: "0.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ["describe_tool", "run_python"].map((name) => ({ name, inputSchema: { type: "object" } })),
}))
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }))
server.connect(new StdioServerTransport())
`

describe("McpHub reads autoApprove only from the accepted policy (B3, review finding 4)", function () {
	this.timeout(60_000)
	let dir: string
	let file: string
	let hub: any
	let prompts: string[]
	let answer: string | undefined
	let launch: (autoApprove: string[]) => Record<string, unknown>

	beforeEach(async () => {
		Module.prototype.require = function (request: string) {
			if (request === STUBBED) {
				return { sendMcpServersUpdate: async () => {} }
			}
			return originalRequire.call(this, request)
		}
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcphub-gate-"))
		file = path.join(dir, "aihydro_mcp_settings.json")
		prompts = []
		answer = "Revert"
		HostProvider.reset()
		HostProvider.initialize(
			(() => {}) as any,
			(() => {}) as any,
			{
				windowClient: {
					showMessage: async (request: { message: string }) => {
						prompts.push(request.message)
						return { selectedOption: answer }
					},
				},
			} as any,
			() => {},
			async () => "",
			async () => "",
			"/mock/extension",
			dir,
		)
		const script = path.join(dir, "stub-server.js")
		await fs.writeFile(
			script,
			SERVER_SCRIPT(path.resolve(__dirname, "../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs")),
		)
		const entry = (autoApprove: string[]) => ({ command: process.execPath, args: [script], autoApprove })
		launch = entry
		await fs.writeFile(file, JSON.stringify({ mcpServers: { s: entry(["describe_tool"]) } }))
		const { McpHub } = await import("../McpHub")
		hub = new McpHub(
			async () => dir,
			async () => dir,
			"0.0.0",
			{} as any,
		)
		for (let i = 0; i < 400 && !(hub.policyGate.baselineSet && hub.connections[0]?.server.status === "connected"); i++) {
			await new Promise((r) => setTimeout(r, 25))
		}
		expect(hub.connections[0]?.server.status).to.equal("connected")
	})

	afterEach(async () => {
		Module.prototype.require = originalRequire
		await hub.dispose()
		HostProvider.reset()
		await fs.rm(dir, { recursive: true, force: true })
	})

	const flags = async () => (await hub.fetchToolsList("s")).map((t: any) => [t.name, t.autoApprove])

	it("an unconfirmed agent edit does not auto-approve on refresh, and Revert leaves nothing in memory", async () => {
		expect(await flags()).to.deep.equal([
			["describe_tool", true],
			["run_python", false],
		])

		// 1. Agent edit: adds run_python to autoApprove on disk.
		const edited = { mcpServers: { s: launch(["describe_tool", "run_python"]) } }
		await fs.writeFile(file, JSON.stringify(edited))

		// 2. Refresh before the watcher has run (or while the dialog is open): the raw file says run_python, the host must not.
		expect(await flags()).to.deep.equal([
			["describe_tool", true],
			["run_python", false],
		])

		// 3. The watcher path: the user declines.
		answer = "Revert"
		const settings = await hub.readAndValidateMcpSettingsFile()
		const effective = await hub.policyGate.gateExternal(settings.mcpServers)
		await hub.updateServerConnections(effective)
		hub.syncToolApproveFlags()
		expect(prompts).to.have.length(1)
		expect(await flags()).to.deep.equal([
			["describe_tool", true],
			["run_python", false],
		])
		expect(hub.connections[0].server.tools.map((t: any) => [t.name, t.autoApprove])).to.deep.equal([
			["describe_tool", true],
			["run_python", false],
		])
		// ...and the connection state the webview and trust checks read carries no unconfirmed policy.
		expect(JSON.stringify(hub.connections[0].server.config)).to.not.include("run_python")
		const onDisk = JSON.parse(await fs.readFile(file, "utf-8"))
		expect(onDisk.mcpServers.s.autoApprove).to.deep.equal(["describe_tool"])
	})

	it("a reconnect through the RPC path does not carry an unconfirmed edit into connection state", async () => {
		await fs.writeFile(file, JSON.stringify({ mcpServers: { s: launch(["describe_tool", "run_python"]) } }))
		const settings = await hub.readAndValidateMcpSettingsFile()
		await hub.updateServerConnectionsRPC(settings.mcpServers)
		expect(await flags()).to.deep.equal([
			["describe_tool", true],
			["run_python", false],
		])
	})

	it("after the user confirms, the flag takes effect", async () => {
		answer = "Apply changes"
		await fs.writeFile(file, JSON.stringify({ mcpServers: { s: launch(["describe_tool", "run_python"]) } }))
		const settings = await hub.readAndValidateMcpSettingsFile()
		const effective = await hub.policyGate.gateExternal(settings.mcpServers)
		await hub.updateServerConnections(effective)
		hub.syncToolApproveFlags()
		expect(await flags()).to.deep.equal([
			["describe_tool", true],
			["run_python", true],
		])
	})

	// M-3: a launch-identity change on a server that keeps a grant is a loosening (defence in depth; the run-time
	// recheck in mcpAutoApprove.ts is the primary control).
	describe("M-3: launch-identity change on a server with grants", () => {
		const watch = async (servers: Record<string, unknown>) => {
			await fs.writeFile(file, JSON.stringify({ mcpServers: servers }))
			const settings = await hub.readAndValidateMcpSettingsFile()
			const effective = await hub.policyGate.gateExternal(settings.mcpServers)
			await hub.updateServerConnections(effective)
			hub.syncToolApproveFlags()
		}
		const onDisk = async () => JSON.parse(await fs.readFile(file, "utf-8")).mcpServers.s

		it("(f) an external edit that changes command is classified as a loosening, asked, and reverted on decline", async () => {
			const original = launch(["describe_tool"])
			const changed = { ...original, command: "/usr/bin/env", args: [(original as any).command, ...(original as any).args] }
			expect(
				findLoosenings(policySnapshot({ s: original } as any), { s: changed } as any).map((c) => c.kind),
			).to.deep.equal(["launch-changed"])
			answer = "Revert"
			await watch({ s: changed })
			expect(prompts).to.have.length(1)
			expect(prompts[0]).to.include("different command")
			const disk = await onDisk()
			expect(disk.command).to.equal((original as any).command)
			expect(disk.args).to.deep.equal((original as any).args)
			expect(disk.autoApprove).to.deep.equal(["describe_tool"])
		})

		it("(f) env and cwd changes count too, and confirming applies the new launch", async () => {
			const original = launch(["describe_tool"])
			answer = "Apply changes"
			await watch({ s: { ...original, env: { PYTHONPATH: "/elsewhere" } } })
			expect(prompts).to.have.length(1)
			expect((await onDisk()).env).to.deep.equal({ PYTHONPATH: "/elsewhere" })
			await watch({ s: { ...original, env: { PYTHONPATH: "/elsewhere" }, cwd: dir } })
			expect(prompts).to.have.length(2)
		})

		it("(g) the same edit on a server with no grants needs no confirmation", async () => {
			const original = launch([])
			await watch({ s: original }) // tightening: grant removed, no prompt
			expect(prompts).to.have.length(0)
			await watch({ s: { ...original, env: { PYTHONPATH: "/elsewhere" }, cwd: dir } })
			expect(prompts).to.have.length(0)
			expect((await onDisk()).env).to.deep.equal({ PYTHONPATH: "/elsewhere" })
		})

		it("a non-identity edit (timeout) on a server with grants needs no confirmation", async () => {
			await watch({ s: { ...launch(["describe_tool"]), timeout: 120 } })
			expect(prompts).to.have.length(0)
		})
	})
})
