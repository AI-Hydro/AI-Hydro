import { expect } from "chai"
import sinon from "sinon"
import { checkMcpToolName, closestNames } from "../mcpToolNameValidation"
import { UseMcpToolHandler } from "../UseMcpToolHandler"

const tools = ["list_claims", "add_claim", "get_claim", "start_session", "fetch_camels_us"].map((name) => ({ name }))
const connections = [{ server: { name: "aihydro-tools", tools } }, { server: { name: "no-list" } }] as any[]

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

	it("closestNames ranks related names first and caps the list", () => {
		const names = closestNames("list_claim", ["zzz", "list_claims", "add_claim", "get_claim", "start_session", "q", "w"])
		expect(names[0]).to.equal("list_claims")
		expect(names.length).to.be.at.most(5)
	})
})
