import { ActionMetadata } from "./types"

export const ACTION_METADATA: ActionMetadata[] = [
	{
		id: "enableAutoApprove",
		label: "Enable auto-approve",
		shortName: "Enabled",
		description: "Toggle the auto-approve feature on or off.",
		icon: "codicon-play-circle",
	},
	{
		id: "enableAll",
		label: "Toggle all",
		shortName: "All",
		description: "Toggle all actions on or off.",
		icon: "codicon-checklist",
	},
	{
		id: "readFiles",
		label: "Read project files",
		shortName: "Read",
		description: "Allows AI-Hydro to read files within your workspace.",
		icon: "codicon-search",
		subAction: {
			id: "readFilesExternally",
			label: "Read all files",
			shortName: "Read (all)",
			description: "Allows AI-Hydro to read any file on your computer.",
			icon: "codicon-folder-opened",
			parentActionId: "readFiles",
		},
	},
	{
		id: "editFiles",
		label: "Edit project files",
		shortName: "Edit",
		description: "Allows AI-Hydro to modify files within your workspace.",
		icon: "codicon-edit",
		subAction: {
			id: "editFilesExternally",
			label: "Edit all files",
			shortName: "Edit (all)",
			description: "Allows AI-Hydro to modify any file on your computer.",
			icon: "codicon-files",
			parentActionId: "editFiles",
		},
	},
	{
		id: "executeSafeCommands",
		label: "Run read-only commands",
		shortName: "Read-only Commands",
		description:
			"Lets AI-Hydro run a command without asking only when AI-Hydro itself recognises it as read-only, from a short allowlist (ls, cat, grep, git status and similar, optionally piped to other read-only commands). The model's own opinion that a command is safe is not used. Anything else asks: unknown programs, ; && redirection, $(...), scripts (python -c, sh -c), curl and installs. This is a conservative filter, not a sandbox.",
		icon: "codicon-terminal",
		subAction: {
			id: "executeAllCommands",
			label: "Execute all commands",
			shortName: "All Commands",
			description:
				"Allows AI-Hydro to run any terminal command without asking, including ones the model marks as risky. Use at your own risk. Claim approval (aihydro-approve) and subagent launches are still blocked or asked.",
			icon: "codicon-terminal-bash",
			parentActionId: "executeSafeCommands",
		},
	},
	{
		id: "useBrowser",
		label: "Use the browser",
		shortName: "Browser",
		description: "Allows AI-Hydro to launch and interact with any website in a browser.",
		icon: "codicon-globe",
	},
	{
		id: "useMcp",
		label: "Use MCP servers",
		shortName: "MCP",
		description: "Allows AI-Hydro to use configured MCP servers which may modify filesystem or interact with APIs.",
		icon: "codicon-server",
	},
]

export const NOTIFICATIONS_SETTING: ActionMetadata = {
	id: "enableNotifications",
	label: "Enable notifications",
	shortName: "Notifications",
	description: "Receive system notifications when AI-Hydro requires approval to proceed or when a task is completed.",
	icon: "codicon-bell",
}
