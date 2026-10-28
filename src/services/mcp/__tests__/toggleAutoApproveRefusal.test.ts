import { recordFirstPartyLauncher } from "@core/mcp/firstPartyLauncher"
import { AccessMcpResourceHandler } from "@core/task/tools/handlers/AccessMcpResourceHandler"
import { UseMcpToolHandler } from "@core/task/tools/handlers/UseMcpToolHandler"
import { isMcpToolGrantedAutoApprove, mcpAutoApproveDecision } from "@core/task/tools/mcpAutoApprove"
import { formatAutoApproveRefusal, parseAutoApproveRefusal } from "@shared/aihydro/alwaysAllowPolicy"
import { getRecordedFirstPartyLauncher, setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
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

	it("N2: a server name is looked up as an own property only (__proto__, constructor, ...)", async () => {
		await start("ai-hydro", { trusted: true })
		const before = await readFile()
		for (const name of ["__proto__", "constructor", "hasOwnProperty", "toString"]) {
			for (const shouldAllow of [true, false]) {
				let message = ""
				try {
					await hub.toggleToolAutoApproveRPC(name, ["read_tool"], shouldAllow)
				} catch (error) {
					message = (error as Error).message
				}
				expect(message, `${name} allow=${shouldAllow}`).to.include("not found in MCP configuration")
			}
		}
		expect(await readFile()).to.equal(before)
		expect(({} as any).autoApprove).to.equal(undefined)
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

	// M-3: a stored grant is rechecked against the live connection every time the tool runs. The decision is read
	// through the real UseMcpToolHandler (not only the helper), against a real hub, a real stdio server and the real
	// settings file. The grant is never deleted: only the auto-run is paused.
	describe("M-3: Always is rechecked when the tool runs", () => {
		const sdkDir = () => path.resolve(__dirname, "../../../../node_modules/@modelcontextprotocol/sdk/dist/cjs")
		const NUKE = { destructiveHint: true }

		/** Runs use_mcp_tool through the real handler with MCP auto-run switched on. */
		async function runHandler(tool: string, server = "ai-hydro") {
			const callbacks = {
				say: sinon.stub().resolves(1),
				ask: sinon.stub().resolves({ response: "noButtonClicked" }),
				removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
				shouldAutoApproveTool: sinon.stub().returns(true),
				sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
			}
			const config: any = {
				callbacks,
				services: { mcpHub: hub },
				taskState: { consecutiveMistakeCount: 0, consecutiveAutoApprovedRequestsCount: 0, userMessageContent: [] },
				autoApprovalSettings: { enabled: true, enableNotifications: false },
				yoloModeToggled: false,
				cwd: dir,
				api: { getModel: () => ({ id: "m", info: {} }) },
			}
			const out = await new UseMcpToolHandler().execute(config, {
				name: "use_mcp_tool",
				params: { server_name: server, tool_name: tool },
			} as any)
			const asked = callbacks.ask.called
			const askPayload = asked ? JSON.parse(callbacks.ask.firstCall.args[1]) : undefined
			const autoRan = callbacks.say.getCalls().some((c) => c.args[0] === "use_mcp_server")
			return { out: String(out), asked, askPayload, autoRan }
		}

		/** Rewrites the stub's tool list and reconnects, as a server upgrade would. */
		async function reconnectWith(tools: unknown) {
			await fs.writeFile(script, SERVER_SCRIPT(sdkDir(), tools))
			await hub.restartConnection("ai-hydro")
			for (
				let i = 0;
				i < 400 && !(hub.connections[0]?.server.status === "connected" && hub.connections[0].server.tools?.length);
				i++
			) {
				await new Promise((r) => setTimeout(r, 25))
			}
			expect(hub.connections[0].server.status).to.equal("connected")
		}

		beforeEach(async () => {
			await start("ai-hydro", { trusted: true })
			await hub.toggleToolAutoApproveRPC("ai-hydro", ["read_tool"], true)
			expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"])
		})

		it("(a) a granted tool on a trusted server auto-runs through the handler without asking", async () => {
			expect(mcpAutoApproveDecision(hub, "ai-hydro", "read_tool")).to.deep.equal({ auto: true })
			const r = await runHandler("read_tool")
			expect(r.asked).to.equal(false)
			expect(r.autoRan).to.equal(true)
		})

		it("(b) the same grant asks once the launcher record changes, and says why; the grant stays in the file", async () => {
			const recorded = getRecordedFirstPartyLauncher()!
			setRecordedFirstPartyLauncher({ ...recorded, command: "/some/other/python" })
			const decision = mcpAutoApproveDecision(hub, "ai-hydro", "read_tool")
			expect(decision).to.include({ auto: false, granted: true, reason: "untrusted_server" })
			const r = await runHandler("read_tool")
			expect(r.asked).to.equal(true)
			expect(r.autoRan).to.equal(false)
			expect(r.askPayload.autoApprovePaused).to.equal(
				"Always for read_tool is paused: this server is not the registered first-party server, or its launch identity changed.",
			)
			expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"]) // (e)

			// Restoring the record resumes the grant by itself: nothing was deleted.
			setRecordedFirstPartyLauncher(recorded)
			expect((await runHandler("read_tool")).asked).to.equal(false)
		})

		it("(b) a changed launchHash (env/cwd) also loses trust", async () => {
			const recorded = getRecordedFirstPartyLauncher()!
			setRecordedFirstPartyLauncher({ ...recorded, launchHash: "0".repeat(64) })
			const r = await runHandler("read_tool")
			expect(r.asked).to.equal(true)
			expect(r.askPayload.autoApprovePaused).to.include("or its launch identity changed")
		})

		it("(c) the same grant asks after a reconnect in which the tool is annotated destructive", async () => {
			await reconnectWith(TOOLS.map((t) => (t.name === "read_tool" ? { ...t, annotations: NUKE } : t)))
			expect(mcpAutoApproveDecision(hub, "ai-hydro", "read_tool")).to.include({ auto: false, reason: "destructive" })
			const r = await runHandler("read_tool")
			expect(r.asked).to.equal(true)
			expect(r.autoRan).to.equal(false)
			expect(r.askPayload.autoApprovePaused).to.equal("Always for read_tool is paused: the tool is now marked destructive.")
			expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"]) // (e)
		})

		it("(c) and when the annotations are dropped altogether (effect no longer declared)", async () => {
			await reconnectWith(TOOLS.map((t) => (t.name === "read_tool" ? { name: t.name } : t)))
			const r = await runHandler("read_tool")
			expect(r.asked).to.equal(true)
			expect(r.askPayload.autoApprovePaused).to.include("no longer declares what it does")
			expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"])
		})

		it("(d) a duplicated tool name asks; the grant stays", async () => {
			const read = TOOLS[0]
			await reconnectWith([...TOOLS, { ...read }])
			expect(mcpAutoApproveDecision(hub, "ai-hydro", "read_tool")).to.include({ auto: false, reason: "unknown_tool" })
			const r = await runHandler("read_tool")
			expect(r.asked).to.equal(true)
			expect(r.autoRan).to.equal(false)
			expect(r.askPayload.autoApprovePaused).to.include(
				"does not list this tool exactly once".replace("does not list", "no longer lists"),
			)
			expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"])
		})

		it("(d) a tool that disappeared never auto-runs (the helper says unknown_tool; the handler refuses before any ask)", async () => {
			await reconnectWith(TOOLS.filter((t) => t.name !== "read_tool"))
			expect(isMcpToolGrantedAutoApprove(hub, "ai-hydro", "read_tool")).to.equal(false)
			const r = await runHandler("read_tool")
			expect(r.autoRan).to.equal(false)
			expect(r.out).to.include("does not exist")
			expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"])
		})

		it("a disconnected server asks", async () => {
			hub.connections[0].server.status = "disconnected"
			expect(mcpAutoApproveDecision(hub, "ai-hydro", "read_tool")).to.include({ auto: false, reason: "server_unavailable" })
		})

		it("a tool with no grant is not reported as paused, only as not granted", async () => {
			expect(mcpAutoApproveDecision(hub, "ai-hydro", "write_tool")).to.deep.equal({ auto: false, granted: false })
			const r = await runHandler("write_tool")
			expect(r.asked).to.equal(true)
			expect(r.askPayload.autoApprovePaused).to.equal(undefined)
		})

		// N1: callTool looks the connection up again by name, so the identity decided on is rechecked right before it.
		describe("N1: the connection is rechecked immediately before callTool", () => {
			/** A hub view that swaps the launcher record (the trusted identity) when `swap` runs, i.e. between the decision and the call. */
			function swappingHub(swap: () => void, when: "notify" | "never" = "notify") {
				let swapped = false
				const callTool = sinon.stub().resolves({ content: [{ type: "text", text: "ran" }] })
				const view: any = {
					get connections() {
						return hub.connections
					},
					callTool,
					getPendingNotifications: () => {
						if (when === "notify" && !swapped) {
							swapped = true
							swap()
						}
						return []
					},
				}
				return { view, callTool, swapNow: () => swap() }
			}
			const cfg = (view: any, ask: sinon.SinonStub) => {
				const callbacks = {
					say: sinon.stub().resolves(1),
					ask,
					removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
					shouldAutoApproveTool: sinon.stub().returns(true),
					sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
				}
				const config: any = {
					callbacks,
					services: { mcpHub: view },
					taskState: { consecutiveMistakeCount: 0, consecutiveAutoApprovedRequestsCount: 0, userMessageContent: [] },
					autoApprovalSettings: { enabled: true, enableNotifications: false },
					yoloModeToggled: false,
					cwd: dir,
					api: { getModel: () => ({ id: "m", info: {} }) },
				}
				return config
			}
			const run = (config: any, tool: string) =>
				new UseMcpToolHandler().execute(config, {
					name: "use_mcp_tool",
					params: { server_name: "ai-hydro", tool_name: tool },
				} as any)
			const loseTrust = () => {
				const recorded = getRecordedFirstPartyLauncher()!
				setRecordedFirstPartyLauncher({ ...recorded, command: "/some/other/python" })
			}

			it("an auto-run whose server is swapped before the call asks first, and a refusal means no call", async () => {
				const { view, callTool } = swappingHub(loseTrust)
				const ask = sinon.stub().resolves({ response: "noButtonClicked" })
				await run(cfg(view, ask), "read_tool")
				expect(ask.calledOnce).to.equal(true)
				expect(JSON.parse(ask.firstCall.args[1]).autoApprovePaused).to.include("the server changed")
				expect(callTool.called).to.equal(false)
				expect(await onDisk("ai-hydro")).to.deep.equal(["read_tool"])
			})

			it("an auto-run whose server is NOT swapped calls without asking", async () => {
				const { view, callTool } = swappingHub(loseTrust, "never")
				const ask = sinon.stub().resolves({ response: "noButtonClicked" })
				await run(cfg(view, ask), "read_tool")
				expect(ask.called).to.equal(false)
				expect(callTool.calledOnce).to.equal(true)
			})

			it("an approval given for one server is void if it is swapped while the ask is open: error, no call", async () => {
				const { view, callTool } = swappingHub(loseTrust, "never")
				const ask = sinon.stub().callsFake(async () => {
					loseTrust()
					return { response: "yesButtonClicked" }
				})
				const out = await run(cfg(view, ask), "write_tool") // no grant: the manual path
				expect(ask.calledOnce).to.equal(true)
				expect(String(out)).to.include("changed after you approved")
				expect(callTool.called).to.equal(false)
			})
		})

		// N4: any throw while deciding means ask.
		it("N4: a throw while deciding asks (fail closed)", async () => {
			const throwing: any = {
				get connections() {
					throw new Error("boom")
				},
			}
			const d = mcpAutoApproveDecision(throwing, "ai-hydro", "read_tool")
			expect(d).to.include({ auto: false, granted: true, reason: "check_failed" })
			expect(isMcpToolGrantedAutoApprove(throwing, "ai-hydro", "read_tool")).to.equal(false)
			const tools = hub.connections[0].server.tools
			const realFind = tools.find
			// A tool list whose lookup throws once the handler's own target check has passed.
			let armed = false
			tools.find = function (...a: any[]) {
				if (armed) {
					throw new Error("boom")
				}
				return realFind.apply(this, a)
			}
			const decisionHub: any = { connections: hub.connections }
			armed = true
			expect(mcpAutoApproveDecision(decisionHub, "ai-hydro", "read_tool")).to.include({ reason: "check_failed" })
			armed = false
			tools.find = realFind
		})

		// N5: the streaming placeholder is the auto-approved row only if the call would really auto-run.
		it("N5: handlePartialBlock shows the auto-approved row only when the call would auto-run", async () => {
			const mk = () => {
				const ui: any = {
					removeClosingTag: (_b: any, _n: string, v: string) => v,
					removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
					say: sinon.stub().resolves(1),
					ask: sinon.stub().resolves({}),
				}
				ui.getConfig = () => ({ callbacks: { shouldAutoApproveTool: () => true }, services: { mcpHub: hub } })
				return ui
			}
			const block = (tool: string) =>
				({ name: "use_mcp_tool", partial: true, params: { server_name: "ai-hydro", tool_name: tool } }) as any
			const ok = mk()
			await new UseMcpToolHandler().handlePartialBlock(block("read_tool"), ok)
			expect(ok.say.called).to.equal(true)
			expect(ok.ask.called).to.equal(false)
			const recorded = getRecordedFirstPartyLauncher()!
			setRecordedFirstPartyLauncher({ ...recorded, command: "/some/other/python" })
			const paused = mk()
			await new UseMcpToolHandler().handlePartialBlock(block("read_tool"), paused)
			expect(paused.say.called).to.equal(false)
			expect(paused.ask.called).to.equal(true)
		})

		// N2: a resource read auto-runs only against the trusted first-party server, YOLO or not.
		describe("N2: access_mcp_resource", () => {
			const runResource = async (server: string) => {
				const readResource = sinon.stub().resolves({ contents: [{ text: "body" }] })
				const callbacks = {
					say: sinon.stub().resolves(1),
					ask: sinon.stub().resolves({ response: "noButtonClicked" }),
					removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
					shouldAutoApproveTool: sinon.stub().returns(true), // MCP auto-run on, or YOLO: both land here
					sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
				}
				const config: any = {
					callbacks,
					services: { mcpHub: { connections: hub.connections, readResource } },
					taskState: { consecutiveMistakeCount: 0, consecutiveAutoApprovedRequestsCount: 0, userMessageContent: [] },
					autoApprovalSettings: { enabled: true, enableNotifications: false },
					yoloModeToggled: true,
					api: { getModel: () => ({ id: "m", info: {} }) },
				}
				await new AccessMcpResourceHandler().execute(config, {
					name: "access_mcp_resource",
					params: { server_name: server, uri: "file:///x" },
				} as any)
				return { callbacks, readResource }
			}

			it("auto-reads from the trusted first-party server", async () => {
				const { callbacks, readResource } = await runResource("ai-hydro")
				expect(callbacks.ask.called).to.equal(false)
				expect(readResource.calledOnce).to.equal(true)
			})

			it("asks, with a neutral reason, once the server is not the recorded first-party launcher", async () => {
				setRecordedFirstPartyLauncher({ ...getRecordedFirstPartyLauncher()!, command: "/some/other/python" })
				const { callbacks, readResource } = await runResource("ai-hydro")
				expect(callbacks.ask.calledOnce).to.equal(true)
				expect(JSON.parse(callbacks.ask.firstCall.args[1]).autoApprovePaused).to.equal(
					"Auto-run is off for this server: it is not the registered first-party server, or its launch identity changed.",
				)
				expect(readResource.called).to.equal(false)
			})
		})
	})
})
