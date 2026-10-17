import { expect } from "chai"
import { describe, it } from "mocha"
import type { McpServer } from "@/shared/mcp"
import { AiHydroDefaultTool } from "@/shared/tools"
import { EXPLORER_ALLOWED_TOOLS, explorerBlockReason, explorerMcpBlockReason } from "../explorerPolicy"

const hub = (tools: any[]) => ({
	getServers: () => [{ name: "ai-hydro", status: "connected", config: "{}", tools } as McpServer],
})

const TOOLS = [
	{ name: "get_streamflow", annotations: { readOnlyHint: true } },
	{ name: "run_python", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "write_notes", annotations: { destructiveHint: true } }, // annotated, readOnlyHint absent
	{ name: "describe_tool" }, // unannotated
]

describe("explorer profile policy", () => {
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
		const h = hub([{ name: "t", annotations: { readOnlyHint: "true" } }])
		expect(explorerMcpBlockReason(h, "ai-hydro", "t")).to.be.a("string")
	})

	it("is an allowlist: every tool outside it is refused, including preview_html and report_bug", () => {
		for (const t of Object.values(AiHydroDefaultTool)) {
			const reason = explorerBlockReason(t, { server_name: "ai-hydro", tool_name: "get_streamflow" }, hub(TOOLS))
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

	it("allows the read-only built-ins and completion/interaction tools", () => {
		for (const t of [
			"read_file",
			"search_files",
			"list_files",
			"list_code_definition_names",
			"access_mcp_resource",
			"load_mcp_documentation",
			"web_fetch",
			"ask_followup_question",
			"attempt_completion",
			"condense",
			"summarize_task",
			"plan_mode_respond",
			"focus_chain",
		]) {
			expect(explorerBlockReason(t, {}, hub(TOOLS)), t).to.equal(undefined)
		}
	})
})
