import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { getRecordedFirstPartyLauncher, setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import type { McpServer } from "@/shared/mcp"
import { AiHydroDefaultTool } from "@/shared/tools"
import { EXPLORER_ALLOWED_TOOLS, EXPLORER_DENIED_MCP_TOOLS, explorerBlockReason, explorerMcpBlockReason } from "../explorerPolicy"

// The trusted first-party server: its name AND launch line match the launcher recorded at registration (B4).
const LAUNCHER = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
const TRUSTED_CONFIG = JSON.stringify({ type: "stdio", command: LAUNCHER.command, args: [] })

const hub = (tools: any[], config: string = TRUSTED_CONFIG, name = "ai-hydro") => ({
	getServers: () => [{ name, status: "connected", config, tools } as McpServer],
})

const TOOLS = [
	{ name: "get_streamflow", annotations: { readOnlyHint: true, openWorldHint: false } },
	{ name: "run_python", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "write_notes", annotations: { destructiveHint: true } }, // annotated, readOnlyHint absent
	{ name: "describe_tool" }, // unannotated
]

describe("explorer profile policy", () => {
	let savedLauncher: ReturnType<typeof getRecordedFirstPartyLauncher>
	beforeEach(() => {
		savedLauncher = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher(LAUNCHER)
	})
	afterEach(() => setRecordedFirstPartyLauncher(savedLauncher))

	it("T18 blocks an untrusted server that claims readOnlyHint=true (a hostile label is not accepted)", () => {
		const hostile = hub(
			[{ name: "exfiltrate", annotations: { readOnlyHint: true, openWorldHint: false } }],
			JSON.stringify({ type: "stdio", command: "/tmp/evil-mcp", args: [] }),
		)
		expect(explorerMcpBlockReason(hostile, "ai-hydro", "exfiltrate")).to.include("not the trusted first-party server")
		// A remote server under the first-party name is not trusted either.
		const remote = hub(
			[{ name: "exfiltrate", annotations: { readOnlyHint: true, openWorldHint: false } }],
			JSON.stringify({ type: "sse", url: "https://example.com/mcp" }),
		)
		expect(explorerMcpBlockReason(remote, "ai-hydro", "exfiltrate")).to.include("not the trusted first-party server")
		// A differently named server with the launcher's command is not trusted.
		const renamed = hub([{ name: "t", annotations: { readOnlyHint: true, openWorldHint: false } }], TRUSTED_CONFIG, "other")
		expect(explorerMcpBlockReason(renamed, "other", "t")).to.include("not the trusted first-party server")
	})

	it("M4 allows only READ class: readOnlyHint=true alone (open-world by default) is a network tool and is blocked", () => {
		const h = hub([{ name: "fetch", annotations: { readOnlyHint: true } }])
		expect(explorerMcpBlockReason(h, "ai-hydro", "fetch")).to.include("not closed-world")
	})

	it("blocks everything when no launcher was recorded (fail closed)", () => {
		setRecordedFirstPartyLauncher(undefined)
		expect(explorerMcpBlockReason(hub(TOOLS), "ai-hydro", "get_streamflow")).to.include("not the trusted first-party server")
	})

	it("allows an MCP tool annotated readOnlyHint=true", () => {
		expect(
			explorerBlockReason("use_mcp_tool", { server_name: "ai-hydro", tool_name: "get_streamflow" }, hub(TOOLS)),
		).to.equal(undefined)
	})

	it("blocks run_python (readOnlyHint=false)", () => {
		const r = explorerBlockReason("use_mcp_tool", { server_name: "ai-hydro", tool_name: "run_python" }, hub(TOOLS))
		expect(r).to.be.a("string").and.include("run_python").and.include("readOnlyHint")
	})

	it("blocks annotated tools that do not declare readOnlyHint=true", () => {
		expect(explorerMcpBlockReason(hub(TOOLS), "ai-hydro", "write_notes")).to.include("not annotated readOnlyHint=true")
	})

	it("treats unannotated tools as NOT read-only (fail closed)", () => {
		expect(explorerMcpBlockReason(hub(TOOLS), "ai-hydro", "describe_tool")).to.include("no MCP annotations")
	})

	it("blocks unknown servers/tools and missing params (cannot be verified)", () => {
		expect(explorerMcpBlockReason(hub(TOOLS), "ai-hydro", "nope")).to.include("cannot be verified")
		expect(explorerMcpBlockReason(hub(TOOLS), "other", "get_streamflow")).to.include("cannot be verified")
		expect(explorerMcpBlockReason(undefined, "ai-hydro", "get_streamflow")).to.include("cannot be verified")
		expect(explorerMcpBlockReason(hub(TOOLS), undefined, undefined)).to.include("server_name and tool_name")
	})

	it("does not trust a string 'true' or truthy non-boolean readOnlyHint", () => {
		const h = hub([{ name: "t", annotations: { readOnlyHint: "true", openWorldHint: false } }])
		expect(explorerMcpBlockReason(h, "ai-hydro", "t")).to.be.a("string")
	})

	it("is an allowlist: every tool outside it is refused, including preview_html and report_bug", () => {
		for (const t of Object.values(AiHydroDefaultTool)) {
			const reason = explorerBlockReason(
				t,
				{ server_name: "ai-hydro", tool_name: "get_streamflow", uri: "aihydro://x" },
				hub(TOOLS),
			)
			if (EXPLORER_ALLOWED_TOOLS.includes(t)) {
				expect(reason, t).to.equal(undefined)
			} else {
				expect(reason, t).to.be.a("string")
			}
		}
		for (const t of [
			"preview_html",
			"report_bug",
			"execute_command",
			"write_to_file",
			"replace_in_file",
			"edit_files",
			"new_rule",
			"browser_action",
			"new_task",
			"some_future_tool",
		]) {
			expect(explorerBlockReason(t, {}, hub(TOOLS)), t).to.be.a("string")
		}
	})

	it("allows the read-only built-ins and the exit tool, and nothing that reaches the parent or the network", () => {
		for (const t of ["read_file", "search_files", "list_files", "load_mcp_documentation", "report_findings"]) {
			expect(explorerBlockReason(t, {}, hub(TOOLS)), t).to.equal(undefined)
		}
		// Removed for in-process children: they act on the parent's task state, raise the parent's asks, or egress.
		for (const t of [
			"web_fetch",
			"ask_followup_question",
			"attempt_completion",
			"condense",
			"summarize_task",
			"plan_mode_respond",
			"focus_chain",
		]) {
			expect(explorerBlockReason(t, {}, hub(TOOLS)), t).to.be.a("string")
		}
	})

	it("access_mcp_resource is allowed only on the trusted first-party server (fail closed)", () => {
		expect(explorerBlockReason("access_mcp_resource", { server_name: "ai-hydro", uri: "aihydro://x" }, hub(TOOLS))).to.equal(
			undefined,
		)
		const hostile = hub(TOOLS, JSON.stringify({ type: "stdio", command: "/tmp/evil-mcp", args: [] }))
		expect(explorerBlockReason("access_mcp_resource", { server_name: "ai-hydro", uri: "x" }, hostile)).to.include(
			"not the trusted",
		)
		expect(explorerBlockReason("access_mcp_resource", { server_name: "other", uri: "x" }, hub(TOOLS))).to.include(
			"not the trusted",
		)
		expect(explorerBlockReason("access_mcp_resource", { server_name: "ai-hydro" }, hub(TOOLS))).to.include(
			"needs server_name and uri",
		)
		expect(explorerBlockReason("access_mcp_resource", { server_name: "ai-hydro", uri: "x" }, undefined)).to.include(
			"not the trusted",
		)
	})

	it("takes the allowlist as an argument: a narrower list refuses what the default allows", () => {
		expect(explorerBlockReason("read_file", {}, hub(TOOLS), ["list_files"])).to.be.a("string")
		expect(explorerBlockReason("list_files", {}, hub(TOOLS), ["list_files"])).to.equal(undefined)
	})

	it("binding and claim tools are refused by name even when the trusted server annotates them READ", () => {
		const lying = hub(
			[...EXPLORER_DENIED_MCP_TOOLS].map((name) => ({ name, annotations: { readOnlyHint: true, openWorldHint: false } })),
		)
		for (const name of [
			"start_session",
			"aihydro_rebind_chat",
			"add_claim",
			"promote_claim_to_registry",
			"register_research_plan",
		]) {
			expect(EXPLORER_DENIED_MCP_TOOLS.has(name), name).to.equal(true)
			expect(explorerMcpBlockReason(lying, "ai-hydro", name), name).to.include("never available to an explorer")
			expect(explorerBlockReason("use_mcp_tool", { server_name: "ai-hydro", tool_name: ` ${name} ` }, lying), name).to.be.a(
				"string",
			)
		}
		// an ordinary READ tool is still allowed
		expect(explorerMcpBlockReason(hub(TOOLS), "ai-hydro", "get_streamflow")).to.equal(undefined)
	})
})
