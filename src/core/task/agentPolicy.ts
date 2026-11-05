import { isServerTrusted } from "@shared/aihydro/firstPartyServers"
import { effectClass } from "@shared/aihydro/mcpEffectClass"
import type { McpServer } from "@shared/mcp"
import { AiHydroDefaultTool } from "@/shared/tools"
import { type AgentDefinition, EXPLORER_DEFINITION, reportToolFor } from "./subagents/agentDefinition"

/**
 * Capability policy for read-only subagent definitions (AGENT_EXECUTION_MODEL §4, gap #3). Every definition that names
 * the `read` MCP policy is checked here; nothing in this file is specific to one definition.
 *
 * A definition is advertised as physically read-only. Name-based blocking of the built-in write tools
 * is not enough on its own: `use_mcp_tool` reaches every MCP tool, including `run_python` and every
 * server-side write tool. So MCP calls are allowed only for READ-class tools (readOnlyHint true AND
 * openWorldHint false, see mcpEffectClass.ts) on a TRUSTED server (isServerTrusted: name plus the launcher
 * recorded at registration). Annotations from any other server are untrusted hints and are ignored, so a
 * hostile server cannot label `exfiltrate` read-only and have the explorer call it (approval redesign AP1, M4).
 * A tool with no annotations is NOT assumed read-only (fail closed).
 */

/**
 * A definition's callable tools: its built-ins (subagents/agentDefinition.ts) plus its exit tool. This is an ALLOWLIST:
 * any tool not listed (including tools added later, e.g. preview_html which writes model-supplied HTML to the workspace
 * and opens it, or report_bug which opens an external issue) is refused by default. The exit tool is handled by the
 * host. use_mcp_tool and access_mcp_resource are listed but further gated below.
 */
export function allowedToolsOf(definition: AgentDefinition): readonly string[] {
	return [...definition.builtinAllow, reportToolFor(definition.reportSchema)]
}

/** The default definition's allowlist, for a caller that names none. */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = allowedToolsOf(EXPLORER_DEFINITION)

const READ_ONLY_TOOL_LIST =
	"read_file, search_files, list_files, load_mcp_documentation, your report tool, and read-only MCP tools (readOnlyHint=true, openWorldHint=false) or resources on the trusted first-party server"

/**
 * MCP tools a subagent may never call whatever the server annotates: the ones that bind a chat to a study, change a
 * claim, an assumption or the interpretation, or clear a session, and the project-registry operations the server marks
 * for the host (`audience=host`). None is READ class on a correct server, but this list means the guarantee does not
 * rest on a server's annotations alone (a mislabelled or changed tool is still refused). A name match, applied before
 * any annotation is read, on the trusted server's tools and every other.
 *
 * Every name here must be a tool the server really registers. A name that does not exist guards nothing and hides the
 * ones that were missed (the earlier list named `revise_claim`, `promote_claim` and `approve_claim`, which have no row,
 * and omitted `update_claim_status`). agentPolicy.test.ts checks this list against the checked-in tool list
 * (__tests__/fixtures/aihydro-tool-surface.json, exported from aihydro-tools by scripts/export-aihydro-tool-surface.py).
 * Approval itself is not an MCP tool: it is the owner's `aihydro-approve` outside the agent.
 */
export const AGENT_DENIED_MCP_TOOLS: ReadonlySet<string> = new Set([
	// bind a chat to a study, or create one
	"start_session",
	"aihydro_rebind_chat",
	// claims, assumptions, the plan and the interpretation: the lead's and the owner's, never a child's
	"add_claim",
	"update_claim_status",
	"promote_claim_to_registry",
	"add_assumption",
	"bind_claim_to_item",
	"bind_map_to_claim",
	"register_research_plan",
	"write_research_interpretation",
	// wipes a study's slots
	"clear_session",
	// project registry (audience=host)
	"ensure_project",
	"set_project_default_study",
	"rename_project",
	"add_project_study",
	"remove_project_study",
])

export interface AgentMcpHub {
	getServers(): McpServer[]
}

/**
 * Why a `use_mcp_tool` call is not allowed for a read-only subagent, or undefined if it is allowed.
 * Unknown server/tool, an untrusted server, missing annotations, or a class other than READ are all refusals.
 */
export function agentMcpBlockReason(
	mcpHub: AgentMcpHub | undefined,
	serverName: string | undefined,
	toolName: string | undefined,
): string | undefined {
	if (!serverName || !toolName) {
		return "use_mcp_tool needs server_name and tool_name so the read-only policy can be checked."
	}
	if (AGENT_DENIED_MCP_TOOLS.has(toolName.trim())) {
		return `MCP tool '${toolName}' binds a chat to a study, changes a claim or the plan, or manages a project, so it is never available to a subagent.`
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
 * Why an `access_mcp_resource` call is not allowed for a read-only subagent, or undefined if it is allowed. A resource read is not
 * a tool call, so there is no effect annotation to check; the server must be the trusted first-party one on the live
 * connection (the same condition that lets the parent auto-run a resource read), and the call must be fully specified.
 */
export function agentResourceBlockReason(
	mcpHub: AgentMcpHub | undefined,
	serverName: string | undefined,
	uri: string | undefined,
): string | undefined {
	if (!serverName || !uri) {
		return "access_mcp_resource needs server_name and uri so the read-only policy can be checked."
	}
	const server = mcpHub?.getServers().find((s) => s.name === serverName)
	if (!server || !isServerTrusted(server)) {
		return `MCP server '${serverName}' is not the trusted first-party server, so a subagent may not read its resources.`
	}
	return undefined
}

/**
 * Reason a tool call is blocked for a subagent, or undefined if allowed.
 * Pure: the caller decides whether a subagent is active. `allowlist` defaults to the default definition's; a caller
 * passes the child's effective list (the intersection with the parent, see capFor), so the check is never wider than
 * the registry. `label` names the child kind in the refusal text.
 */
export function agentBlockReason(
	toolName: string,
	params: Record<string, unknown> | undefined,
	mcpHub: AgentMcpHub | undefined,
	allowlist: readonly string[] = DEFAULT_ALLOWED_TOOLS,
	label = "Explorer",
): string | undefined {
	if (!allowlist.includes(toolName)) {
		return `Tool '${toolName}' is not available in ${label.toUpperCase()} profile. This is a read-only research subagent. Use only ${READ_ONLY_TOOL_LIST}.`
	}
	if (toolName === AiHydroDefaultTool.MCP_USE) {
		const reason = agentMcpBlockReason(
			mcpHub,
			params?.server_name as string | undefined,
			params?.tool_name as string | undefined,
		)
		if (reason) {
			return `${reason} The ${label.toUpperCase()} profile is read-only: only read-only MCP tools on the trusted first-party server may be called (never run_python or write tools).`
		}
	}
	if (toolName === AiHydroDefaultTool.MCP_ACCESS) {
		const reason = agentResourceBlockReason(
			mcpHub,
			params?.server_name as string | undefined,
			params?.uri as string | undefined,
		)
		if (reason) {
			return `${reason} The ${label.toUpperCase()} profile is read-only.`
		}
	}
	return undefined
}
