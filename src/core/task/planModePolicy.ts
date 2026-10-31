import { AiHydroDefaultTool } from "@shared/tools"
import { type ExplorerMcpHub, explorerMcpBlockReason } from "./explorerPolicy"
import { classifyCommand, type ShellEnvironment } from "./readOnlyClassifier"

/**
 * Plan mode is read-only. Before 0.4.6 it blocked four file tools and nothing else: every MCP writer, `run_python`
 * (an MCP tool) and any shell command still ran, so "plan a study" could create runs and fill study slots.
 *
 * One rule, built from predicates that already exist and decide for the explorer subagent and for command auto-run:
 *  - a file-writing built-in is refused (the list below);
 *  - `use_mcp_tool` runs only for a READ-class tool on a TRUSTED server (`explorerMcpBlockReason`: annotations from any
 *    other server are untrusted hints, an unannotated tool is not read-only, and the tools that bind a chat or change a
 *    claim are refused by name);
 *  - `execute_command` runs only if the host's read-only classifier accepts every part of it (fail closed).
 *
 * The tool list the model sees does not change (a changing list would break the prompt cache): a refused call comes
 * back as a tool result that says it was Plan mode, so the model plans the step instead of trying again.
 */

/** Built-in tools that write files; refused in Plan mode (unchanged set, plus `preview_html`, which writes HTML to the workspace). */
export const PLAN_MODE_RESTRICTED_TOOLS: readonly AiHydroDefaultTool[] = [
	AiHydroDefaultTool.FILE_NEW,
	AiHydroDefaultTool.FILE_EDIT,
	AiHydroDefaultTool.MULTI_FILE_EDIT,
	AiHydroDefaultTool.NEW_RULE,
	AiHydroDefaultTool.PREVIEW_HTML,
]

const SWITCH = "Describe this step in the plan, or ask the user to switch to Act mode."

/** Why a call is refused in Plan mode (a message addressed to the model), or undefined when it may run. */
export function planModeBlockReason(
	toolName: string,
	params: Record<string, unknown> | undefined,
	mcpHub: ExplorerMcpHub | undefined,
	shellEnvironment?: ShellEnvironment,
): string | undefined {
	if ((PLAN_MODE_RESTRICTED_TOOLS as readonly string[]).includes(toolName)) {
		return `Tool '${toolName}' is not available in PLAN MODE. This tool is restricted to ACT MODE for file modifications. Only use tools available for PLAN MODE when in that mode.`
	}
	if (toolName === AiHydroDefaultTool.MCP_USE) {
		const reason = explorerMcpBlockReason(
			mcpHub,
			params?.server_name as string | undefined,
			params?.tool_name as string | undefined,
		)
		if (reason) {
			return `PLAN MODE is read-only, so this MCP call did not run. ${reason} In Plan mode only read-only tools on the trusted first-party server run. ${SWITCH}`
		}
	}
	if (toolName === AiHydroDefaultTool.BASH) {
		const command = typeof params?.command === "string" ? params.command : ""
		const verdict = classifyCommand(command, shellEnvironment)
		if (!verdict.readOnly) {
			return `PLAN MODE is read-only, so this command did not run (${verdict.reason}). In Plan mode only commands the host classifies as read-only run. ${SWITCH}`
		}
	}
	return undefined
}
