import { resolveWorkspacePath } from "@core/workspace"
import { isMultiRootEnabled } from "@core/workspace/multi-root-utils"
import { AiHydroDefaultTool } from "@shared/tools"
import * as os from "os"
import * as path from "path"
import { StateManager } from "@/core/storage/StateManager"
import { isProtectedPath } from "@/core/task/protectedPaths"
import { getHostProtectedRoots } from "@/core/task/protectedRoots"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir, isLocatedInPath, isLocatedInWorkspace } from "@/utils/path"

/** Tools that write files. Protected paths (MCP settings, extension storage, approval state, ~/.ssh) always ask for these. */
const FILE_WRITE_TOOLS: ReadonlySet<AiHydroDefaultTool> = new Set([
	AiHydroDefaultTool.NEW_RULE,
	AiHydroDefaultTool.FILE_NEW,
	AiHydroDefaultTool.FILE_EDIT,
	AiHydroDefaultTool.MULTI_FILE_EDIT,
])

/**
 * What a subagent may auto-approve at most. "read": built-in reads and MCP calls (the profile has already limited
 * MCP to READ class on a trusted server), never a write or a command, and never because of YOLO. "none": nothing, so
 * every call asks (an untrusted workspace). Absent: the top-level task, which follows the user's settings.
 */
export type AutoApproveCeiling = "read" | "none"

const READ_CEILING_TOOLS: ReadonlySet<AiHydroDefaultTool> = new Set([
	AiHydroDefaultTool.FILE_READ,
	AiHydroDefaultTool.LIST_FILES,
	AiHydroDefaultTool.SEARCH,
	AiHydroDefaultTool.MCP_USE,
	AiHydroDefaultTool.MCP_ACCESS,
])

export class AutoApprove {
	private stateManager: StateManager
	// Cache for workspace paths - populated on first access and reused for the task lifetime
	// NOTE: This assumes that the task has a fixed set of workspace roots(which is currently true).
	private workspacePathsCache: { paths: string[] } | null = null
	private isMultiRootScenarioCache: boolean | null = null

	constructor(
		stateManager: StateManager,
		private readonly ceiling?: AutoApproveCeiling,
	) {
		this.stateManager = stateManager
	}

	/** YOLO is a top-level setting: a subagent (any ceiling) never inherits it. */
	private yolo(): boolean {
		return this.ceiling === undefined && !!this.stateManager.getGlobalSettingsKey("yoloModeToggled")
	}

	/** True when the ceiling alone rules the tool out, before any setting is read. */
	private aboveCeiling(toolName: AiHydroDefaultTool): boolean {
		return this.ceiling === "none" || (this.ceiling === "read" && !READ_CEILING_TOOLS.has(toolName))
	}

	/**
	 * Get workspace information with caching to avoid repeated API calls
	 * Cache is task-scoped since each task gets a new AutoApprove instance
	 */
	private async getWorkspaceInfo(): Promise<{
		workspacePaths: { paths: string[] }
		isMultiRootScenario: boolean
	}> {
		// Check if we already have cached values
		if (this.workspacePathsCache === null || this.isMultiRootScenarioCache === null) {
			// First time - fetch and cache for the lifetime of this task
			this.workspacePathsCache = await HostProvider.workspace.getWorkspacePaths({})
			this.isMultiRootScenarioCache = isMultiRootEnabled(this.stateManager) && this.workspacePathsCache.paths.length > 1
		}

		return {
			workspacePaths: this.workspacePathsCache,
			isMultiRootScenario: this.isMultiRootScenarioCache,
		}
	}

	// Check if the tool should be auto-approved based on the settings
	// Returns bool for most tools, and tuple for tools with nested settings
	shouldAutoApproveTool(toolName: AiHydroDefaultTool): boolean | [boolean, boolean] {
		if (this.aboveCeiling(toolName)) {
			return false
		}
		if (this.yolo()) {
			switch (toolName) {
				case AiHydroDefaultTool.FILE_READ:
				case AiHydroDefaultTool.LIST_FILES:
				case AiHydroDefaultTool.SEARCH:
				case AiHydroDefaultTool.NEW_RULE:
				case AiHydroDefaultTool.FILE_NEW:
				case AiHydroDefaultTool.FILE_EDIT:
				case AiHydroDefaultTool.MULTI_FILE_EDIT:
				case AiHydroDefaultTool.BASH:
					return [true, true]

				case AiHydroDefaultTool.BROWSER:
				case AiHydroDefaultTool.WEB_FETCH:
				case AiHydroDefaultTool.MCP_ACCESS:
				case AiHydroDefaultTool.MCP_USE:
					return true
			}
		}

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		if (autoApprovalSettings.enabled) {
			switch (toolName) {
				case AiHydroDefaultTool.FILE_READ:
				case AiHydroDefaultTool.LIST_FILES:
				case AiHydroDefaultTool.SEARCH:
					return [autoApprovalSettings.actions.readFiles, autoApprovalSettings.actions.readFilesExternally ?? false]
				case AiHydroDefaultTool.NEW_RULE:
				case AiHydroDefaultTool.FILE_NEW:
				case AiHydroDefaultTool.FILE_EDIT:
				case AiHydroDefaultTool.MULTI_FILE_EDIT:
					return [autoApprovalSettings.actions.editFiles, autoApprovalSettings.actions.editFilesExternally ?? false]
				case AiHydroDefaultTool.BASH:
					return [
						autoApprovalSettings.actions.executeSafeCommands ?? false,
						autoApprovalSettings.actions.executeAllCommands ?? false,
					]
				case AiHydroDefaultTool.BROWSER:
					return autoApprovalSettings.actions.useBrowser
				case AiHydroDefaultTool.WEB_FETCH:
					return autoApprovalSettings.actions.useBrowser
				case AiHydroDefaultTool.MCP_ACCESS:
				case AiHydroDefaultTool.MCP_USE:
					return autoApprovalSettings.actions.useMcp
			}
		}
		return false
	}

	/**
	 * Whether a model-supplied write path resolves into protected state. A relative path is tried against the
	 * task cwd and every workspace root, and `~` is expanded, so no base makes a protected target look safe.
	 */
	private async isProtectedWritePath(actionPath: string | undefined): Promise<boolean> {
		if (!actionPath) {
			return false
		}
		const { workspacePaths } = await this.getWorkspaceInfo()
		const roots = getHostProtectedRoots()
		const expanded =
			actionPath === "~" || actionPath.startsWith("~/") || actionPath.startsWith("~\\")
				? path.join(os.homedir(), actionPath.slice(1))
				: actionPath
		if (path.isAbsolute(expanded)) {
			return isProtectedPath(expanded, roots)
		}
		const bases = new Set<string>([await getCwd(getDesktopDir()), ...workspacePaths.paths])
		return [...bases].some((base) => isProtectedPath(path.resolve(base, expanded), roots))
	}

	// Check if the tool should be auto-approved based on the settings
	// and the path of the action. Returns true if the tool should be auto-approved
	// based on the user's settings and the path of the action.
	async shouldAutoApproveToolWithPath(
		blockname: AiHydroDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		// Approval redesign AP1 (B3): writes to protected paths ask even with Edit auto-run, "Edit all files" or YOLO.
		if (FILE_WRITE_TOOLS.has(blockname) && (await this.isProtectedWritePath(autoApproveActionpath))) {
			return false
		}

		if (this.aboveCeiling(blockname)) {
			return false
		}

		if (this.yolo()) {
			return true
		}

		let isLocalRead: boolean = false
		if (autoApproveActionpath) {
			// Use cached workspace info instead of fetching every time
			const { isMultiRootScenario } = await this.getWorkspaceInfo()

			if (isMultiRootScenario) {
				// Multi-root: check if file is in ANY workspace
				isLocalRead = await isLocatedInWorkspace(autoApproveActionpath)
			} else {
				// Single-root: use existing logic
				const cwd = await getCwd(getDesktopDir())
				// When called with a string cwd, resolveWorkspacePath returns a string
				const absolutePath = resolveWorkspacePath(
					cwd,
					autoApproveActionpath,
					"AutoApprove.shouldAutoApproveToolWithPath",
				) as string
				isLocalRead = isLocatedInPath(cwd, absolutePath)
			}
		} else {
			// If we do not get a path for some reason, default to a (safer) false return
			isLocalRead = false
		}

		// Get auto-approve settings for local and external edits
		const autoApproveResult = this.shouldAutoApproveTool(blockname)
		const [autoApproveLocal, autoApproveExternal] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		if ((isLocalRead && autoApproveLocal) || (!isLocalRead && autoApproveLocal && autoApproveExternal)) {
			return true
		} else {
			return false
		}
	}
}
