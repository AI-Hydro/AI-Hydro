import type { McpServer } from "@shared/mcp"
import { AiHydroDefaultTool } from "@/shared/tools"

/**
 * Capability policy for the `explorer` subagent profile (AGENT_EXECUTION_MODEL §4, gap #3).
 *
 * The profile is advertised as physically read-only. Name-based blocking of the built-in write tools
 * is not enough on its own: `use_mcp_tool` reaches every MCP tool, including `run_python` and every
 * server-side write tool. So MCP calls are allowed only for tools whose MCP annotations declare
 * `readOnlyHint: true`. A tool with no annotations is NOT assumed read-only (fail closed); the
 * ai-hydro server gains annotations in Wave U5a, until then explorer can use built-in read tools,
 * MCP resources and docs, but no MCP tools.
 */

/** Built-in tools blocked outright in the explorer profile. */
export const EXPLORER_RESTRICTED_TOOLS: readonly AiHydroDefaultTool[] = [
	AiHydroDefaultTool.BASH, // execute_command
	AiHydroDefaultTool.FILE_NEW, // write_to_file
	AiHydroDefaultTool.FILE_EDIT, // replace_in_file
	AiHydroDefaultTool.MULTI_FILE_EDIT, // edit_files
	AiHydroDefaultTool.NEW_RULE, // new_rule
	AiHydroDefaultTool.BROWSER, // browser_action (has side effects)
	AiHydroDefaultTool.NEW_TASK, // new_task (no sub-spawning from explorer)
]

const READ_ONLY_TOOL_LIST =
	"read_file, search_files, list_files, list_code_definition_names, web_fetch, and MCP tools annotated readOnlyHint=true"

export interface ExplorerMcpHub {
	getServers(): McpServer[]
}

/**
 * Why an `use_mcp_tool` call is not allowed in explorer, or undefined if it is allowed.
 * Unknown server/tool, missing annotations, or readOnlyHint !== true are all refusals.
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
	if (tool.annotations?.readOnlyHint === true) {
		return undefined
	}
	return tool.annotations
		? `MCP tool '${serverName}/${toolName}' is not annotated readOnlyHint=true.`
		: `MCP tool '${serverName}/${toolName}' has no MCP annotations; unannotated tools are treated as NOT read-only.`
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
	if ((EXPLORER_RESTRICTED_TOOLS as readonly string[]).includes(toolName)) {
		return `Tool '${toolName}' is not available in EXPLORER profile. This is a read-only research subagent. Use only ${READ_ONLY_TOOL_LIST}.`
	}
	if (toolName === AiHydroDefaultTool.MCP_USE) {
		const reason = explorerMcpBlockReason(
			mcpHub,
			params?.server_name as string | undefined,
			params?.tool_name as string | undefined,
		)
		if (reason) {
			return `${reason} The EXPLORER profile is read-only: only MCP tools annotated readOnlyHint=true may be called (never run_python or write tools).`
		}
	}
	return undefined
}
