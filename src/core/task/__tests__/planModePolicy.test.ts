import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { getRecordedFirstPartyLauncher, setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import type { McpServer } from "@/shared/mcp"
import { PLAN_MODE_RESTRICTED_TOOLS, planModeBlockReason } from "../planModePolicy"

const LAUNCHER = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
const TRUSTED = JSON.stringify({ type: "stdio", command: LAUNCHER.command, args: [] })
const POSIX = { platform: "darwin", shell: "/bin/zsh", workspaceTrusted: true }

const READ = { readOnlyHint: true, openWorldHint: false }
const hub = (config: string = TRUSTED) => ({
	getServers: () => [
		{
			name: "ai-hydro",
			status: "connected",
			config,
			tools: [
				{ name: "aihydro_chat_status", annotations: READ },
				{ name: "data_list_products", annotations: READ },
				{ name: "data_fetch", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
				{
					name: "delineate_watershed",
					annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
				},
				{ name: "run_python", annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
				{ name: "add_claim", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
				{ name: "unannotated_tool" },
			],
		} as McpServer,
	],
})
const mcp = (tool: string, h = hub()) =>
	planModeBlockReason("use_mcp_tool", { server_name: "ai-hydro", tool_name: tool }, h, POSIX)

describe("Plan mode is read-only", () => {
	let saved: ReturnType<typeof getRecordedFirstPartyLauncher>
	beforeEach(() => {
		saved = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher(LAUNCHER)
	})
	afterEach(() => setRecordedFirstPartyLauncher(saved))

	it("lets READ-class tools on the trusted server through", () => {
		expect(mcp("aihydro_chat_status")).to.equal(undefined)
		expect(mcp("data_list_products")).to.equal(undefined)
	})

	it("refuses MCP writers, fetchers, run_python and unannotated tools, and says it was Plan mode", () => {
		for (const tool of ["data_fetch", "delineate_watershed", "run_python", "add_claim", "unannotated_tool"]) {
			const reason = mcp(tool)
			expect(reason, tool).to.be.a("string").and.include("PLAN MODE is read-only").and.include("did not run")
			expect(reason, tool).to.include("Act mode")
		}
	})

	it("refuses a tool the server does not list, a READ label from an untrusted server, and a call with no names", () => {
		expect(mcp("not_a_tool")).to.include("PLAN MODE is read-only")
		const evil = hub(JSON.stringify({ type: "stdio", command: "/tmp/evil", args: [] }))
		expect(mcp("aihydro_chat_status", evil)).to.include("not the trusted first-party server")
		expect(planModeBlockReason("use_mcp_tool", {}, hub(), POSIX)).to.include("PLAN MODE is read-only")
	})

	it("refuses a chat-binding tool by name even if a server labels it read-only", () => {
		const h = {
			getServers: () => [{ ...hub().getServers()[0], tools: [{ name: "start_session", annotations: READ }] } as McpServer],
		}
		expect(mcp("start_session", h)).to.include("PLAN MODE is read-only")
	})

	it("keeps refusing the file writers, now including preview_html", () => {
		for (const t of PLAN_MODE_RESTRICTED_TOOLS) {
			expect(planModeBlockReason(t, {}, hub(), POSIX), t).to.include("not available in PLAN MODE")
		}
		expect(PLAN_MODE_RESTRICTED_TOOLS).to.include("preview_html")
	})

	it("runs only commands the host classifies as read-only", () => {
		const run = (command: string) => planModeBlockReason("execute_command", { command }, hub(), POSIX)
		expect(run("ls -la")).to.equal(undefined)
		expect(run("rm -rf out")).to.include("PLAN MODE is read-only")
		expect(run("python script.py > out.txt")).to.include("did not run")
		expect(planModeBlockReason("execute_command", {}, hub(), POSIX)).to.include("PLAN MODE is read-only")
		// Nothing is read-only on a shell the classifier does not model (fail closed).
		expect(planModeBlockReason("execute_command", { command: "ls" }, hub(), { platform: "win32" })).to.include("did not run")
	})

	it("does not touch read tools, questions or the plan reply", () => {
		for (const t of [
			"read_file",
			"search_files",
			"list_files",
			"ask_followup_question",
			"plan_mode_respond",
			"attempt_completion",
		]) {
			expect(planModeBlockReason(t, {}, hub(), POSIX), t).to.equal(undefined)
		}
	})
})

describe("Plan mode in ToolExecutor.execute", () => {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { ToolExecutor } = require("../ToolExecutor")
	let saved: ReturnType<typeof getRecordedFirstPartyLauncher>
	beforeEach(() => {
		saved = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher(LAUNCHER)
	})
	afterEach(() => setRecordedFirstPartyLauncher(saved))

	function build(mode: string, strict = true) {
		const calls = { said: [] as string[], pushed: [] as string[], handled: 0 }
		const ex = Object.create(ToolExecutor.prototype)
		ex.taskState = { didRejectTool: false, didAlreadyUseTool: false }
		ex.mcpHub = hub()
		ex.stateManager = { getGlobalSettingsKey: (k: string) => ({ strictPlanModeEnabled: strict, mode })[k] }
		ex.coordinator = { has: () => true }
		ex.syncSubagentHandler = () => {}
		ex.asToolConfig = () => ({})
		// The first thing after the plan check: reaching it means the call was let through to its handler.
		ex.browserSession = {
			closeBrowser: async () => {
				calls.handled++
				throw new Error("handler reached")
			},
		}
		ex.say = async (_t: string, text: string) => void calls.said.push(text)
		ex.pushToolResult = (c: string) => void calls.pushed.push(c)
		ex.saveCheckpoint = async () => {}
		ex.handleError = async () => {}
		return { ex, calls }
	}
	const use = (tool: string, partial = false) => ({
		name: "use_mcp_tool",
		partial,
		params: { server_name: "ai-hydro", tool_name: tool },
	})

	it("refuses a writer in Plan mode with one error row and one tool result; the handler never runs", async () => {
		const { ex, calls } = build("plan")
		expect(await ex.execute(use("data_fetch"))).to.equal(true)
		expect(calls.said).to.have.length(1)
		expect(calls.pushed[0]).to.include("PLAN MODE is read-only")
		expect(calls.handled).to.equal(0)
	})

	it("a partial writer block is swallowed without a row; a read tool and Act mode reach the handler", async () => {
		const { ex, calls } = build("plan")
		expect(await ex.execute(use("data_fetch", true))).to.equal(true)
		expect(calls.said).to.have.length(0)
		await ex.execute(use("aihydro_chat_status")).catch(() => {})
		expect(calls.handled).to.equal(1)
		const act = build("act")
		await act.ex.execute(use("data_fetch")).catch(() => {})
		expect(act.calls.handled).to.equal(1)
		const lax = build("plan", false)
		await lax.ex.execute(use("data_fetch")).catch(() => {})
		expect(lax.calls.handled).to.equal(1)
	})
})
