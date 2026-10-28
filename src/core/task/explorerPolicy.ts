import { isServerTrusted } from "@shared/aihydro/firstPartyServers"
import { effectClass } from "@shared/aihydro/mcpEffectClass"
import type { McpServer } from "@shared/mcp"
import { AiHydroDefaultTool } from "@/shared/tools"

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
 * Built-in tools the explorer profile may call. This is an ALLOWLIST: any tool not listed here
 * (including tools added later, e.g. preview_html which writes model-supplied HTML to the workspace
 * and opens it, or report_bug which opens an external issue) is refused by default.
 * use_mcp_tool is allowed here but further gated by MCP readOnlyHint (see explorerMcpBlockReason).
 */
export const EXPLORER_ALLOWED_TOOLS: readonly AiHydroDefaultTool[] = [
	AiHydroDefaultTool.FILE_READ,
	AiHydroDefaultTool.SEARCH,
	AiHydroDefaultTool.LIST_FILES,
	AiHydroDefaultTool.WEB_FETCH,
	AiHydroDefaultTool.MCP_USE, // gated by readOnlyHint
	AiHydroDefaultTool.MCP_ACCESS,
	AiHydroDefaultTool.MCP_DOCS,
	AiHydroDefaultTool.ASK,
	AiHydroDefaultTool.ATTEMPT,
	AiHydroDefaultTool.CONDENSE,
	AiHydroDefaultTool.SUMMARIZE_TASK,
	AiHydroDefaultTool.PLAN_MODE,
	AiHydroDefaultTool.TODO,
]

const READ_ONLY_TOOL_LIST =
	"read_file, search_files, list_files, web_fetch, and read-only MCP tools (readOnlyHint=true, openWorldHint=false) on the trusted first-party server"

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
 * Reason a tool call is blocked in the explorer profile, or undefined if allowed.
 * Pure: the caller decides whether the explorer profile is active.
 */
export function explorerBlockReason(
	toolName: string,
	params: Record<string, unknown> | undefined,
	mcpHub: ExplorerMcpHub | undefined,
): string | undefined {
	if (!(EXPLORER_ALLOWED_TOOLS as readonly string[]).includes(toolName)) {
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
	return undefined
}
