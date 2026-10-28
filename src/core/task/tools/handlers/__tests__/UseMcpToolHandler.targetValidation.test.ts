import { expect } from "chai"
import sinon from "sinon"
import { checkMcpToolName, closestNames } from "../mcpToolNameValidation"
import { UseMcpToolHandler } from "../UseMcpToolHandler"

const tools = ["list_claims", "add_claim", "get_claim", "start_session", "fetch_camels_us"].map((name) => ({ name }))
const connections = [
	{ server: { name: "aihydro-tools", status: "connected", tools } },
	{ server: { name: "no-list", status: "connected" } },
] as any[]

function makeConfig(conns: any[] | undefined = connections) {
	const callbacks = {
		say: sinon.stub().resolves(1),
		ask: sinon.stub().resolves({}),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon.stub().returns(false),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
	}
	const mcpHub = { connections: conns, callTool: sinon.stub().resolves({ content: [] }), getPendingNotifications: () => [] }
	const config: any = {
		callbacks,
		services: { mcpHub },
		taskState: { consecutiveMistakeCount: 0 },
		autoApprovalSettings: { enabled: false },
		ulid: "u1",
		api: { getModel: () => ({ id: "m", info: {} }) },
	}
	return { config, callbacks, mcpHub }
}

const block = (tool_name: string, server_name = "aihydro-tools") =>
	({ name: "use_mcp_tool", params: { server_name, tool_name } }) as any

describe("use_mcp_tool target validation (M2)", () => {
	it("returns a structured error with close names and never asks for approval when the tool does not exist", async () => {
		const { config, callbacks, mcpHub } = makeConfig()
		const out = await new UseMcpToolHandler().execute(config, block("ask_followup_question"))
		expect(String(out)).to.include("ask_followup_question")
		expect(String(out)).to.include("does not exist on MCP server 'aihydro-tools'")
		expect(String(out)).to.include("Closest names:")
		expect(String(out)).to.include("built-in tool")
		expect(callbacks.ask.called, "no approval ask").to.equal(false)
		expect(mcpHub.callTool.called, "tool not called").to.equal(false)
		// exactly one muted line
		const infoCalls = callbacks.say.getCalls().filter((c) => c.args[0] === "info")
		expect(infoCalls).to.have.length(1)
		expect(callbacks.say.callCount).to.equal(1)
		expect(config.taskState.consecutiveMistakeCount).to.equal(1)
	})

	it("also refuses an unknown server without asking", async () => {
		const { config, callbacks } = makeConfig()
		const out = await new UseMcpToolHandler().execute(config, block("list_claims", "ghost"))
		expect(String(out)).to.include("'ghost' is not connected")
		expect(callbacks.ask.called).to.equal(false)
	})

	it("checkMcpToolName accepts a real tool and never guesses when the tool list is unknown", () => {
		expect(checkMcpToolName(connections, "aihydro-tools", "add_claim")).to.deep.equal({ ok: true })
		expect(checkMcpToolName(connections, "no-list", "anything")).to.deep.equal({ ok: true })
		expect(checkMcpToolName(undefined, "x", "y")).to.deep.equal({ ok: true })
	})

	it("an unknown tool list (failed tools/list -> undefined) or a not-connected server never blocks a call", async () => {
		const unknown = [
			{ server: { name: "s", status: "connected", tools: undefined } },
			{ server: { name: "d", status: "disconnected", tools: [] } },
		] as any[]
		expect(checkMcpToolName(unknown, "s", "anything")).to.deep.equal({ ok: true })
		expect(checkMcpToolName(unknown, "d", "anything")).to.deep.equal({ ok: true })
		const { config, callbacks, mcpHub } = makeConfig(unknown)
		await new UseMcpToolHandler().execute(config, block("anything", "s"))
		expect(callbacks.ask.called || mcpHub.callTool.called, "reached the normal approval/call path").to.equal(true)
	})

	it("a connected server with a known list still refuses a missing tool; unknown-server message lists only connected servers", () => {
		const conns = [
			{ server: { name: "up", status: "connected", tools: [{ name: "a" }] } },
			{ server: { name: "down", status: "disconnected", tools: [] } },
		] as any[]
		const r = checkMcpToolName(conns, "up", "b")
		expect(r.ok).to.equal(false)
		const u = checkMcpToolName(conns, "ghost", "b") as any
		expect(u.message).to.include("up")
		expect(u.message).to.not.include("down")
	})

	it("closestNames ranks related names first and caps the list", () => {
		const names = closestNames("list_claim", ["zzz", "list_claims", "add_claim", "get_claim", "start_session", "q", "w"])
		expect(names[0]).to.equal("list_claims")
		expect(names.length).to.be.at.most(5)
	})
})

describe("use_mcp_tool structured evidence (W2-0h)", () => {
	it("tags the skipped-call info with its class, and the words stay", async () => {
		const unknownTool = makeConfig()
		await new UseMcpToolHandler().execute(unknownTool.config, block("ask_followup_question"))
		const [type, text, , , , evidence] = unknownTool.callbacks.say.getCall(0).args
		expect(type).to.equal("info")
		expect(text).to.match(/^Skipped: 'ask_followup_question' is not a tool on 'aihydro-tools'/)
		expect(evidence).to.deep.equal({ infoNotice: { class: "unknown_tool", severity: "warning" } })

		const ghost = makeConfig()
		await new UseMcpToolHandler().execute(ghost.config, block("list_claims", "ghost"))
		expect(ghost.callbacks.say.getCall(0).args[5]).to.deep.equal({
			infoNotice: { class: "server_not_connected", severity: "warning" },
		})
	})

	it("carries the MCP notification level on the row", async () => {
		const { config, callbacks, mcpHub } = makeConfig([
			{ server: { name: "aihydro-tools", status: "connected", tools: [{ name: "list_claims", autoApprove: true }] } },
		])
		let calls = 0
		;(mcpHub as any).getPendingNotifications = () =>
			calls++ === 0 ? [{ serverName: "aihydro-tools", level: "warning", message: "rate limited", timestamp: 1 }] : []
		config.callbacks.shouldAutoApproveTool = sinon.stub().returns(true)
		// This stub server has no recorded launcher, so the M-3 run-time recheck asks; the user approves here.
		callbacks.ask = sinon.stub().resolves({ response: "yesButtonClicked" })
		await new UseMcpToolHandler().execute(config, block("list_claims")).catch(() => {})
		const notice = callbacks.say.getCalls().find((c) => c.args[0] === "mcp_notification")
		expect(notice?.args[1]).to.equal("[aihydro-tools] rate limited")
		expect(notice?.args[5]).to.deep.equal({ mcpLevel: "warning" })
	})
})
