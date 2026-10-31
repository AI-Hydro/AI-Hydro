// Define available tool ids
export enum AiHydroDefaultTool {
	ASK = "ask_followup_question",
	ATTEMPT = "attempt_completion",
	BASH = "execute_command",
	FILE_EDIT = "replace_in_file",
	FILE_READ = "read_file",
	FILE_NEW = "write_to_file",
	MULTI_FILE_EDIT = "edit_files",
	SEARCH = "search_files",
	LIST_FILES = "list_files",
	BROWSER = "browser_action",
	MCP_USE = "use_mcp_tool",
	MCP_ACCESS = "access_mcp_resource",
	MCP_DOCS = "load_mcp_documentation",
	NEW_TASK = "new_task",
	PLAN_MODE = "plan_mode_respond",
	TODO = "focus_chain",
	WEB_FETCH = "web_fetch",
	CONDENSE = "condense",
	SUMMARIZE_TASK = "summarize_task",
	REPORT_BUG = "report_bug",
	NEW_RULE = "new_rule",
	PREVIEW_HTML = "preview_html",
	// Starts read-only explorer subagents (only when the setting is on; never registered for a child).
	SPAWN_SUBAGENTS = "spawn_subagents",
	// Child-only: the single exit of an in-process subagent. Never registered for a top-level task.
	REPORT_FINDINGS = "report_findings",
}

// Array of all tool names for compatibility
// Automatically generated from the enum values
export const toolUseNames = Object.values(AiHydroDefaultTool) as AiHydroDefaultTool[]
