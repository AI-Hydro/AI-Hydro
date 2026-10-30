import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { AiHydroDefaultTool } from "@/shared/tools"
import { TaskState } from "../../TaskState"
import { ToolExecutor } from "../../ToolExecutor"
import { capFor } from "../agentProfile"
import { ChildMessageState } from "../childRuntime"
import { SubagentRunner } from "../SubagentRunner"
import { makeParent, PARENT_CAPS, type ParentHarness, PROFILE, scriptedApi, tool } from "./subagentHarness"

const REPORT = tool("report_findings", { summary: "done" })

function run(h: ParentHarness, api: any) {
	return new SubagentRunner({
		...h.runnerBase,
		childId: "sa_cap",
		ordinal: 1,
		label: "Explorer 1",
		profile: "explorer",
		caps: capFor(PARENT_CAPS, PROFILE)!,
		prompt: "probe",
		api,
	} as any).run()
}

/** A plausible call for every tool, with arguments that would do real damage if it ran. */
const PROBES: Record<string, Record<string, string>> = {
	execute_command: { command: "touch cmd-ran.txt", requires_approval: "false" },
	write_to_file: { path: "w.txt", content: "x" },
	replace_in_file: { path: "README.md", diff: "------- SEARCH\nDemo\n=======\nPwned\n+++++++ REPLACE" },
	edit_files: { edits: "[]" },
	new_rule: { path: ".aihydrorules/x.md", content: "x" },
	web_fetch: { url: "https://example.com" },
	browser_action: { action: "launch", url: "https://example.com" },
	ask_followup_question: { question: "hello?" },
	attempt_completion: { result: "done" },
	plan_mode_respond: { response: "plan" },
	new_task: { context: "ctx" },
	condense: { context: "ctx" },
	summarize_task: { context: "ctx" },
	focus_chain: { task_progress: "- [ ] x" },
	report_bug: { title: "t", what_happened: "w", steps_to_reproduce: "s", api_request_output: "a", additional_context: "c" },
	preview_html: { path: "p.html", content: "<h1>x</h1>" },
	spawn_subagents: { prompts: '["nested"]' },
}

describe("child capability (AC2, AC7)", () => {
	let h: ParentHarness
	beforeEach(() => {
		h = makeParent()
	})
	afterEach(() => h.cleanup())

	const forbidden = Object.values(AiHydroDefaultTool).filter(
		(name) => !PROFILE.builtinAllow.includes(name) && name !== AiHydroDefaultTool.REPORT_FINDINGS,
	)

	it("covers every tool outside the allowlist with a probe", () => {
		const missing = forbidden.filter((name) => !PROBES[name])
		expect(missing, `add a probe for: ${missing.join(", ")}`).to.deep.equal([])
	})

	for (const name of Object.keys(PROBES)) {
		it(`${name} is refused with no side effect and no ask`, async () => {
			const before = fs.readdirSync(h.dir).sort()
			const readme = fs.readFileSync(path.join(h.dir, "README.md"), "utf8")
			const result = await run(h, scriptedApi([tool(name, PROBES[name]), REPORT]))

			expect(result.status).to.equal("completed")
			expect(h.records[0].toolCalls[0]).to.include({ name, approval: "refused", result: "refused" })
			expect(fs.readdirSync(h.dir).sort()).to.deep.equal(before)
			expect(fs.readFileSync(path.join(h.dir, "README.md"), "utf8")).to.equal(readme)
			expect(h.asks).to.have.length(0)
			expect(h.mcp.calls).to.have.length(0)
			expect(h.parentSays).to.equal(0)
		})
	}

	it("the child's registry holds exactly the allowlist plus the exit tool (S3: absent, not merely refused)", () => {
		const runner: any = new SubagentRunner({
			...h.runnerBase,
			childId: "sa_reg",
			ordinal: 1,
			label: "Explorer 1",
			profile: "explorer",
			caps: capFor(PARENT_CAPS, PROFILE)!,
			prompt: "p",
			api: scriptedApi([REPORT]),
		} as any)
		const executor = runner.buildExecutor(new TaskState(), new ChildMessageState("t", "u", new TaskState()))
		const registered = Object.values(AiHydroDefaultTool).filter((name) => executor.coordinator.has(name))
		expect(registered.sort()).to.deep.equal([...PROFILE.builtinAllow, AiHydroDefaultTool.REPORT_FINDINGS].sort())
	})

	it("a child executor needs a report sink (it cannot be built without its exit)", () => {
		expect(
			() =>
				new ToolExecutor(
					{} as any,
					new TaskState(),
					{} as any,
					scriptedApi([]),
					{} as any,
					{} as any,
					{} as any,
					h.mcp as any,
					{} as any,
					{} as any,
					{} as any,
					h.runnerBase.stateManager,
					{} as any,
					h.dir,
					"t",
					"u",
					undefined,
					false,
					async () => undefined,
					async () => ({ response: "yesButtonClicked" }) as any,
					async () => {},
					async () => ({}),
					async () => {},
					async () => [false, ""],
					async () => false,
					async () => {},
					async () => false,
					{ profile: capFor(PARENT_CAPS, PROFILE)! },
				),
		).to.throw("reportSink")
	})

	it("a completion never becomes a completion_result ask on the parent", async () => {
		await run(h, scriptedApi([tool("attempt_completion", { result: "all done" }), REPORT]))
		expect(h.asks.filter((ask) => ask.type === "completion_result")).to.have.length(0)
	})

	it("an unknown future tool name is not even parsed as a call (no handler, no side effect)", async () => {
		const result = await run(h, scriptedApi(["<some_future_tool><path>x</path></some_future_tool>", REPORT]))
		expect(h.asks).to.have.length(0)
		expect(["completed", "partial"]).to.include(result.status)
	})

	it("MCP resources: trusted server only", async () => {
		await run(h, scriptedApi([tool("access_mcp_resource", { server_name: "ai-hydro", uri: "aihydro://x" }), REPORT]))
		expect(h.records[0].toolCalls[0]).to.include({ name: "access_mcp_resource", result: "ok" })
		const h2 = makeParent()
		h2.mcp.connections[0].server.config = JSON.stringify({ type: "stdio", command: "/tmp/evil", args: [] })
		await run(h2, scriptedApi([tool("access_mcp_resource", { server_name: "ai-hydro", uri: "aihydro://x" }), REPORT]))
		expect(h2.records[0].toolCalls[0]).to.include({ name: "access_mcp_resource", result: "refused" })
		h2.cleanup()
	})

	it("the parent's settings are unchanged after a run (AC3)", async () => {
		h.settings.yoloModeToggled = true
		const snapshot = JSON.stringify(h.settings)
		await run(h, scriptedApi([tool("read_file", { path: "README.md" }), REPORT]))
		expect(JSON.stringify(h.settings)).to.equal(snapshot)
	})
})
