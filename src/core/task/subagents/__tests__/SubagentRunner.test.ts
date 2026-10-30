import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { capFor } from "../agentProfile"
import { SubagentRunner } from "../SubagentRunner"
import { makeParent, PARENT_CAPS, type ParentHarness, PROFILE, scriptedApi, tool } from "./subagentHarness"

function runnerFor(h: ParentHarness, api: any, prompt = "What does src/model.py do?", extra: Record<string, unknown> = {}) {
	return new SubagentRunner({
		...h.runnerBase,
		childId: "sa_test1",
		ordinal: 1,
		label: "Explorer 1",
		profile: "explorer",
		caps: capFor(PARENT_CAPS, PROFILE)!,
		prompt,
		api,
		...extra,
	} as any)
}

const REPORT = tool("report_findings", {
	summary: "It computes NSE.",
	key_findings: "- src/model.py:1 defines nse",
	files_read: "src/model.py",
})

describe("SubagentRunner", () => {
	let h: ParentHarness
	beforeEach(() => {
		h = makeParent()
	})
	afterEach(() => h.cleanup())

	it("reads a file, reports, and writes a record (completed)", async () => {
		const api = scriptedApi([tool("read_file", { path: "src/model.py" }), REPORT])
		const result = await runnerFor(h, api).run()

		expect(result.status).to.equal("completed")
		expect(result.report?.summary).to.equal("It computes NSE.")
		expect(result.report?.keyFindings).to.deep.equal(["src/model.py:1 defines nse"])
		expect(result.usage.toolCalls).to.equal(2)
		expect(result.recordPath).to.equal("subagents/sa_test1.json")

		const record = h.records[0]
		expect(record.schema).to.equal("aihydro.subagent-record/1")
		expect(record.parentUlid).to.equal("ulid-parent")
		expect(record.profile).to.equal("explorer")
		expect(record.allowlistSha256).to.match(/^[0-9a-f]{64}$/)
		expect(record.promptSha256).to.match(/^[0-9a-f]{64}$/)
		expect(record.modelIdRequested).to.equal("scripted-model")
		expect(record.modelIdReturned).to.equal("scripted-model-2026")
		expect(record.toolCalls.map((c) => [c.name, c.approval, c.result])).to.deep.equal([
			["read_file", "auto", "ok"],
			["report_findings", "auto", "ok"],
		])
		// arguments are hashed, never stored
		expect(JSON.stringify(record.toolCalls)).to.not.include("model.py")
		expect(record.report?.summary).to.equal("It computes NSE.")
	})

	it("never reaches the parent except through the ask bridge (no parent say, lastMessageTs untouched)", async () => {
		const before = h.lastMessageTs
		const api = scriptedApi([tool("read_file", { path: "src/model.py" }), REPORT])
		await runnerFor(h, api).run()
		expect(h.parentSays).to.equal(0)
		expect(h.lastMessageTs).to.equal(before)
		expect(h.asks).to.have.length(0) // reads inside the workspace auto-approve at the read ceiling
	})

	it("a write attempt is refused before any handler runs, and the file is not created", async () => {
		const target = path.join(h.dir, "pwned.txt")
		const api = scriptedApi([
			tool("write_to_file", { path: "pwned.txt", content: "x" }),
			tool("execute_command", { command: "touch pwned2.txt", requires_approval: "false" }),
			REPORT,
		])
		const result = await runnerFor(h, api).run()

		expect(fs.existsSync(target)).to.equal(false)
		expect(fs.existsSync(path.join(h.dir, "pwned2.txt"))).to.equal(false)
		expect(h.asks).to.have.length(0) // refused: the user is not even asked
		expect(result.status).to.equal("completed")
		const calls = h.records[0].toolCalls
		expect(calls[0]).to.include({ name: "write_to_file", approval: "refused", result: "refused" })
		expect(calls[1]).to.include({ name: "execute_command", approval: "refused", result: "refused" })
	})

	it("a child that keeps asking for refused tools ends blocked", async () => {
		const api = scriptedApi([tool("write_to_file", { path: "a", content: "x" })])
		const result = await runnerFor(h, api).run()
		expect(result.status).to.equal("blocked")
		expect(result.usage.toolCalls).to.equal(3)
	})

	it("MCP: a READ tool runs, WRITE / unannotated-claim / open-world tools are refused before callTool", async () => {
		const api = scriptedApi([
			tool("use_mcp_tool", { server_name: "ai-hydro", tool_name: "get_session_summary", arguments: "{}" }),
			tool("use_mcp_tool", { server_name: "ai-hydro", tool_name: "run_python", arguments: '{"code":"1"}' }),
			tool("use_mcp_tool", { server_name: "ai-hydro", tool_name: "add_claim", arguments: "{}" }),
			REPORT,
		])
		const result = await runnerFor(h, api).run()

		expect(h.mcp.calls.map((c) => c.tool)).to.deep.equal(["get_session_summary"])
		expect(result.status).to.equal("completed")
		expect(h.records[0].toolCalls.map((c) => c.result)).to.deep.equal(["ok", "refused", "refused", "ok"])
		// chat_id is the PARENT's ulid and the client label is unchanged
		const meta = (h.mcp.calls[0].meta as any)["aihydro/context"]
		expect(meta.chat_id).to.equal("ulid-parent")
		expect(meta.client).to.equal("vscode")
		// ...and says which agent made the call (not sealed by the server yet; the record states the same identity)
		expect(meta.agent).to.deep.equal({ agent_id: "sa_test1", parent_agent_id: "ulid-parent", role: "explorer" })
		expect(h.records[0].agent).to.deep.equal(meta.agent)
	})

	it("open-world and untrusted-server tools are refused", async () => {
		const api = scriptedApi([
			tool("use_mcp_tool", { server_name: "ai-hydro", tool_name: "fetch_usgs", arguments: "{}" }),
			REPORT,
		])
		await runnerFor(h, api).run()
		expect(h.mcp.calls).to.have.length(0)

		const h2 = makeParent({})
		h2.mcp.connections[0].server.config = JSON.stringify({ type: "stdio", command: "/tmp/evil", args: [] })
		const api2 = scriptedApi([
			tool("use_mcp_tool", { server_name: "ai-hydro", tool_name: "get_session_summary", arguments: "{}" }),
			REPORT,
		])
		await runnerFor(h2, api2).run()
		expect(h2.mcp.calls).to.have.length(0)
		h2.cleanup()
	})

	it("a denied approval comes back as a denial and is recorded", async () => {
		h.settings.autoApprovalSettings = { ...(h.settings.autoApprovalSettings as object), enabled: false }
		h.answer = async () => ({ response: "noButtonClicked" })
		const api = scriptedApi([tool("read_file", { path: "README.md" }), REPORT])
		const result = await runnerFor(h, api).run()

		expect(h.asks).to.have.length(1)
		expect(h.asks[0].type).to.equal("tool")
		expect(h.asks[0].meta?.subagentOrigin).to.deep.equal({
			childId: "sa_test1",
			label: "Explorer 1",
			profile: "explorer",
			promptHead: "What does src/model.py do?",
		})
		expect(h.records[0].toolCalls[0]).to.include({ name: "read_file", approval: "denied", result: "denied" })
		expect(result.status).to.equal("completed")
	})

	it("YOLO and 'execute all commands' do not auto-approve anything for a child: reads ask when auto-approve is off", async () => {
		h.settings.yoloModeToggled = true
		h.settings.autoApprovalSettings = {
			...(h.settings.autoApprovalSettings as object),
			enabled: false,
		}
		const api = scriptedApi([tool("read_file", { path: "README.md" }), REPORT])
		await runnerFor(h, api).run()
		expect(h.asks).to.have.length(1) // YOLO did not auto-approve the read
	})

	it("an untrusted parent workspace means every child call asks", async () => {
		const caps = capFor({ ...PARENT_CAPS, workspaceTrusted: false }, PROFILE)!
		const api = scriptedApi([tool("read_file", { path: "README.md" }), REPORT])
		await runnerFor(h, api, "x", { caps }).run()
		expect(h.asks).to.have.length(1)
	})

	it("stops at the tool-call budget as partial, with the cause named", async () => {
		const caps = { ...capFor(PARENT_CAPS, PROFILE)!, budget: { ...PROFILE.budget, maxToolCalls: 2 } }
		const api = scriptedApi([
			tool("read_file", { path: "README.md" }),
			tool("list_files", { path: "src" }),
			tool("read_file", { path: "src/model.py" }),
		])
		const result = await runnerFor(h, api, "x", { caps }).run()
		expect(result.status).to.equal("partial")
		expect(result.budgetStop).to.equal("tool_calls")
		expect(result.lastAssistantText).to.include("read_file")
		expect(h.records[0].budgetStop).to.equal("tool_calls")
	})

	it("stops at the output-token and cost budgets, and at 80% of the context window", async () => {
		const base = capFor(PARENT_CAPS, PROFILE)!
		let result = await runnerFor(
			h,
			scriptedApi([{ text: tool("read_file", { path: "README.md" }), usage: { inputTokens: 10, outputTokens: 50_000 } }]),
			"x",
			{
				caps: base,
			},
		).run()
		expect(result).to.include({ status: "partial", budgetStop: "output_tokens" })

		result = await runnerFor(
			h,
			scriptedApi([
				{ text: tool("read_file", { path: "README.md" }), usage: { inputTokens: 10, outputTokens: 5, totalCost: 3 } },
			]),
			"x",
			{
				caps: base,
			},
		).run()
		expect(result).to.include({ status: "partial", budgetStop: "cost" })

		result = await runnerFor(
			h,
			scriptedApi([{ text: tool("read_file", { path: "README.md" }), usage: { inputTokens: 90, outputTokens: 5 } }], {
				contextWindow: 100,
			}),
			"x",
			{ caps: base },
		).run()
		expect(result).to.include({ status: "partial", budgetStop: "context" })
	})

	it("stops at the wall clock as partial", async () => {
		let now = 1_000_000
		const api = scriptedApi([], { hang: true })
		const runner = runnerFor(h, api, "x", { now: () => now, pollMs: 5 })
		const running = runner.run()
		await new Promise((r) => setTimeout(r, 30))
		now += PROFILE.budget.wallClockMs + 1
		const result = await running
		expect(result).to.include({ status: "partial", budgetStop: "wall_clock" })
	})

	it("cancel() ends a child that is waiting on its model, quickly, and drops the stream", async () => {
		const api = scriptedApi([], { hang: true })
		const runner = runnerFor(h, api)
		const running = runner.run()
		await new Promise((r) => setTimeout(r, 30))
		const started = Date.now()
		runner.cancel()
		const result = await running
		expect(result.status).to.equal("cancelled")
		expect(Date.now() - started).to.be.lessThan(1000)
		expect(h.records[0].status).to.equal("cancelled")
	})

	it("the parent aborting (Stop) cancels the child within one poll interval", async () => {
		const api = scriptedApi([], { hang: true })
		const running = runnerFor(h, api).run()
		await new Promise((r) => setTimeout(r, 30))
		const started = Date.now()
		h.aborted = true
		const result = await running
		expect(result.status).to.equal("cancelled")
		expect(Date.now() - started).to.be.lessThan(1000)
	})

	it("a child waiting on the user is cancelled without waiting for the answer", async () => {
		h.settings.autoApprovalSettings = { ...(h.settings.autoApprovalSettings as object), enabled: false }
		h.answer = () => new Promise(() => {}) // the user never answers
		const runner = runnerFor(h, scriptedApi([tool("read_file", { path: "README.md" }), REPORT]))
		const updates: string[] = []
		;(runner as any).init.onUpdate = (s: any) => updates.push(s.status)
		const running = runner.run()
		await new Promise((r) => setTimeout(r, 50))
		expect(runner.currentStatus).to.equal("waiting")
		runner.cancel()
		const result = await running
		expect(result.status).to.equal("cancelled")
		expect(updates).to.include("waiting")
	})

	it("ends partial after repeated replies with no tool call", async () => {
		const result = await runnerFor(h, scriptedApi(["I think the answer is 42."])).run()
		expect(result.status).to.equal("partial")
		expect(result.lastAssistantText).to.equal("I think the answer is 42.")
	})

	it("a model error fails the child and still writes a record", async () => {
		const api: any = {
			getModel: () => ({ id: "m", info: { contextWindow: 1000 } }),
			createMessage: () =>
				(async function* () {
					throw new Error("provider exploded")
				})(),
		}
		const result = await runnerFor(h, api).run()
		expect(result.status).to.equal("failed")
		expect(result.error).to.include("provider exploded")
		expect(h.records).to.have.length(1)
	})

	it("a report with no summary is rejected and the child may retry", async () => {
		const api = scriptedApi([tool("report_findings", { key_findings: "- x" }), REPORT])
		const result = await runnerFor(h, api).run()
		expect(result.status).to.equal("completed")
		expect(result.usage.toolCalls).to.equal(2)
	})

	it("the system prompt lists only allowed tools and READ MCP tools on the trusted server", async () => {
		let system = ""
		const api = scriptedApi([REPORT], { onRequest: (s) => (system = s) })
		await runnerFor(h, api).run()
		for (const name of ["read_file", "search_files", "list_files", "report_findings", "get_session_summary"]) {
			expect(system, name).to.include(name)
		}
		for (const name of [
			"write_to_file",
			"execute_command",
			"attempt_completion",
			"ask_followup_question",
			"web_fetch",
			"run_python",
			"add_claim",
			"fetch_usgs",
			"spawn_subagents",
		]) {
			expect(system, name).to.not.include(name)
		}
	})
})
