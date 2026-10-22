import { recordFirstPartyLauncher } from "@core/mcp/firstPartyLauncher"
import { isMcpToolGrantedAutoApprove } from "@core/task/tools/mcpAutoApprove"
import { formatAutoApproveRefusal, parseAutoApproveRefusal } from "@shared/aihydro/alwaysAllowPolicy"
import { setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"

/**
 * W2-E1: the host refuses "Always" (toggleToolAutoApproveRPC adds) for untrusted servers and for tools whose
 * effect class is DESTRUCTIVE or UNKNOWN, whatever the webview asks for. A real McpHub, a real stdio MCP server and a
 * real settings file; only the webview stream (subscribeToMcpServers) is stubbed, as in McpHubPolicyGate.test.ts.
 */
const Module = require("module")
const originalRequire = Module.prototype.require
const STUBBED = "@core/controller/mcp/subscribeToMcpServers"

const TOOLS = [
	{ name: "read_tool", annotations: { readOnlyHint: true, openWorldHint: false } },
	{ name: "write_tool", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
	{ name: "nuke_tool", annotations: { destructiveHint: true } },
	{ name: "bare_tool" },
]

const SERVER_SCRIPT = (sdk: string, tools: unknown) => `
const { Server } = require(${JSON.stringify(sdk + "/server/index.js")})
const { StdioServerTransport } = require(${JSON.stringify(sdk + "/server/stdio.js")})
const { ListToolsRequestSchema, CallToolRequestSchema } = require(${JSON.stringify(sdk + "/types.js")})
const server = new Server({ name: "stub", version: "0.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ${JSON.stringify(tools)}.map((t) => ({ ...t, inputSchema: { type: "object" } })),
}))
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }))
server.connect(new StdioServerTransport())
`

describe("McpHub.toggleToolAutoApproveRPC refuses Always for ineligible tools (W2-E1)", function () {
	this.timeout(60_000)
	let dir: string
	let file: string
	let script: string
	let hub: any

	const readFile = () => fs.readFile(file, "utf-8")
	const onDisk = async (name: string) => JSON.parse(await readFile()).mcpServers[name].autoApprove as string[] | undefined

	/** Starts a hub with one server named `name`; `trusted` records its launcher as the first-party launcher. */
	async function start(name: string, opts: { trusted: boolean; autoApprove?: string[]; tools?: unknown }) {
		await fs.writeFile(
			script,
			SERVER_SCRIPT(
				path.resolve(__dirname, "../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs"),
				opts.tools ?? TOOLS,
			),
		)
		if (opts.trusted) {
			// McpHub reloads the launcher from the persisted record at startup (replacing anything set in memory),
			// so the record is written the way registration writes it; this also installs it in memory.
			await recordFirstPartyLauncher(dir, { name, command: process.execPath, args: [script] })
		}
		await fs.writeFile(
			file,
			JSON.stringify({
				mcpServers: { [name]: { command: process.execPath, args: [script], autoApprove: opts.autoApprove ?? [] } },
			}),
		)
		const { McpHub } = await import("../McpHub")
		hub = new McpHub(
			async () => dir,
			async () => dir,
			"0.0.0",
			{} as any,
		)
		for (
			let i = 0;
			i < 400 &&
			!(
				hub.policyGate.baselineSet &&
				hub.connections[0]?.server.status === "connected" &&
				hub.connections[0].server.tools?.length
			);
			i++
		) {
			await new Promise((r) => setTimeout(r, 25))
		}
		expect(hub.connections[0]?.server.status).to.equal("connected")
		expect(hub.connections[0].server.tools.map((t: any) => t.name)).to.deep.equal(TOOLS.map((t) => t.name))
	}

	const refusalOf = async (call: Promise<unknown>) => {
		try {
			await call
		} catch (error) {
			return parseAutoApproveRefusal((error as Error).message)
		}
		return undefined
	}

	beforeEach(async () => {
		Module.prototype.require = function (request: string) {
			if (request === STUBBED) {
				return { sendMcpServersUpdate: async () => {} }
			}
			return originalRequire.call(this, request)
		}
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcphub-always-"))
		file = path.join(dir, "aihydro_mcp_settings.json")
		script = path.join(dir, "stub-server.js")
		HostProvider.reset()
		HostProvider.initialize(
			(() => {}) as any,
			(() => {}) as any,
			{ windowClient: { showMessage: async () => ({ selectedOption: "Revert" }) } } as any,
			() => {},
			async () => "",
			async () => "",
			"/mock/extension",
			dir,
		)
	})

	afterEach(async () => {
		Module.prototype.require = originalRequire
		setRecordedFirstPartyLauncher(undefined)
		await hub?.dispose()
		HostProvider.reset()
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("(a) an untrusted server is refused for every tool and the settings file is byte-identical", async () => {
		await start("stub", { trusted: false })
		const before = await readFile()
		for (const tool of TOOLS) {
			const refusal = await refusalOf(hub.toggleToolAutoApproveRPC("stub", [tool.name], true))
			expect(refusal, tool.name).to.deep.equal({
				server: "stub",
				refused: [{ tool: tool.name, reason: "untrusted_server" }],
			})
		}
		expect(await readFile()).to.equal(before)
	})

	it("(a) a first-party NAME without a recorded launcher is untrusted too", async () => {
		await start("ai-hydro", { trusted: false })
		const before = await readFile()
		const refusal = await refusalOf(hub.toggleToolAutoApproveRPC("ai-hydro", ["read_tool"], true))
		expect(refusal?.refused[0].reason).to.equal("untrusted_server")
		expect(await readFile()).to.equal(before)
	})

	it("(a) an untrusted server that declares readOnlyHint is still refused", async () => {
		await start("stub", { trusted: false })
		const before = await readFile()
		const refusal = await refusalOf(hub.toggleToolAutoApproveRPC("stub", ["read_tool"], true))
		expect(refusal?.refused).to.deep.equal([{ tool: "read_tool", reason: "untrusted_server" }])
		expect(await readFile()).to.equal(before)
	})

	it("(b) a trusted server accepts read and write tools and refuses destructive and undeclared ones", async () => {
		await start("ai-hydro", { trusted: true })
		const servers = await hub.toggleToolAutoApproveRPC("ai-hydro", ["read_tool", "write_tool"], true)
		expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool", "write_tool"])
		expect(servers[0].tools.filter((t: any) => t.autoApprove).map((t: any) => t.name)).to.deep.equal([
			"read_tool",
			"write_tool",
		])

		const nuke = await refusalOf(hub.toggleToolAutoApproveRPC("ai-hydro", ["nuke_tool"], true))
		expect(nuke?.refused).to.deep.equal([{ tool: "nuke_tool", reason: "destructive" }])
		const bare = await refusalOf(hub.toggleToolAutoApproveRPC("ai-hydro", ["bare_tool"], true))
		expect(bare?.refused).to.deep.equal([{ tool: "bare_tool", reason: "unknown_effect" }])
		expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool", "write_tool"])
	})

	it("(b) names are exact and case-sensitive; an unlisted name is unknown_tool", async () => {
		await start("ai-hydro", { trusted: true })
		const before = await readFile()
		const refusal = await refusalOf(hub.toggleToolAutoApproveRPC("ai-hydro", ["READ_TOOL", "missing_tool"], true))
		expect(refusal?.refused).to.deep.equal([
			{ tool: "READ_TOOL", reason: "unknown_tool" },
			{ tool: "missing_tool", reason: "unknown_tool" },
		])
		expect(await readFile()).to.equal(before)
	})

	it("(c) a mixed batch is all-or-nothing: nothing is written", async () => {
		await start("ai-hydro", { trusted: true })
		const before = await readFile()
		const refusal = await refusalOf(
			hub.toggleToolAutoApproveRPC("ai-hydro", ["read_tool", "write_tool", "nuke_tool", "bare_tool"], true),
		)
		expect(refusal?.refused).to.deep.equal([
			{ tool: "nuke_tool", reason: "destructive" },
			{ tool: "bare_tool", reason: "unknown_effect" },
		])
		expect(await readFile()).to.equal(before)
		expect(hub.connections[0].server.tools.some((t: any) => t.autoApprove)).to.equal(false)
	})

	it("a server with no settings entry is refused without a TypeError and writes nothing", async () => {
		await start("ai-hydro", { trusted: true })
		const before = await readFile()
		let message = ""
		try {
			await hub.toggleToolAutoApproveRPC("not-configured", ["read_tool"], true)
		} catch (error) {
			message = (error as Error).message
		}
		expect(message).to.include("not found in MCP configuration")
		expect(await readFile()).to.equal(before)
	})

	it("(d) removing a tool is always accepted, even a destructive one already in the baseline, on any server", async () => {
		await start("stub", { trusted: false, autoApprove: ["nuke_tool", "read_tool"] })
		expect(await onDisk("stub")).to.deep.equal(["nuke_tool", "read_tool"])
		await hub.toggleToolAutoApproveRPC("stub", ["nuke_tool"], false)
		expect(await onDisk("stub")).to.deep.equal(["read_tool"])
		await hub.toggleToolAutoApproveRPC("stub", ["read_tool"], false)
		expect(await onDisk("stub")).to.deep.equal([])
	})

	it("(e) the refusal format round-trips", () => {
		const refusal = {
			server: "s",
			refused: [
				{ tool: "a", reason: "destructive" as const },
				{ tool: "b", reason: "unknown_effect" as const },
			],
		}
		expect(parseAutoApproveRefusal(formatAutoApproveRefusal(refusal))).to.deep.equal(refusal)
		expect(parseAutoApproveRefusal(`Error: 13 INTERNAL: ${formatAutoApproveRefusal(refusal)}`)).to.deep.equal(refusal)
		expect(parseAutoApproveRefusal("something else")).to.equal(undefined)
		expect(parseAutoApproveRefusal(undefined)).to.equal(undefined)
	})

	// M-2 (host part). The use_mcp_tool decision reads the host's connection state (isMcpToolGrantedAutoApprove,
	// the helper UseMcpToolHandler calls). A full Task-level run is not practical here, so this asserts that decision
	// against settings the host really wrote.
	describe("M-2: the second use_mcp_tool decision follows the written grant", () => {
		it("after an accepted Always the file holds the grant, the decision skips the ask, and a restarted host agrees", async () => {
			await start("ai-hydro", { trusted: true })
			expect(isMcpToolGrantedAutoApprove(hub, "ai-hydro", "read_tool")).to.equal(false)
			await hub.toggleToolAutoApproveRPC("ai-hydro", ["read_tool"], true)
			expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"])
			expect(isMcpToolGrantedAutoApprove(hub, "ai-hydro", "read_tool")).to.equal(true)
			expect(isMcpToolGrantedAutoApprove(hub, "ai-hydro", "write_tool")).to.equal(false)

			await hub.dispose()
			const { McpHub } = await import("../McpHub")
			hub = new McpHub(
				async () => dir,
				async () => dir,
				"0.0.0",
				{} as any,
			)
			for (
				let i = 0;
				i < 400 &&
				!(
					hub.policyGate.baselineSet &&
					hub.connections[0]?.server.status === "connected" &&
					hub.connections[0].server.tools?.length
				);
				i++
			) {
				await new Promise((r) => setTimeout(r, 25))
			}
			expect(isMcpToolGrantedAutoApprove(hub, "ai-hydro", "read_tool")).to.equal(true)
		})

		it("after a refused Always the file is unchanged and the decision still asks", async () => {
			await start("ai-hydro", { trusted: true })
			const before = await readFile()
			expect(await refusalOf(hub.toggleToolAutoApproveRPC("ai-hydro", ["nuke_tool"], true))).to.not.equal(undefined)
			expect(await readFile()).to.equal(before)
			expect(isMcpToolGrantedAutoApprove(hub, "ai-hydro", "nuke_tool")).to.equal(false)
		})

		it("an untrusted server stays on the ask path after a refused Always", async () => {
			await start("stub", { trusted: false })
			await refusalOf(hub.toggleToolAutoApproveRPC("stub", ["read_tool"], true))
			expect(isMcpToolGrantedAutoApprove(hub, "stub", "read_tool")).to.equal(false)
		})

		it("an unknown server or tool never counts as granted", () => {
			expect(isMcpToolGrantedAutoApprove(undefined, "s", "t")).to.equal(false)
			expect(isMcpToolGrantedAutoApprove({ connections: [] }, "s", "t")).to.equal(false)
		})
	})
})
