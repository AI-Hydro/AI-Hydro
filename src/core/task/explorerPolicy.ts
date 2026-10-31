import { isServerTrusted } from "@shared/aihydro/firstPartyServers"
import { effectClass } from "@shared/aihydro/mcpEffectClass"
import type { McpServer } from "@shared/mcp"
import { AiHydroDefaultTool } from "@/shared/tools"
import { EXPLORER_PROFILE } from "./subagents/agentProfile"

/**
 * Capability policy for the `explorer` subagent profile (AGENT_EXECUTION_MODEL §4, gap #3).
 *
 * The profile is advertised as physically read-only. Name-based blocking of the built-in write tools
 * is not enough on its own: `use_mcp_tool` reaches every MCP tool, including `run_python` and every
 * server-side write tool. So MCP calls are allowed only for READ-class tools (readOnlyHint true AND
 * openWorldHint false, see mcpEffectClass.ts) on a TRUSTED server (isServerTrusted: name plus the launcher
 * recorded at registration). Annotations from any other server are untrusted hints and are ignored, so a
 * hostile server cannot label `exfiltrate` read-only and have the explorer call it (approval redesign AP1, M4).
 * A tool with no annotations is NOT assumed read-only (fail closed).
 */

/**
 * The explorer's built-in allowlist is data on the profile (subagents/agentProfile.ts). This is an ALLOWLIST: any
 * tool not listed (including tools added later, e.g. preview_html which writes model-supplied HTML to the workspace
 * and opens it, or report_bug which opens an external issue) is refused by default. `report_findings` is the child's
 * only exit and is handled by the host. use_mcp_tool and access_mcp_resource are listed but further gated below.
 */
export const EXPLORER_ALLOWED_TOOLS: readonly string[] = [...EXPLORER_PROFILE.builtinAllow, EXPLORER_PROFILE.reportTool]

const READ_ONLY_TOOL_LIST =
	"read_file, search_files, list_files, load_mcp_documentation, report_findings, and read-only MCP tools (readOnlyHint=true, openWorldHint=false) or resources on the trusted first-party server"

/**
 * MCP tools an explorer may never call whatever the server annotates: the ones that bind a chat to a study, and the
 * claim, registry and approval tools. They are not READ class on a correct server, but this list means the guarantee
 * does not rest on a server's annotations alone (a mislabelled or changed tool is still refused). A name match, applied
 * before any annotation is read, on the trusted server's tools and every other.
 */
export const EXPLORER_DENIED_MCP_TOOLS: ReadonlySet<string> = new Set([
	"start_session",
	"aihydro_rebind_chat",
	"add_claim",
	"revise_claim",
	"promote_claim",
	"promote_claim_to_registry",
	"register_research_plan",
	"write_research_interpretation",
	"approve_claim",
	"ensure_project",
	"set_project_default_study",
])

export interface ExplorerMcpHub {
	getServers(): McpServer[]
}

/**
 * Why an `use_mcp_tool` call is not allowed in explorer, or undefined if it is allowed.
 * Unknown server/tool, an untrusted server, missing annotations, or a class other than READ are all refusals.
 */
export function explorerMcpBlockReason(
	mcpHub: ExplorerMcpHub | undefined,
	serverName: string | undefined,
	toolName: string | undefined,
): string | undefined {
	if (!serverName || !toolName) {
		return "use_mcp_tool needs server_name and tool_name so the read-only policy can be checked."
	}
	if (EXPLORER_DENIED_MCP_TOOLS.has(toolName.trim())) {
		return `MCP tool '${toolName}' binds a chat to a study or changes a claim, so it is never available to an explorer.`
	}
	const server = mcpHub?.getServers().find((s) => s.name === serverName)
	const tool = server?.tools?.find((t) => t.name === toolName)
	if (!tool) {
		return `MCP tool '${toolName}' on server '${serverName}' is not in the connected tool list, so it cannot be verified as read-only.`
	}
	if (!isServerTrusted(server)) {
		return `MCP server '${serverName}' is not the trusted first-party server, so its annotations for '${toolName}' are untrusted hints and are not accepted.`
	}
	if (effectClass(tool.annotations) === "READ") {
		return undefined
	}
	if (!tool.annotations) {
		return `MCP tool '${serverName}/${toolName}' has no MCP annotations; unannotated tools are treated as NOT read-only.`
	}
	return tool.annotations.readOnlyHint === true
		? `MCP tool '${serverName}/${toolName}' is readOnlyHint=true but not closed-world (openWorldHint is not false), so it is classed as a network tool, not read-only.`
		: `MCP tool '${serverName}/${toolName}' is not annotated readOnlyHint=true.`
}

/**
 * Why an `access_mcp_resource` call is not allowed in explorer, or undefined if it is allowed. A resource read is not
 * a tool call, so there is no effect annotation to check; the server must be the trusted first-party one on the live
 * connection (the same condition that lets the parent auto-run a resource read), and the call must be fully specified.
 */
export function explorerResourceBlockReason(
	mcpHub: ExplorerMcpHub | undefined,
	serverName: string | undefined,
	uri: string | undefined,
): string | undefined {
	if (!serverName || !uri) {
		return "access_mcp_resource needs server_name and uri so the read-only policy can be checked."
	}
	const server = mcpHub?.getServers().find((s) => s.name === serverName)
	if (!server || !isServerTrusted(server)) {
		return `MCP server '${serverName}' is not the trusted first-party server, so the explorer may not read its resources.`
	}
	return undefined
}

/**
 * Reason a tool call is blocked in a subagent profile, or undefined if allowed.
 * Pure: the caller decides whether a profile is active. `allowlist` defaults to the explorer's; a caller passes the
 * child's effective list (the intersection with the parent, see capFor), so the check is never wider than the registry.
 */
export function explorerBlockReason(
	toolName: string,
	params: Record<string, unknown> | undefined,
	mcpHub: ExplorerMcpHub | undefined,
	allowlist: readonly string[] = EXPLORER_ALLOWED_TOOLS,
): string | undefined {
	if (!allowlist.includes(toolName)) {
		return `Tool '${toolName}' is not available in EXPLORER profile. This is a read-only research subagent. Use only ${READ_ONLY_TOOL_LIST}.`
	}
	if (toolName === AiHydroDefaultTool.MCP_USE) {
		const reason = explorerMcpBlockReason(
			mcpHub,
			params?.server_name as string | undefined,
			params?.tool_name as string | undefined,
		)
		if (reason) {
			return `${reason} The EXPLORER profile is read-only: only read-only MCP tools on the trusted first-party server may be called (never run_python or write tools).`
		}
	}
	if (toolName === AiHydroDefaultTool.MCP_ACCESS) {
		const reason = explorerResourceBlockReason(
			mcpHub,
			params?.server_name as string | undefined,
			params?.uri as string | undefined,
		)
		if (reason) {
			return `${reason} The EXPLORER profile is read-only.`
		}
	}
	return undefined
}
