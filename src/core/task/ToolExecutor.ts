import * as path from "node:path"
import { ApiHandler, ApiProviderInfo } from "@core/api"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"
import { AiHydroIgnoreController } from "@core/ignore/AiHydroIgnoreController"
import { DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { BrowserSession } from "@services/browser/BrowserSession"
import { UrlContentFetcher } from "@services/browser/UrlContentFetcher"
import { featureFlagsService } from "@services/feature-flags"
import { McpHub } from "@services/mcp/McpHub"
import { telemetryService } from "@services/telemetry"
import { callRowIndexToRecord } from "@shared/aihydro/askOutcome"
import { execOutcomeFor } from "@shared/aihydro/commandEvidence"
import type { SayEvidence } from "@shared/aihydro/infoNotice"
import type { SubagentReport } from "@shared/aihydro/subagents"
import { AiHydroAsk, AiHydroSay } from "@shared/ExtensionMessage"
import { AiHydroDefaultTool } from "@shared/tools"
import { AiHydroAskResponse } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import { getModelCapabilityTier, recommendedMaxMistakes } from "@/utils/model-capabilities"
import { modelDoesntSupportWebp } from "@/utils/model-utils"
import { ToolUse } from "../assistant-message"
import { ContextManager } from "../context/context-management/ContextManager"
import { Controller } from "../controller"
import { HookFactory } from "../hooks/hook-factory"
import { formatResponse } from "../prompts/responses"
import { StateManager } from "../storage/StateManager"
import { WorkspaceRootManager } from "../workspace"
import { ToolResponse } from "."
import { noteSessionStarted, START_SESSION_TOOL_NAME } from "./answerAuditGate"
import type { AskMeta } from "./askMeta"
import { browserToolRefusal } from "./browserGate"
import { explorerBlockReason } from "./explorerPolicy"
import { checkRepeatedToolCall, checkSemanticLoop, LOOP_DETECTION_SOFT_THRESHOLD, toolCallSignature } from "./loop-detection"
import { MessageStateHandler } from "./message-state"
import type { EffectiveCapabilities } from "./subagents/agentProfile"
import { TaskState } from "./TaskState"
import { AutoApprove } from "./tools/autoApprove"
import { AccessMcpResourceHandler } from "./tools/handlers/AccessMcpResourceHandler"
import { AskFollowupQuestionToolHandler } from "./tools/handlers/AskFollowupQuestionToolHandler"
import { AttemptCompletionHandler } from "./tools/handlers/AttemptCompletionHandler"
import { isAiHydroServerName } from "./tools/handlers/aiHydroServer"
import { BrowserToolHandler } from "./tools/handlers/BrowserToolHandler"
import { CondenseHandler } from "./tools/handlers/CondenseHandler"
import { ExecuteCommandToolHandler } from "./tools/handlers/ExecuteCommandToolHandler"
import { ListFilesToolHandler } from "./tools/handlers/ListFilesToolHandler"
import { LoadMcpDocumentationHandler } from "./tools/handlers/LoadMcpDocumentationHandler"
import { MultiFileEditToolHandler } from "./tools/handlers/MultiFileEditToolHandler"
import { NewTaskHandler } from "./tools/handlers/NewTaskHandler"
import { PlanModeRespondHandler } from "./tools/handlers/PlanModeRespondHandler"
import { PreviewHtmlToolHandler } from "./tools/handlers/PreviewHtmlToolHandler"
import { ReadFileToolHandler } from "./tools/handlers/ReadFileToolHandler"
import { ReportBugHandler } from "./tools/handlers/ReportBugHandler"
import { ReportFindingsHandler } from "./tools/handlers/ReportFindingsHandler"
import { SearchFilesToolHandler } from "./tools/handlers/SearchFilesToolHandler"
import { SpawnSubagentsToolHandler } from "./tools/handlers/SpawnSubagentsToolHandler"
import { SummarizeTaskHandler } from "./tools/handlers/SummarizeTaskHandler"
import { UseMcpToolHandler } from "./tools/handlers/UseMcpToolHandler"
import { WebFetchToolHandler } from "./tools/handlers/WebFetchToolHandler"
import { WriteToFileToolHandler } from "./tools/handlers/WriteToFileToolHandler"
import { IPartialBlockHandler, IToolHandler, SharedToolHandler, ToolExecutorCoordinator } from "./tools/ToolExecutorCoordinator"
import { repairToolParams } from "./tools/ToolInputRepair"
import { ToolValidator } from "./tools/ToolValidator"
import { TaskConfig, validateTaskConfig } from "./tools/types/TaskConfig"
import { createUIHelpers } from "./tools/types/UIHelpers"
import { ToolDisplayUtils } from "./tools/utils/ToolDisplayUtils"
import { ToolResultUtils } from "./tools/utils/ToolResultUtils"

/**
 * Set only when the executor serves a subagent (SubagentRunner). `profile` is the child's effective capabilities
 * (its profile intersected with what the parent could do, see capFor): the registry holds exactly those handlers, a
 * call outside them is refused before any handler runs, and nothing auto-approves above the profile's ceiling or
 * because of YOLO. Per executor on purpose: the extension host is one process, so a process-wide switch such as an
 * environment variable would restrict the parent too.
 */
export interface ToolExecutorOptions {
	profile?: EffectiveCapabilities
	/** Where a child's report_findings goes. Required with `profile`. */
	reportSink?: (report: SubagentReport) => void
	/** Called when a child's call is refused by its profile, before any handler or ask, so the record can say so. */
	onRefused?: (block: ToolUse, reason: string) => void
}

export class ToolExecutor {
	private autoApprover: AutoApprove
	private coordinator: ToolExecutorCoordinator
	private readonly profile?: EffectiveCapabilities
	private readonly reportSink?: (report: SubagentReport) => void
	private readonly onRefused?: (block: ToolUse, reason: string) => void

	// Effective consecutive-mistake threshold: never below the user's configured value, but
	// raised for weaker models that need more slack to self-correct. Loop hard-escalation sets
	// the mistake count to this so it reliably trips the auto-decompose path in the task loop.
	private effectiveMaxMistakes(): number {
		const configured = this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
		const tier = getModelCapabilityTier({ model: this.api.getModel() } as ApiProviderInfo)
		return Math.max(configured, recommendedMaxMistakes(tier))
	}

	// Auto-approval methods using the AutoApprove class
	private shouldAutoApproveTool(toolName: AiHydroDefaultTool): boolean | [boolean, boolean] {
		return this.autoApprover.shouldAutoApproveTool(toolName)
	}

	private async shouldAutoApproveToolWithPath(
		blockname: AiHydroDefaultTool,
		autoApproveActionpath: string | undefined,
	): Promise<boolean> {
		return this.autoApprover.shouldAutoApproveToolWithPath(blockname, autoApproveActionpath)
	}

	constructor(
		// Core Services & Managers
		private context: vscode.ExtensionContext,
		private taskState: TaskState,
		private messageStateHandler: MessageStateHandler,
		private api: ApiHandler,
		private urlContentFetcher: UrlContentFetcher,
		private browserSession: BrowserSession,
		private diffViewProvider: DiffViewProvider,
		private mcpHub: McpHub,
		private fileContextTracker: FileContextTracker,
		private aihydroIgnoreController: AiHydroIgnoreController,
		private contextManager: ContextManager,
		private stateManager: StateManager,
		private controller: Controller,

		// Configuration & Settings

		private cwd: string,
		private taskId: string,
		private ulid: string,

		// Workspace Management
		private workspaceManager: WorkspaceRootManager | undefined,
		private isMultiRootEnabled: boolean,

		// Callbacks to the Task (Entity)
		private say: (
			type: AiHydroSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
			evidence?: SayEvidence,
		) => Promise<number | undefined>,
		private ask: (
			type: AiHydroAsk,
			text?: string,
			partial?: boolean,
			meta?: AskMeta,
		) => Promise<{
			response: AiHydroAskResponse
			text?: string
			images?: string[]
			files?: string[]
		}>,
		private saveCheckpoint: (isAttemptCompletionMessage?: boolean, completionMessageTs?: number) => Promise<void>,
		private sayAndCreateMissingParamError: (
			toolName: AiHydroDefaultTool,
			paramName: string,
			relPath?: string,
		) => Promise<any>,
		private removeLastPartialMessageIfExistsWithType: (
			type: "ask" | "say",
			askOrSay: AiHydroAsk | AiHydroSay,
		) => Promise<void>,
		private executeCommandTool: (command: string, timeoutSeconds: number | undefined) => Promise<[boolean, any]>,
		private doesLatestTaskCompletionHaveNewChanges: () => Promise<boolean>,
		private updateFCListFromToolResponse: (taskProgress: string | undefined) => Promise<void>,
		private switchToActMode: () => Promise<boolean>,
		options: ToolExecutorOptions = {},
	) {
		this.profile = options.profile
		this.reportSink = options.reportSink
		this.onRefused = options.onRefused
		if (this.profile && !this.reportSink) {
			throw new Error("A subagent executor needs a reportSink")
		}
		this.autoApprover = new AutoApprove(this.stateManager, this.profile?.autoApproveCeiling)

		// Initialize the coordinator and register all tool handlers
		this.coordinator = new ToolExecutorCoordinator()
		this.registerToolHandlers()
	}

	// Create a properly typed TaskConfig object for handlers
	// NOTE: modifying this object in the tool handlers is okay since these are all references to the singular ToolExecutor instance's variables. However, be careful modifying this object assuming it will update the ToolExecutor instance, e.g. config.browserSession = ... will not update the ToolExecutor.browserSession instance variable. Use applyLatestBrowserSettings() instead.
	private asToolConfig(): TaskConfig {
		const config: TaskConfig = {
			taskId: this.taskId,
			ulid: this.ulid,
			context: this.context,
			mode: this.stateManager.getGlobalSettingsKey("mode"),
			strictPlanModeEnabled: this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled"),
			yoloModeToggled: this.stateManager.getGlobalSettingsKey("yoloModeToggled"),
			cwd: this.cwd,
			workspaceManager: this.workspaceManager,
			isMultiRootEnabled: this.isMultiRootEnabled,
			taskState: this.taskState,
			messageState: this.messageStateHandler,
			api: this.api,
			autoApprovalSettings: this.stateManager.getGlobalSettingsKey("autoApprovalSettings"),
			autoApprover: this.autoApprover,
			browserSettings: this.stateManager.getGlobalSettingsKey("browserSettings"),
			focusChainSettings: this.stateManager.getGlobalSettingsKey("focusChainSettings"),
			services: {
				mcpHub: this.mcpHub,
				browserSession: this.browserSession,
				urlContentFetcher: this.urlContentFetcher,
				diffViewProvider: this.diffViewProvider,
				fileContextTracker: this.fileContextTracker,
				aihydroIgnoreController: this.aihydroIgnoreController,
				contextManager: this.contextManager,
				stateManager: this.stateManager,
				controller: this.controller,
			},
			callbacks: {
				say: this.say,
				ask: this.ask,
				saveCheckpoint: this.saveCheckpoint,
				postStateToWebview: async () => {},
				reinitExistingTaskFromId: async () => {},
				cancelTask: async () => {},
				updateTaskHistory: async (_: any) => [],
				executeCommandTool: this.executeCommandTool,
				doesLatestTaskCompletionHaveNewChanges: this.doesLatestTaskCompletionHaveNewChanges,
				updateFCListFromToolResponse: this.updateFCListFromToolResponse,
				sayAndCreateMissingParamError: this.sayAndCreateMissingParamError,
				removeLastPartialMessageIfExistsWithType: this.removeLastPartialMessageIfExistsWithType,
				shouldAutoApproveTool: this.shouldAutoApproveTool.bind(this),
				shouldAutoApproveToolWithPath: this.shouldAutoApproveToolWithPath.bind(this),
				applyLatestBrowserSettings: this.applyLatestBrowserSettings.bind(this),
				switchToActMode: this.switchToActMode,
			},
			coordinator: this.coordinator,
		}

		// Validate the config at runtime to catch any missing properties
		validateTaskConfig(config)
		return config
	}

	/**
	 * Register all tool handlers with the coordinator
	 */
	private registerToolHandlers(): void {
		const validator = new ToolValidator(this.aihydroIgnoreController)

		if (this.profile) {
			this.registerProfileHandlers(validator)
			return
		}

		// Register all tool handlers
		this.coordinator.register(new ListFilesToolHandler(validator))
		this.coordinator.register(new ReadFileToolHandler(validator))
		this.coordinator.register(new BrowserToolHandler())
		this.coordinator.register(new PreviewHtmlToolHandler())
		this.coordinator.register(new AskFollowupQuestionToolHandler())
		this.coordinator.register(new WebFetchToolHandler())

		// Register WriteToFileToolHandler for all three file tools with proper typing
		const writeHandler = new WriteToFileToolHandler(validator)
		this.coordinator.register(writeHandler) // registers as "write_to_file" (AiHydroDefaultTool.FILE_NEW)
		this.coordinator.register(new SharedToolHandler(AiHydroDefaultTool.FILE_EDIT, writeHandler))
		this.coordinator.register(new SharedToolHandler(AiHydroDefaultTool.NEW_RULE, writeHandler))
		this.coordinator.register(new MultiFileEditToolHandler(validator))

		this.coordinator.register(new SearchFilesToolHandler(validator))
		this.coordinator.register(new ExecuteCommandToolHandler(validator))
		this.coordinator.register(new UseMcpToolHandler())
		this.coordinator.register(new AccessMcpResourceHandler())
		this.coordinator.register(new LoadMcpDocumentationHandler())
		this.coordinator.register(new PlanModeRespondHandler())
		this.coordinator.register(new NewTaskHandler())
		this.coordinator.register(new AttemptCompletionHandler())
		this.coordinator.register(new CondenseHandler())
		this.coordinator.register(new SummarizeTaskHandler())
		this.coordinator.register(new ReportBugHandler())
	}

	/**
	 * A subagent's registry: only the handlers its effective capabilities list, plus its exit tool. Anything else is
	 * absent, not merely refused (the refusal in execute() is the second line).
	 */
	private registerProfileHandlers(validator: ToolValidator): void {
		const profile = this.profile!
		const allowed = new Set<string>(profile.builtinAllow)
		const candidates: Array<[AiHydroDefaultTool, () => IToolHandler]> = [
			[AiHydroDefaultTool.LIST_FILES, () => new ListFilesToolHandler(validator)],
			[AiHydroDefaultTool.FILE_READ, () => new ReadFileToolHandler(validator)],
			[AiHydroDefaultTool.SEARCH, () => new SearchFilesToolHandler(validator)],
			[AiHydroDefaultTool.MCP_USE, () => new UseMcpToolHandler()],
			[AiHydroDefaultTool.MCP_ACCESS, () => new AccessMcpResourceHandler()],
			[AiHydroDefaultTool.MCP_DOCS, () => new LoadMcpDocumentationHandler()],
		]
		for (const [tool, make] of candidates) {
			if (allowed.has(tool)) {
				this.coordinator.register(make())
			}
		}
		this.coordinator.register(new ReportFindingsHandler(this.reportSink!))
	}

	/**
	 * `spawn_subagents` exists in a top-level executor's registry only while the setting is on, and never in a child's
	 * (AC1, S4). Synced on every call because the setting can change mid-task. When it is off, a call from a model that
	 * still remembers the tool gets an explicit result instead of silence.
	 */
	private syncSubagentHandler(): void {
		const wanted = !this.profile && this.stateManager.getGlobalSettingsKey("subagentsEnabled") === true
		const has = this.coordinator.has(AiHydroDefaultTool.SPAWN_SUBAGENTS)
		if (wanted && !has) {
			this.coordinator.register(new SpawnSubagentsToolHandler())
		} else if (!wanted && has) {
			this.coordinator.unregister(AiHydroDefaultTool.SPAWN_SUBAGENTS)
		}
	}

	/** The tool names a subagent may call: its effective built-ins plus the exit tool. */
	private profileAllowlist(): readonly string[] {
		return [...this.profile!.builtinAllow, this.profile!.reportTool]
	}

	/**
	 * Main entry point for tool execution - called by Task class
	 */
	public async executeTool(block: ToolUse): Promise<void> {
		await this.execute(block)
	}

	/**
	 * Updates the browser settings
	 */
	public async applyLatestBrowserSettings() {
		await this.browserSession.dispose()
		const apiHandlerModel = this.api.getModel()
		const useWebp = this.api ? !modelDoesntSupportWebp(apiHandlerModel) : true
		this.browserSession = new BrowserSession(this.stateManager, useWebp)
		return this.browserSession
	}

	/**
	 * Handles errors during tool execution
	 */
	private async handleError(action: string, error: Error, block: ToolUse): Promise<void> {
		console.log(error)
		const errorString = `Error ${action}: ${error.message}`
		await this.say("error", errorString)

		// Create error response for the tool
		const errorResponse = formatResponse.toolError(errorString)
		this.pushToolResult(errorResponse, block)
	}

	// Stable markers for tool results that represent a failure (and thus increment the
	// consecutive-mistake count). Used to feed the error-grounded auto-decompose nudge.
	private static readonly TOOL_ERROR_MARKERS = [
		"The tool execution failed with the following error:",
		"Missing value for required parameter",
		"Invalid JSON argument used with",
		"is blocked by the .aihydroignore",
	]

	/**
	 * A tool error is reported at the head of the result. Only the first few hundred characters are checked, so a
	 * successful result that merely contains a marker (e.g. reading a file that quotes one) is not marked failed.
	 */
	static isToolErrorResult(content: string): boolean {
		const head = content.slice(0, 300)
		return ToolExecutor.TOOL_ERROR_MARKERS.some((marker) => head.includes(marker))
	}

	private recordIfToolError(content: ToolResponse, block: ToolUse) {
		if (typeof content !== "string") {
			return
		}
		if (!ToolExecutor.isToolErrorResult(content)) {
			return
		}
		const entry = `[${block.name}] ${content.replace(/\s+/g, " ").trim()}`.slice(0, 300)
		this.taskState.recentToolErrors.push(entry)
		if (this.taskState.recentToolErrors.length > 3) {
			this.taskState.recentToolErrors.shift()
		}
	}

	/**
	 * Record on the call's UI row that its result came back, so the transcript can say "ran" or "failed" from evidence
	 * instead of inferring it from the approval. A denied call never ran, so it is not marked.
	 */
	private async recordExecution(content: ToolResponse): Promise<void> {
		const failed = typeof content === "string" && ToolExecutor.isToolErrorResult(content)
		const messages = this.messageStateHandler.getAiHydroMessages()
		const index = callRowIndexToRecord(messages)
		if (index >= 0) {
			await this.messageStateHandler.updateAiHydroMessage(index, { execOutcome: execOutcomeFor(messages[index], failed) })
		}
	}

	/** A first-party start_session may change which study is bound to this chat: refresh the gate's cached binding. */
	private noteStartSession(content: ToolResponse, block: ToolUse) {
		if (
			block.params.tool_name === START_SESSION_TOOL_NAME &&
			isAiHydroServerName(block.params.server_name) &&
			typeof content === "string" &&
			!ToolExecutor.isToolErrorResult(content)
		) {
			noteSessionStarted(this.taskState.answerAuditGate)
		}
	}

	private pushToolResult = (content: ToolResponse, block: ToolUse) => {
		this.recordIfToolError(content, block)
		this.noteStartSession(content, block)
		void this.recordExecution(content).catch((error) => console.error("Failed to record tool execution outcome", error))
		// Use the ToolResultUtils to properly format and push the tool result
		ToolResultUtils.pushToolResult(
			content,
			block,
			this.taskState.userMessageContent,
			(block: ToolUse) => ToolDisplayUtils.getToolDescription(block),
			this.api,
			() => {
				this.taskState.didAlreadyUseTool = true
			},
			this.coordinator,
		)
	}

	/**
	 * Tools that are restricted in plan mode and can only be used in act mode
	 */
	private static readonly PLAN_MODE_RESTRICTED_TOOLS: AiHydroDefaultTool[] = [
		AiHydroDefaultTool.FILE_NEW,
		AiHydroDefaultTool.FILE_EDIT,
		AiHydroDefaultTool.MULTI_FILE_EDIT,
		AiHydroDefaultTool.NEW_RULE,
	]

	/**
	 * Execute a tool through the coordinator if it's registered
	 */
	private async execute(block: ToolUse): Promise<boolean> {
		// A subagent's call is checked against its profile before anything else, and an unknown tool is refused with
		// a result (not "not handled"), so a model that names a tool outside its profile is told so and no handler runs.
		if (this.profile && !block.partial) {
			const reason = explorerBlockReason(block.name, block.params, this.mcpHub, this.profileAllowlist())
			if (reason || !this.coordinator.has(block.name)) {
				const message = reason ?? `Tool '${block.name}' is not available to this subagent.`
				this.onRefused?.(block, message)
				await this.say("error", message)
				this.pushToolResult(formatResponse.toolError(message), block)
				return true
			}
		}
		this.syncSubagentHandler()
		if (block.name === AiHydroDefaultTool.SPAWN_SUBAGENTS && !this.coordinator.has(block.name) && !block.partial) {
			const message = "Subagents are turned off. Do the work yourself with your own tools."
			await this.say("error", message)
			this.pushToolResult(formatResponse.toolError(message), block)
			return true
		}
		if (!this.coordinator.has(block.name)) {
			return false // Tool not handled by coordinator
		}

		const config = this.asToolConfig()

		try {
			// Check if user rejected a previous tool
			if (this.taskState.didRejectTool) {
				const reason = block.partial
					? "Tool was interrupted and not executed due to user rejecting a previous tool."
					: "Skipping tool due to user rejecting a previous tool."
				this.createToolRejectionMessage(block, reason)
				return true
			}

			// Check if a tool has already been used in this message
			if (this.taskState.didAlreadyUseTool) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: formatResponse.toolAlreadyUsed(block.name),
				})
				return true
			}

			// Logic for plan-mode tool call restrictions
			if (
				this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled") &&
				this.stateManager.getGlobalSettingsKey("mode") === "plan" &&
				block.name &&
				this.isPlanModeToolRestricted(block.name)
			) {
				const errorMessage = `Tool '${block.name}' is not available in PLAN MODE. This tool is restricted to ACT MODE for file modifications. Only use tools available for PLAN MODE when in that mode.`
				await this.say("error", errorMessage)
				this.pushToolResult(formatResponse.toolError(errorMessage), block)
				await this.saveCheckpoint()
				return true
			}

			// The browser tool is off by default (X0-5); refuse a call the prompt no longer offers (see browserGate.ts).
			const browserRefusal = browserToolRefusal(block.name, this.stateManager.getGlobalSettingsKey("browserSettings"))
			if (browserRefusal) {
				await this.say("error", browserRefusal)
				this.pushToolResult(formatResponse.toolError(browserRefusal), block)
				await this.saveCheckpoint()
				return true
			}

			// Close browser for non-browser tools (a subagent has no browser and must not close the parent's)
			if (!this.profile && block.name !== "browser_action") {
				await this.browserSession.closeBrowser()
			}

			// Handle partial blocks
			if (block.partial) {
				await this.handlePartialBlock(block, config)
				return true
			}

			// Handle complete blocks
			await this.handleCompleteBlock(block, config)
			await this.saveCheckpoint()
			return true
		} catch (error) {
			await this.handleError(`executing ${block.name}`, error as Error, block)
			await this.saveCheckpoint()
			return true
		}
	}

	/**
	 * Check if a tool is restricted in plan mode
	 */
	private isPlanModeToolRestricted(toolName: AiHydroDefaultTool): boolean {
		return ToolExecutor.PLAN_MODE_RESTRICTED_TOOLS.includes(toolName)
	}

	/**
	 * Create a tool rejection message and add it to user message content
	 */
	private createToolRejectionMessage(block: ToolUse, reason: string): void {
		this.taskState.userMessageContent.push({
			type: "text",
			text: `${reason} ${ToolDisplayUtils.getToolDescription(block, this.coordinator)}`,
		})
	}

	/**
	 * Adds hook context modification to the conversation if provided.
	 * Parses the context to extract type prefix and formats as XML.
	 *
	 * @param contextModification The context string from the hook output
	 * @param source The hook source name ("PreToolUse" or "PostToolUse")
	 */
	private addHookContextToConversation(contextModification: string | undefined, source: string): void {
		if (!contextModification) {
			return
		}

		const contextText = contextModification.trim()
		if (!contextText) {
			return
		}

		// Extract context type from first line if specified (e.g., "WORKSPACE_RULES: ...")
		const lines = contextText.split("\n")
		const firstLine = lines[0]
		let contextType = "general"
		let content = contextText

		// Check if first line specifies a type: "TYPE: content"
		const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
		const typeMatch = typeMatchRegex.exec(firstLine)
		if (typeMatch) {
			contextType = typeMatch[1].toLowerCase()
			const remainingLines = lines.slice(1).filter((l: string) => l.trim())
			content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
		}

		this.taskState.userMessageContent.push({
			type: "text",
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		})
	}

	/**
	 * Handle partial block streaming UI updates
	 */
	private async handlePartialBlock(block: ToolUse, config: TaskConfig): Promise<void> {
		// NOTE: We don't push tool results in partial blocks because this is only for UI streaming.
		// The ToolExecutor will handle pushToolResult() when the complete block is processed.
		// This maintains separation of concerns: partial = UI updates, complete = final state changes.
		const handler = this.coordinator.getHandler(block.name)

		// Check if handler supports partial blocks with proper typing
		if (handler && "handlePartialBlock" in handler) {
			const uiHelpers = createUIHelpers(config)
			const partialHandler = handler as IPartialBlockHandler
			await partialHandler.handlePartialBlock(block, uiHelpers)
		}
	}

	/**
	 * Handle complete block execution
	 */
	private async handleCompleteBlock(block: ToolUse, config: any): Promise<void> {
		// Check if hooks are enabled (both feature flag and user setting must be true)
		const featureFlagEnabled = featureFlagsService.getHooksEnabled()
		const userEnabled = this.stateManager.getGlobalSettingsKey("hooksEnabled")
		const hooksEnabled = featureFlagEnabled && userEnabled

		let executionSuccess = true
		let toolResult: any = null

		// Run PreToolUse hook, if enabled
		if (hooksEnabled) {
			let preToolUseResult: any = null
			try {
				const hookFactory = new HookFactory()
				const preToolUseHook = await hookFactory.create("PreToolUse")

				preToolUseResult = await preToolUseHook.run({
					taskId: this.taskId,
					preToolUse: {
						toolName: block.name,
						parameters: block.params,
					},
				})

				// Check if hook wants to stop execution
				if (!preToolUseResult.shouldContinue) {
					const errorMessage = preToolUseResult.errorMessage || "PreToolUse hook prevented tool execution"
					await this.say("error", errorMessage)
					this.pushToolResult(formatResponse.toolError(errorMessage), block)
					return
				}

				// Add context modification to the conversation if provided by the hook
				this.addHookContextToConversation(preToolUseResult.contextModification, "PreToolUse")
			} catch (hookError) {
				const errorMessage = `PreToolUse hook failed: ${hookError.toString()}`
				await this.say("error", errorMessage)
				this.pushToolResult(formatResponse.toolError(errorMessage), block)
				return
			}
		}

		// --- Tool-input repair (Domain A: path/string params) ---
		// Forgiving normalization for weaker models (e.g. markdown-autolinked paths).
		// Runs BEFORE loop detection so a repaired path neither masks nor fakes a loop.
		// Never touches partial (still-streaming) blocks.
		if (!block.partial) {
			const { params: repairedParams, repairs } = repairToolParams(block.params)
			if (repairs.length > 0) {
				block.params = repairedParams
				telemetryService.captureToolInputRepaired(
					this.ulid,
					block.name,
					this.api.getModel().id,
					repairs.map((r) => r.kind),
				)
			}
		}

		// --- Repeated tool call loop detection ---
		// Must run BEFORE updating lastToolName/lastToolParams so we compare
		// against the previous call's values, not the current one.
		const currentSignature = toolCallSignature(block.params)
		const loopCheck = checkRepeatedToolCall(this.taskState, block.name, currentSignature)

		if (loopCheck.softWarning) {
			this.taskState.userMessageContent.push({
				type: "text",
				text: formatResponse.repeatedToolCall(block.name, LOOP_DETECTION_SOFT_THRESHOLD),
			})
			telemetryService.captureLoopDetected(this.ulid, block.name, this.api.getModel().id, "identical", "soft")
		}

		if (loopCheck.hardEscalation) {
			this.taskState.consecutiveMistakeCount = this.effectiveMaxMistakes()
			telemetryService.captureLoopDetected(this.ulid, block.name, this.api.getModel().id, "identical", "hard")
		}

		// --- Semantic loop detection ---
		// Catches "same target, varying args, no progress" loops that byte-identical
		// signature matching misses (e.g. repeated zero-result searches with different
		// regexes, or re-reading the same file). Soft warning nudges a strategy change;
		// hard escalation feeds the mistake-limit auto-decompose path.
		if (!block.partial) {
			// Resolve read_file paths to absolute so different relative spellings of the
			// same file still trip the repeated-read guard.
			let semanticParams = block.params
			if (block.name === "read_file" && block.params.path) {
				const rawPath = block.params.path.trim()
				const abs = rawPath.startsWith("/") ? rawPath : path.resolve(this.cwd, rawPath)
				semanticParams = { ...block.params, path: abs }
			}
			const semanticCheck = checkSemanticLoop(this.taskState, block.name, semanticParams)
			if (semanticCheck.softWarning) {
				this.taskState.userMessageContent.push({
					type: "text",
					text: formatResponse.semanticLoop(block.name),
				})
				telemetryService.captureLoopDetected(this.ulid, block.name, this.api.getModel().id, "semantic", "soft")
			}
			if (semanticCheck.hardEscalation) {
				this.taskState.consecutiveMistakeCount = this.effectiveMaxMistakes()
				telemetryService.captureLoopDetected(this.ulid, block.name, this.api.getModel().id, "semantic", "hard")
			}
		}

		// Update state AFTER comparison
		this.taskState.lastToolName = block.name
		this.taskState.lastToolParams = currentSignature

		const executionStartTime = Date.now()
		try {
			// Execute the actual tool
			toolResult = await this.coordinator.execute(config, block)
			this.pushToolResult(toolResult, block)
		} catch (error) {
			executionSuccess = false
			toolResult = formatResponse.toolError(`Tool execution failed: ${error}`)
			this.pushToolResult(toolResult, block)
			throw error
		} finally {
			// Run PostToolUse hook if enabled
			if (hooksEnabled) {
				const hookFactory = new HookFactory()
				const postToolUseHook = await hookFactory.create("PostToolUse")

				const executionTimeMs = Date.now() - executionStartTime
				const postToolUseResult = await postToolUseHook.run({
					taskId: this.taskId,
					postToolUse: {
						toolName: block.name,
						parameters: block.params,
						result: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
						success: executionSuccess,
						executionTimeMs,
					},
				})

				// Add context modification to the conversation if provided by the hook
				this.addHookContextToConversation(postToolUseResult.contextModification, "PostToolUse")

				// Log any error messages from the hook
				if (postToolUseResult.errorMessage) {
					this.say("error", postToolUseResult.errorMessage)
				}
			}
		}

		// Handle focus chain updates
		if (!block.partial && this.stateManager.getGlobalSettingsKey("focusChainSettings").enabled) {
			await this.updateFCListFromToolResponse(block.params.task_progress)
		}
	}
}
