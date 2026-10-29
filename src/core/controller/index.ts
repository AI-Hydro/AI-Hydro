import { Anthropic } from "@anthropic-ai/sdk"
import { buildApiHandler } from "@core/api"
import { LedgerEventWatcher } from "@core/ledger/LedgerEventWatcher"
import { MapCommandWatcher } from "@core/map/MapCommandWatcher"
import { MapEventWatcher } from "@core/map/MapEventWatcher"
import { buildMapLayerCatalogAsync, type MapLayerCatalogEntry, persistMapLayerCatalog } from "@core/map/mapLayerCatalog"
import { type MapLayerPatch, mergeMapLayerPatch } from "@core/map/mergeMapLayerPatch"
import { sanitizeMapLayerForWebview } from "@core/map/sanitizeMapLayerForWebview"
import { tryAcquireTaskLockWithRetry } from "@core/task/TaskLockUtils"
import { detectWorkspaceRoots } from "@core/workspace/detection"
import { FileScanner, WorkspaceGeoJsonFile } from "@core/workspace/FileScanner"
import { setupWorkspaceManager } from "@core/workspace/setup"
import { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { realPathInsideFolder } from "@core/workspace/workspaceGeoPaths"
import {
	type BindingHub,
	type ChatStatus,
	candidatesForPicker,
	chatStatus,
	type EnsureProjectResult,
	ensureProject,
	findBindingServer,
	type LaunchStudyHint,
	parseBindingSignal,
	readCapabilities,
	rebindChat,
	resolveLaunchBinding,
} from "@integrations/aihydro-session/studyBinding"
import { cleanupLegacyCheckpoints } from "@integrations/checkpoints/CheckpointMigration"
import { downloadTask } from "@integrations/misc/export-markdown"
import { ArtifactKernelService } from "@services/artifact-preview/ArtifactKernelService"
import type { ArtifactRef } from "@services/artifact-preview/ArtifactPreviewService"
import { ArtifactPreviewService } from "@services/artifact-preview/ArtifactPreviewService"
import { shouldInlineHtml } from "@services/artifact-preview/inlineHtmlPolicy"
import { geoFormatConverter } from "@services/geo/GeoFormatConverter"
import { GeoConversionError } from "@services/geo/types"
import { McpHub } from "@services/mcp/McpHub"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { ApiProvider, ModelInfo } from "@shared/api"
import { ARTIFACT_TRUST_METADATA_KEYS } from "@shared/artifactTrust"
import { ChatContent } from "@shared/ChatContent"
import { MAX_REMOTE_CATALOG_BYTES, MAX_REMOTE_CONNECTORS } from "@shared/connectors"
import type { StudyBindingState } from "@shared/ExtensionMessage"
import { ExtensionState, Platform } from "@shared/ExtensionMessage"
import { HistoryItem, type HistoryOrigin } from "@shared/HistoryItem"
import { McpMarketplaceCatalog } from "@shared/mcp"
import { HtmlPreviewItem, HtmlPreviewMode, LearningModuleCatalog } from "@shared/proto/cline/html_preview"
import type { ClaimUpdate } from "@shared/proto/cline/ledger"
import { MapLayer } from "@shared/proto/cline/map"
import { Settings } from "@shared/storage/state-keys"
import { Mode } from "@shared/storage/types"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import pWaitFor from "p-wait-for"
import * as path from "path"
import type { FolderLockWithRetryResult } from "src/core/locks/types"
import { ulid } from "ulid"
import * as vscode from "vscode"
import { AiHydroEnv } from "@/config"
import { resolveWorkspaceRoot } from "@/core/mcp/workspaceRoot"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import { LogoutReason } from "@/services/auth/types"
import { featureFlagsService } from "@/services/feature-flags"
import { PreviewCommandWatcher } from "@/services/htmlPreview/PreviewCommandWatcher"
import { PreviewSessionService } from "@/services/htmlPreview/PreviewSessionService"
import { getDistinctId } from "@/services/logging/distinctId"
import { MapSessionService } from "@/services/map/MapSessionService"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import { telemetryService } from "@/services/telemetry"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getLatestAnnouncementId } from "@/utils/announcements"
import { getCwd, getDesktopDir } from "@/utils/path"
import { ChatTitleService } from "../chat-title/ChatTitleService"
import { exchangeFromMessages } from "../chat-title/chatExchange"
import { TITLE_REPLY_CHAR_CAP } from "../chat-title/titleGenerator"
import { withTitleModel } from "../chat-title/titleModelConfig"
import { PromptRegistry } from "../prompts/system-prompt"
import {
	ensureCacheDirectoryExists,
	ensureMcpServersDirectoryExists,
	ensureSettingsDirectoryExists,
	GlobalFileNames,
	getSavedAiHydroMessages,
	getTaskHistoryStateFilePath,
	writeMcpMarketplaceCatalogToCache,
} from "../storage/disk"
import { type HistoryWriter, patchHistory, removeFromHistory } from "../storage/historyPatch"
import { backupHistoryOnce, describeMigration, planProjectMigration, resolveProjects } from "../storage/projectMigration"
import { PersistenceErrorEvent, StateManager } from "../storage/StateManager"
import { Task } from "../task"
import { getHostProtectedRoots } from "../task/protectedRoots"
import { sendMcpMarketplaceCatalogEvent } from "./mcp/subscribeToMcpMarketplaceCatalog"
import { appendAiHydroStealthModels } from "./models/refreshOpenRouterModels"
import { sendStateUpdate } from "./state/subscribeToState"
import { clearPending } from "./ui/pendingAskBadge"
import { sendChatButtonClickedEvent } from "./ui/subscribeToChatButtonClicked"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts

https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

/** The longest the launch binding may hold a task back. */
export const LAUNCH_BINDING_BUDGET_MS = 10_000
/** The longest a new chat waits for the server to make (or find) its project. A miss is retried in the background. */
export const LAUNCH_PROJECT_BUDGET_MS = 5_000
const PROJECT_RETRY_MAX = 5
/** M2 (fallback titles) starts this long after activation. */
const TITLE_MIGRATION_DELAY_MS = 3_000

/** The migration waits for the AI-Hydro server to connect: this often, this many times, then gives up until the next activation. */
const MIGRATION_POLL_MS = 5_000
const MIGRATION_POLL_MAX = 24

/** How a chat is launched: where from, the user's own words when the prompt is wrapped, and what is known of its study. */
export interface ChatLaunch {
	origin: HistoryOrigin
	userQuestion?: string
	studyHint?: LaunchStudyHint
}

export class Controller {
	task?: Task

	mcpHub: McpHub
	ocaAuthService: OcaAuthService
	readonly stateManager: StateManager

	// NEW: Add workspace manager (optional initially)
	private workspaceManager?: WorkspaceRootManager
	private fileScanner?: FileScanner
	private workspaceGeoJsonFiles: WorkspaceGeoJsonFile[] = []
	private workspaceHtmlFiles: Array<{ uri: vscode.Uri; relativePath: string; name: string }> = []
	private htmlFileWatcher?: vscode.FileSystemWatcher
	private backgroundCommandRunning = false
	private backgroundCommandTaskId?: string

	// Shell integration warning tracker
	private shellIntegrationWarningTracker: {
		timestamps: number[]
		lastSuggestionShown?: number
	} = { timestamps: [] }

	// Timer for periodic remote config fetching

	// Map layer storage, streaming, and Python event bridge
	private mapLayers: Map<string, MapLayer> = new Map()
	private mapLayerOrder: string[] = []
	/** Catalog entries older than the restore cap: not loaded, but carried through every catalog rewrite. */
	private mapOverflowEntries: MapLayerCatalogEntry[] = []
	/** True until the startup catalog restore has finished (the empty-state card must not show before then). */
	private mapHydrating = true
	/** Resolves when startup hydration is done; catalog rewrites wait for it so they cannot clobber unrestored data. */
	private mapHydration: Promise<void> = Promise.resolve()
	private mapLayerSubscribers: Set<(layer: MapLayer) => void> = new Set()
	private mapEventWatcher: MapEventWatcher
	private mapCommandWatcher: MapCommandWatcher
	readonly mapSessionService: MapSessionService
	readonly previewSessionService: PreviewSessionService
	private previewCommandWatcher?: PreviewCommandWatcher

	// Claims ledger: LedgerEventWatcher polls ~/.aihydro/ledger_events/ for
	// claim events pushed by MCP tools (add_claim, update_claim_status) and
	// broadcasts them to subscribeToClaimUpdates() streaming subscribers
	// (the Evidence Board webview).
	private ledgerEventWatcher: LedgerEventWatcher
	private claimUpdateSubscribers: Set<(update: ClaimUpdate) => void> = new Set()

	// HTML preview storage and streaming.
	//
	// `htmlPreviewService` is the canonical source of truth for artifacts;
	// the controller only owns the streaming subscription set, the active-id
	// pointer, and the monotonically-increasing version used as a state
	// signal to the webview.
	readonly htmlPreviewService: ArtifactPreviewService
	readonly artifactKernelService: ArtifactKernelService
	private htmlPreviewSubscribers: Set<(item: HtmlPreviewItem) => void> = new Set()
	private htmlPreviewVersion = 0
	private htmlPreviewActiveId: string | null = null
	private htmlPreviewActivationSeq = 0

	// Public getter for workspace manager with lazy initialization - To get workspaces when task isn't initialized (Used by file mentions)
	async ensureWorkspaceManager(): Promise<WorkspaceRootManager | undefined> {
		if (!this.workspaceManager) {
			try {
				this.workspaceManager = await setupWorkspaceManager({
					stateManager: this.stateManager,
					detectRoots: detectWorkspaceRoots,
				})
			} catch (error) {
				console.error("[Controller] Failed to initialize workspace manager:", error)
			}
		}
		return this.workspaceManager
	}

	// Synchronous getter for workspace manager
	getWorkspaceManager(): WorkspaceRootManager | undefined {
		return this.workspaceManager
	}

	constructor(readonly context: vscode.ExtensionContext) {
		PromptRegistry.getInstance() // Ensure prompts and tools are registered
		HostProvider.get().logToChannel("AiHydroProvider instantiated")
		this.stateManager = StateManager.get()

		// Initialize workspace GeoJSON file scanner
		this.initializeFileScanner()

		// Initialize workspace HTML file scanner
		this.scanWorkspaceHtmlFiles()

		// Owns artifact registration (file + inline) for the HTML preview panel.
		this.htmlPreviewService = new ArtifactPreviewService(context)
		this.htmlPreviewService.onChange(this.onArtifactChange)
		this.artifactKernelService = new ArtifactKernelService(context)
		context.subscriptions.push({ dispose: () => this.artifactKernelService.dispose() })

		this.mapSessionService = new MapSessionService()
		void this.mapSessionService
			.initialize()
			.catch((error) => console.error("[Controller] Map session initialization failed:", error))
		// Start watching ~/.aihydro/map_events/ for layers pushed by Python tools
		this.mapEventWatcher = new MapEventWatcher(this)
		this.mapEventWatcher.start()
		// Restore layers from the persisted catalog so Python-pushed layers
		// survive VS Code window reloads without re-running MCP tools.
		this.mapHydration = import("@core/map/hydrateMapLayers")
			.then(({ hydrateMapLayersFromCatalog }) => hydrateMapLayersFromCatalog(this, this.currentMapScope()))
			.catch((err) => console.warn("[Controller] Layer hydration failed (non-fatal):", err))
			.finally(() => {
				this.mapHydrating = false
				this.emitMapRestoreState()
			})
		// Phase 1: PreviewSessionService mirrors events to ~/.aihydro/preview_session/
		// and ~/.aihydro/preview_events/ for MCP-tool consumption.
		// PreviewCommandWatcher polls ~/.aihydro/preview_commands/ for agent commands
		// (focus_cell, revise_section, address_comment) written by tools_preview.py.
		this.previewSessionService = new PreviewSessionService()
		this.previewCommandWatcher = new PreviewCommandWatcher(this)
		this.previewCommandWatcher.start()
		this.mapCommandWatcher = new MapCommandWatcher(this)
		this.mapCommandWatcher.start()
		this.ledgerEventWatcher = new LedgerEventWatcher(this)
		this.ledgerEventWatcher.start()
		StateManager.get().registerCallbacks({
			onPersistenceError: async ({ error }: PersistenceErrorEvent) => {
				console.error("[Controller] Cache persistence failed, recovering:", error)
				try {
					await StateManager.get().reInitialize(this.task?.taskId)
					await this.postStateToWebview()
					HostProvider.window.showMessage({
						type: ShowMessageType.WARNING,
						message: "Saving settings to storage failed.",
					})
				} catch (recoveryError) {
					console.error("[Controller] Cache recovery failed:", recoveryError)
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: "Failed to save settings. Please restart the extension.",
					})
				}
			},
			onSyncExternalChange: async () => {
				await this.postStateToWebview()
			},
		})
		this.ocaAuthService = OcaAuthService.initialize(this)

		this.mcpHub = new McpHub(
			() => ensureMcpServersDirectoryExists(),
			() => ensureSettingsDirectoryExists(),
			ExtensionRegistryInfo.version,
			telemetryService,
		)

		// Clean up legacy checkpoints
		cleanupLegacyCheckpoints().catch((error) => {
			console.error("Failed to cleanup legacy checkpoints:", error)
		})

		this.startProjectMigration()
		this.startTitleMigration()
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	async dispose() {
		// Stop map and ledger event watchers
		this.mapEventWatcher.stop()
		this.mapCommandWatcher.stop()
		this.ledgerEventWatcher.stop()
		try {
			await this.mapSessionService.flushPersistence()
		} catch (error) {
			console.error("[Controller] Map session persistence flush failed:", error)
		}

		// Dispose file scanner
		if (this.fileScanner) {
			this.fileScanner.dispose()
			this.fileScanner = undefined
		}

		// Dispose HTML file watcher
		if (this.htmlFileWatcher) {
			this.htmlFileWatcher.dispose()
			this.htmlFileWatcher = undefined
		}

		await this.clearTask()
		this.mcpHub.dispose()

		console.error("Controller disposed")
	}

	// Oca Auth methods
	async handleOcaSignOut() {
		try {
			await this.ocaAuthService.handleDeauth(LogoutReason.USER_INITIATED)
			await this.postStateToWebview()
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Successfully logged out of OCA",
			})
		} catch (_error) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "OCA Logout failed",
			})
		}
	}

	async initTask(
		task?: string,
		images?: string[],
		files?: string[],
		historyItem?: HistoryItem,
		taskSettings?: Partial<Settings>,
		launch?: ChatLaunch,
	) {
		await this.clearTask() // ensures that an existing task doesn't exist before starting a new one, although this shouldn't be possible since user must clear task before starting a new one

		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		const vscodeTerminalExecutionMode = this.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const terminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		const isNewUser = this.stateManager.getGlobalStateKey("isNewUser")
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")

		const NEW_USER_TASK_COUNT_THRESHOLD = 10

		// Check if the user has completed enough tasks to no longer be considered a "new user"
		if (isNewUser && !historyItem && taskHistory && taskHistory.length >= NEW_USER_TASK_COUNT_THRESHOLD) {
			this.stateManager.setGlobalState("isNewUser", false)
			await this.postStateToWebview()
		}

		if (autoApprovalSettings) {
			const updatedAutoApprovalSettings = {
				...autoApprovalSettings,
				version: (autoApprovalSettings.version ?? 1) + 1,
			}
			this.stateManager.setGlobalState("autoApprovalSettings", updatedAutoApprovalSettings)
		}

		// Initialize and persist the workspace manager (multi-root or single-root) with telemetry + fallback
		this.workspaceManager = await setupWorkspaceManager({
			stateManager: this.stateManager,
			detectRoots: detectWorkspaceRoots,
		})

		const cwd = this.workspaceManager?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))

		// RAG workspace venv check will be done interactively in Task.startTask()
		// This allows us to ask the user for approval before installation

		const taskId = historyItem?.id || Date.now().toString()

		// Acquire task lock
		let taskLockAcquired = false
		const lockResult: FolderLockWithRetryResult = await tryAcquireTaskLockWithRetry(taskId)

		if (!lockResult.acquired && !lockResult.skipped) {
			const errorMessage = lockResult.conflictingLock
				? `Task locked by instance (${lockResult.conflictingLock.held_by})`
				: "Failed to acquire task lock"
			throw new Error(errorMessage) // Prevents task initialization
		}

		taskLockAcquired = lockResult.acquired
		if (lockResult.acquired) {
			console.debug(`[Task ${taskId}] Task lock acquired`)
		} else {
			console.debug(`[Task ${taskId}] Task lock skipped (VS Code)`)
		}

		await this.stateManager.loadTaskSettings(taskId)
		if (taskSettings) {
			this.stateManager.setTaskSettingsBatch(taskId, taskSettings)
		}

		// X0-2: the chat id exists before the task does, so the chat is bound to its study BEFORE the task's first
		// tool call. A failure to bind never stops the task; it is shown in the chip instead.
		const chatUlid = historyItem?.ulid ?? ulid()
		// X1-P1: the chat's project exists before its first tool call, so every call can carry `_meta.project_id`.
		await this.resolveChatProject(chatUlid, cwd, historyItem)
		await this.bindChatAtLaunch(chatUlid, cwd, historyItem, launch)

		this.task = new Task({
			ulid: chatUlid,
			launch: historyItem ? undefined : { origin: launch?.origin ?? "chat", userQuestion: launch?.userQuestion },
			controller: this,
			mcpHub: this.mcpHub,
			updateTaskHistory: (historyItem) => this.updateTaskHistory(historyItem),
			postStateToWebview: () => this.postStateToWebview(),
			reinitExistingTaskFromId: (taskId) => this.reinitExistingTaskFromId(taskId),
			cancelTask: () => this.cancelTask(),
			shellIntegrationTimeout,
			terminalReuseEnabled: terminalReuseEnabled ?? true,
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			defaultTerminalProfile: defaultTerminalProfile ?? "default",
			vscodeTerminalExecutionMode,
			cwd,
			stateManager: this.stateManager,
			workspaceManager: this.workspaceManager,
			task,
			images,
			files,
			historyItem,
			taskId,
			taskLockAcquired,
		})

		return this.task.taskId
	}

	async reinitExistingTaskFromId(taskId: string) {
		const history = await this.getTaskWithId(taskId)
		if (history) {
			await this.initTask(undefined, undefined, undefined, history.historyItem)
		}
	}

	async updateTelemetrySetting(telemetrySetting: TelemetrySetting) {
		this.stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		const isOptedIn = telemetrySetting !== "disabled"
		telemetryService.updateTelemetryState(isOptedIn)
		await this.postStateToWebview()
	}

	async toggleActModeForYoloMode(): Promise<boolean> {
		const modeToSwitchTo: Mode = "act"

		// Switch to act mode
		this.stateManager.setGlobalState("mode", modeToSwitchTo)

		// Update API handler with new mode (buildApiHandler now selects provider based on mode)
		if (this.task) {
			const apiConfiguration = this.stateManager.getApiConfiguration()
			this.task.api = buildApiHandler({ ...apiConfiguration, ulid: this.task.ulid }, modeToSwitchTo)
		}

		await this.postStateToWebview()

		// Additional safety
		if (this.task) {
			return true
		}
		return false
	}

	async togglePlanActMode(modeToSwitchTo: Mode, chatContent?: ChatContent): Promise<boolean> {
		const didSwitchToActMode = modeToSwitchTo === "act"

		// Store mode to global state
		this.stateManager.setGlobalState("mode", modeToSwitchTo)

		// Capture mode switch telemetry | Capture regardless of if we know the taskId
		telemetryService.captureModeSwitch(this.task?.ulid ?? "0", modeToSwitchTo)

		// Update API handler with new mode (buildApiHandler now selects provider based on mode)
		if (this.task) {
			const apiConfiguration = this.stateManager.getApiConfiguration()
			this.task.api = buildApiHandler({ ...apiConfiguration, ulid: this.task.ulid }, modeToSwitchTo)
		}

		await this.postStateToWebview()

		if (this.task) {
			if (this.task.taskState.isAwaitingPlanResponse && didSwitchToActMode) {
				this.task.taskState.didRespondToPlanAskBySwitchingMode = true
				// Use chatContent if provided, otherwise use default message
				await this.task.handleWebviewAskResponse(
					"messageResponse",
					chatContent?.message || "PLAN_MODE_TOGGLE_RESPONSE",
					chatContent?.images || [],
					chatContent?.files || [],
				)

				return true
			} else {
				if (modeToSwitchTo === "plan") {
					// A held answer draft is revealed by abortTask with this reason (W2-C).
					this.task.taskState.answerAuditGate.interruptReason = "switched to Plan mode"
				}
				this.cancelTask()
				return false
			}
		}

		return false
	}

	async cancelTask() {
		if (this.task) {
			this.updateBackgroundCommandState(false)
			const { historyItem } = await this.getTaskWithId(this.task.taskId)
			try {
				await this.task.abortTask()
			} catch (error) {
				console.error("Failed to abort task", error)
			}
			await pWaitFor(
				() =>
					this.task === undefined ||
					this.task.taskState.isStreaming === false ||
					this.task.taskState.didFinishAbortingStream ||
					this.task.taskState.isWaitingForFirstChunk, // if only first chunk is processed, then there's no need to wait for graceful abort (closes edits, browser, etc)
				{
					timeout: 3_000,
				},
			).catch(() => {
				console.error("Failed to abort task")
			})
			if (this.task) {
				// 'abandoned' will prevent this cline instance from affecting future cline instance gui. this may happen if its hanging on a streaming request
				this.task.taskState.abandoned = true
			}
			await this.initTask(undefined, undefined, undefined, historyItem) // clears task again, so we need to abortTask manually above
			// Dont send the state to the webview, the new AI-Hydro instance will send state when it's ready.
			// Sending the state here sent an empty messages array to webview leading to virtuoso having to reload the entire list
		}
	}

	updateBackgroundCommandState(running: boolean, taskId?: string) {
		const nextTaskId = running ? taskId : undefined
		if (this.backgroundCommandRunning === running && this.backgroundCommandTaskId === nextTaskId) {
			return
		}
		this.backgroundCommandRunning = running
		this.backgroundCommandTaskId = nextTaskId
		void this.postStateToWebview()
	}

	async cancelBackgroundCommand(): Promise<void> {
		const didCancel = await this.task?.cancelBackgroundCommand()
		if (!didCancel) {
			this.updateBackgroundCommandState(false)
		}
	}

	/**
	 * Check if we should show the background terminal suggestion based on shell integration warning frequency
	 * @returns true if we should show the suggestion, false otherwise
	 */
	shouldShowBackgroundTerminalSuggestion(): boolean {
		const oneHourAgo = Date.now() - 60 * 60 * 1000

		// Clean old timestamps (older than 1 hour)
		this.shellIntegrationWarningTracker.timestamps = this.shellIntegrationWarningTracker.timestamps.filter(
			(ts) => ts > oneHourAgo,
		)

		// Add current warning
		this.shellIntegrationWarningTracker.timestamps.push(Date.now())

		// Check if we've shown suggestion recently (within last hour)
		if (
			this.shellIntegrationWarningTracker.lastSuggestionShown &&
			Date.now() - this.shellIntegrationWarningTracker.lastSuggestionShown < 60 * 60 * 1000
		) {
			return false
		}

		// Show suggestion if 3+ warnings in last hour
		if (this.shellIntegrationWarningTracker.timestamps.length >= 3) {
			this.shellIntegrationWarningTracker.lastSuggestionShown = Date.now()
			return true
		}

		return false
	}

	async handleOcaAuthCallback(code: string, state: string) {
		try {
			await this.ocaAuthService.handleAuthCallback(code, state)
			const currentMode = this.stateManager.getGlobalSettingsKey("mode")
			const updatedConfig = this.stateManager.getApiConfiguration()
			this.stateManager.setGlobalState("welcomeViewCompleted", true)

			if (this.task) {
				this.task.api = buildApiHandler({ ...updatedConfig, ulid: this.task.ulid }, currentMode)
			}

			await this.postStateToWebview()
		} catch (error) {
			console.error("Failed to handle auth callback:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to log in to OCA",
			})
			// Even on login failure, we preserve any existing tokens
			// Only clear tokens on explicit logout
		}
	}

	async handleTaskCreation(prompt: string) {
		await sendChatButtonClickedEvent()
		await this.initTask(prompt)
	}

	// MCP Marketplace
	private async fetchMcpMarketplaceFromApi(silent: boolean = false): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const response = await axios.get(`${AiHydroEnv.config().mcpBaseUrl}/marketplace.json`, {
				headers: {
					"Content-Type": "application/json",
				},
			})

			if (!response.data) {
				throw new Error("Invalid response from MCP marketplace API")
			}

			const recognitionCounts = await MarketplaceRecognitionService.getCounts("mcp")
			const catalog: McpMarketplaceCatalog = {
				items: (response.data || []).map((item: any) => {
					const mcpId = item.mcpId || item.mcp_id || ""
					const counts = recognitionCounts.get(mcpId)
					const aiHydroInstalls = Number(counts?.events.install ?? 0)
					return {
						...item,
						mcpId,
						githubStars: item.githubStars ?? 0,
						downloadCount: item.downloadCount ?? 0,
						authorUrl: item.authorUrl || item.author_url || "",
						citation: item.citation || "",
						citationUrl: item.citationUrl || item.citation_url || "",
						aiHydroInstalls,
						aiHydroStars: Number(counts?.aiHydroStars ?? counts?.events.star ?? 0),
						starredByClient: Boolean(counts?.starredByClient ?? false),
						tags: item.tags ?? [],
					}
				}),
			}

			// Store in cache file
			await writeMcpMarketplaceCatalogToCache(catalog)
			return catalog
		} catch (error) {
			console.error("Failed to fetch MCP marketplace:", error)
			if (!silent) {
				const errorMessage = error instanceof Error ? error.message : "Failed to fetch MCP marketplace"
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: errorMessage,
				})
			}
			return undefined
		}
	}

	private async fetchMcpMarketplaceFromApiRPC(silent: boolean = false): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const response = await axios.get(`${AiHydroEnv.config().mcpBaseUrl}/marketplace.json`, {
				headers: {
					"Content-Type": "application/json",
					"User-Agent": "aihydro-vscode-extension",
				},
			})

			if (!response.data) {
				throw new Error("Invalid response from MCP marketplace API")
			}

			const recognitionCounts = await MarketplaceRecognitionService.getCounts("mcp")
			const catalog: McpMarketplaceCatalog = {
				items: (response.data || []).map((item: any) => {
					const mcpId = item.mcpId || item.mcp_id || ""
					const counts = recognitionCounts.get(mcpId)
					const aiHydroInstalls = Number(counts?.events.install ?? 0)
					return {
						...item,
						mcpId,
						githubStars: item.githubStars ?? 0,
						downloadCount: item.downloadCount ?? 0,
						authorUrl: item.authorUrl || item.author_url || "",
						citation: item.citation || "",
						citationUrl: item.citationUrl || item.citation_url || "",
						aiHydroInstalls,
						aiHydroStars: Number(counts?.aiHydroStars ?? counts?.events.star ?? 0),
						starredByClient: Boolean(counts?.starredByClient ?? false),
						tags: item.tags ?? [],
					}
				}),
			}

			// Store in cache file
			await writeMcpMarketplaceCatalogToCache(catalog)
			return catalog
		} catch (error) {
			console.error("Failed to fetch MCP marketplace:", error)
			if (!silent) {
				const errorMessage = error instanceof Error ? error.message : "Failed to fetch MCP marketplace"
				throw new Error(errorMessage)
			}
			return undefined
		}
	}

	async silentlyRefreshMcpMarketplace() {
		try {
			const catalog = await this.fetchMcpMarketplaceFromApi(true)
			if (catalog) {
				await sendMcpMarketplaceCatalogEvent(catalog)
			}
		} catch (error) {
			console.error("Failed to silently refresh MCP marketplace:", error)
		}
	}

	/**
	 * RPC variant that silently refreshes the MCP marketplace catalog and returns the result
	 * Unlike silentlyRefreshMcpMarketplace, this doesn't send a message to the webview
	 * @returns MCP marketplace catalog or undefined if refresh failed
	 */
	async silentlyRefreshMcpMarketplaceRPC() {
		try {
			return await this.fetchMcpMarketplaceFromApiRPC(true)
		} catch (error) {
			console.error("Failed to silently refresh MCP marketplace (RPC):", error)
			return undefined
		}
	}

	async silentlyRefreshModulesMarketplaceRPC(): Promise<LearningModuleCatalog | undefined> {
		try {
			const response = await axios.get(`${AiHydroEnv.config().modulesBaseUrl}/modules.json`, {
				headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
			})
			if (!response.data) throw new Error("Invalid response from Modules marketplace API")
			const recognitionCounts = await MarketplaceRecognitionService.getCounts("modules")
			const { readModuleRegistry } = await import("@/services/htmlPreview/moduleRegistry")
			const moduleRegistry = await readModuleRegistry()
			const catalog: LearningModuleCatalog = {
				items: (Array.isArray(response.data) ? response.data : []).map((item: any) => {
					const moduleId = item.moduleId || item.id || ""
					const counts = recognitionCounts.get(moduleId)
					const remoteVersion = item.version || "0.1.0"
					const installedEntry = moduleRegistry[moduleId]
					// Standalone update awareness only: a course-tagged module is updated
					// via its course card, never via a stray standalone "Update" button.
					const isStandalone = !!installedEntry && !installedEntry.courseId
					const updateAvailable = isStandalone && !!installedEntry?.version && installedEntry.version !== remoteVersion
					return {
						moduleId,
						title: item.title || "",
						description: item.description || "",
						version: remoteVersion,
						author: item.author || "",
						license: typeof item.license === "string" ? item.license.trim() : "", // never default: undeclared stays undeclared
						topic: item.topic || "",
						level: item.level || "intro",
						estimatedMinutes: item.estimatedMinutes || item.estimated_minutes || 0,
						tags: item.tags || [],
						thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || "",
						downloadUrl: item.downloadUrl || item.download_url || "",
						githubUrl: item.githubUrl || item.github_url || "",
						authorUrl: item.authorUrl || item.author_url || "",
						citation: item.citation || "",
						citationUrl: item.citationUrl || item.citation_url || "",
						isInstalled: !!installedEntry,
						installedVersion: installedEntry?.version || "",
						updateAvailable,
						createdAt: item.createdAt || item.created_at || "",
						updatedAt: item.updatedAt || item.updated_at || "",
						downloadCount: item.downloadCount || item.download_count || 0,
						aiHydroInstalls: Number(counts?.events.install ?? 0),
						aiHydroStars: Number(counts?.aiHydroStars ?? counts?.events.star ?? 0),
						starredByClient: Boolean(counts?.starredByClient ?? false),
						githubReactions: item.githubReactions || item.github_reactions || 0,
						isFeatured: item.isFeatured || item.is_featured || false,
						discussionUrl: item.discussionUrl || item.discussion_url || "",
						courseId: item.courseId || item.course_id || "",
						courseTitle: item.courseTitle || item.course_title || "",
						courseOrder: item.courseOrder || item.course_order || 0,
					}
				}),
			}
			return catalog
		} catch (error) {
			console.error("Failed to fetch Modules marketplace:", error)
			return undefined
		}
	}

	async silentlyRefreshCoursesMarketplaceRPC(): Promise<import("@shared/proto/cline/html_preview").CourseCatalog | undefined> {
		try {
			const response = await axios.get(`${AiHydroEnv.config().modulesBaseUrl}/courses.json`, {
				headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
			})
			if (!response.data) throw new Error("Invalid response from Courses marketplace API")
			const { CourseCatalog } = await import("@shared/proto/cline/html_preview")

			// Reflect local install + progress state from disk so the UI can show
			// "Installed", progress rings, and a "Continue" affordance without an
			// extra round-trip.
			const fsp = await import("fs/promises")
			const pathMod = await import("path")
			let registry: Record<string, any> = {}
			try {
				registry = JSON.parse(await fsp.readFile(aihydroPath("modules", "installed.json"), "utf-8"))
			} catch {
				// no modules installed yet
			}
			const installedIds = new Set(Object.keys(registry))
			const { readCourseRegistry } = await import("@/services/htmlPreview/moduleRegistry")
			const courseRegistry = await readCourseRegistry()
			const recognitionCounts = await MarketplaceRecognitionService.getCounts("courses")

			const items = await Promise.all(
				(Array.isArray(response.data) ? response.data : []).map(async (item: any) => {
					const courseId = item.courseId || item.course_id || item.id || ""
					const modules = (Array.isArray(item.modules) ? item.modules : []).map((m: any, idx: number) => {
						const moduleId = m.id || m.moduleId || m.module_id || ""
						return {
							moduleId,
							title: m.title || "",
							abstract: m.abstract || m.description || "",
							path: m.path || "",
							downloadUrl: m.downloadUrl || m.download_url || "",
							estimatedMinutes: m.estimatedMinutes || m.estimated_minutes || 0,
							prerequisites: m.prerequisites || [],
							isInstalled: installedIds.has(moduleId),
							courseOrder: idx + 1,
						}
					})
					// A course counts as installed once every member module is on disk.
					const courseInstalled = modules.length > 0 && modules.every((m: any) => m.isInstalled)
					// modulesCompleted from the per-course progress file.
					let modulesCompleted = 0
					if (courseId) {
						try {
							const { loadProgress } = await import("@/services/htmlPreview/courseProgressStore")
							const progress = await loadProgress(courseId)
							modulesCompleted = modules.filter((m: any) => progress.completed[m.moduleId]).length
						} catch {
							// no progress yet
						}
					}
					const authors = Array.isArray(item.authors) ? item.authors : []
					return { item, courseId, modules, courseInstalled, modulesCompleted, authors }
				}),
			).then((rows) =>
				rows.map(({ item, courseId, modules, courseInstalled, modulesCompleted, authors }) => ({
					courseId: item.courseId || item.course_id || item.id || "",
					title: item.title || "",
					abstract: item.abstract || item.description || "",
					author: item.author || authors[0]?.name || "",
					authorAffiliation: item.authorAffiliation || item.author_affiliation || authors[0]?.affiliation || "",
					version: item.version || "0.1.0",
					license: typeof item.license === "string" ? item.license.trim() : "", // never default: undeclared stays undeclared
					estimatedHours: item.estimatedHours || item.estimated_hours || 0,
					level: item.level || "intro",
					tags: item.tags || [],
					thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || "",
					courseUrl: item.courseUrl || item.course_url || "",
					githubUrl: item.githubUrl || item.github_url || "",
					manifestUrl: item.manifestUrl || item.manifest_url || item.downloadUrl || item.download_url || "",
					isFeatured: item.isFeatured || item.is_featured || false,
					createdAt: item.createdAt || item.created_at || "",
					updatedAt: item.updatedAt || item.updated_at || "",
					topic: item.topic || "",
					modules,
					modulesCompleted,
					isInstalled: courseInstalled,
					installedVersion: courseRegistry[item.courseId || item.course_id || item.id || ""]?.version || "",
					updateAvailable: (() => {
						const cid = item.courseId || item.course_id || item.id || ""
						const inst = courseRegistry[cid]
						return !!inst?.version && inst.version !== (item.version || "0.1.0")
					})(),
					aiHydroInstalls: Number(
						recognitionCounts.get(item.courseId || item.course_id || item.id || "")?.events.install ?? 0,
					),
					aiHydroStars: (() => {
						const c = recognitionCounts.get(item.courseId || item.course_id || item.id || "")
						return Number(c?.aiHydroStars ?? c?.events.star ?? 0)
					})(),
					starredByClient: Boolean(
						recognitionCounts.get(item.courseId || item.course_id || item.id || "")?.starredByClient ?? false,
					),
					// Rich author / trust / citation metadata (parity with the Research Gallery).
					contributors: (() => {
						const raw = Array.isArray(item.contributors) ? item.contributors : authors
						return raw.map((c: any) => ({
							name: c.name || "",
							github: c.github || c.githubUsername || "",
							orcid: c.orcid || "",
							affiliation: c.affiliation || "",
							profileUrl: c.profileUrl || c.profile_url || "",
							url: c.url || "",
							website: c.website || "",
							linkedin: c.linkedin || "",
							googleScholar: c.googleScholar || c.google_scholar || "",
							roles: Array.isArray(c.roles) ? c.roles : [],
						}))
					})(),
					trustLevel: item.trustLevel || item.trust_level || "community",
					citation: item.citation || "",
					citationUrl: item.citationUrl || item.citation_url || "",
					authorUrl: item.authorUrl || item.author_url || authors[0]?.profileUrl || authors[0]?.url || "",
				})),
			)
			return CourseCatalog.create({ items })
		} catch (error) {
			console.error("Failed to fetch Courses marketplace:", error)
			return undefined
		}
	}

	async silentlyRefreshConnectorsCatalogRPC(): Promise<string | undefined> {
		try {
			const response = await axios.get(`${AiHydroEnv.config().connectorsBaseUrl}/connectors.json`, {
				headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
				timeout: 10000,
				// The catalog is untrusted input: bound its size before parsing.
				maxContentLength: MAX_REMOTE_CATALOG_BYTES,
				maxBodyLength: MAX_REMOTE_CATALOG_BYTES,
			})
			if (!response.data) throw new Error("Invalid response from Connectors catalog API")
			return JSON.stringify(Array.isArray(response.data) ? response.data.slice(0, MAX_REMOTE_CONNECTORS) : [])
		} catch (error) {
			console.error("Failed to fetch Connectors catalog:", error)
			return undefined
		}
	}

	async silentlyRefreshSkillsMarketplaceRPC(): Promise<import("@shared/proto/cline/skills").SkillCatalog | undefined> {
		try {
			const response = await axios.get(`${AiHydroEnv.config().skillsBaseUrl}/skills.json`, {
				headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
				timeout: 10000,
			})
			if (!response.data) throw new Error("Invalid response from Skills marketplace API")
			const { SkillCatalog, SkillItem, SkillSource } = await import("@shared/proto/cline/skills")
			const recognitionCounts = await MarketplaceRecognitionService.getCounts("skills")
			const items = (Array.isArray(response.data) ? response.data : []).map((item: any) =>
				SkillItem.create({
					skillId: item.skillId || item.id || "",
					name: item.name || "",
					description: item.description || "",
					version: item.version || "0.1.0",
					author: item.author || "",
					domain: item.domain || "general",
					category: item.category || "",
					codiconIcon: item.codiconIcon || item.codicon_icon || "book",
					tags: item.tags || [],
					toolsUsed: item.toolsUsed || item.tools_used || [],
					whenToUse: item.whenToUse || item.when_to_use || "",
					githubUrl: item.githubUrl || item.github_url || "",
					skillUrl: item.skillUrl || item.skill_url || "",
					authorUrl: item.authorUrl || item.author_url || "",
					citation: item.citation || "",
					citationUrl: item.citationUrl || item.citation_url || "",
					isRecommended: item.isRecommended || item.is_recommended || false,
					githubStars: item.githubStars || item.github_stars || 0,
					downloadCount: item.downloadCount || item.download_count || 0,
					aiHydroInstalls: Number(recognitionCounts.get(item.skillId || item.id || "")?.events.install ?? 0),
					aiHydroStars: Number(
						recognitionCounts.get(item.skillId || item.id || "")?.aiHydroStars ??
							recognitionCounts.get(item.skillId || item.id || "")?.events.star ??
							0,
					),
					starredByClient: Boolean(recognitionCounts.get(item.skillId || item.id || "")?.starredByClient ?? false),
					isInstalled: false,
					createdAt: item.createdAt || item.created_at || "",
					updatedAt: item.updatedAt || item.updated_at || "",
					source: SkillSource.MARKETPLACE,
				}),
			)
			return SkillCatalog.create({ items })
		} catch (error) {
			console.error("Failed to fetch Skills marketplace:", error)
			return undefined
		}
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let apiKey: string
		try {
			const response = await axios.post("https://openrouter.ai/api/v1/auth/keys", { code })
			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			console.error("Error exchanging code for API key:", error)
			throw error
		}

		const openrouter: ApiProvider = "openrouter"
		const currentMode = this.stateManager.getGlobalSettingsKey("mode")

		// Update API configuration through cache service
		const currentApiConfiguration = this.stateManager.getApiConfiguration()
		const updatedConfig = {
			...currentApiConfiguration,
			planModeApiProvider: openrouter,
			actModeApiProvider: openrouter,
			openRouterApiKey: apiKey,
		}
		this.stateManager.setApiConfiguration(updatedConfig)

		await this.postStateToWebview()
		if (this.task) {
			this.task.api = buildApiHandler({ ...updatedConfig, ulid: this.task.ulid }, currentMode)
		}
		// Dont send settingsButtonClicked because its bad ux if user is on welcome
	}

	// Read OpenRouter models from disk cache
	async readOpenRouterModels(): Promise<Record<string, ModelInfo> | undefined> {
		const openRouterModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.openRouterModels)
		try {
			if (await fileExistsAtPath(openRouterModelsFilePath)) {
				const fileContents = await fs.readFile(openRouterModelsFilePath, "utf8")
				const models = JSON.parse(fileContents)
				// Append stealth models
				return appendAiHydroStealthModels(models)
			}
		} catch (error) {
			console.error("Error reading cached OpenRouter models:", error)
		}
		return undefined
	}

	// Read Vercel AI Gateway models from disk cache
	async readVercelAiGatewayModels(): Promise<Record<string, ModelInfo> | undefined> {
		const vercelAiGatewayModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.vercelAiGatewayModels)
		const fileExists = await fileExistsAtPath(vercelAiGatewayModelsFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(vercelAiGatewayModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		}
		return undefined
	}

	// Task history

	async getTaskWithId(id: string): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		contextHistoryFilePath: string
		taskMetadataFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const history = this.stateManager.getGlobalStateKey("taskHistory")
		const historyItem = history.find((item) => item.id === id)
		if (historyItem) {
			const taskDirPath = path.join(HostProvider.get().globalStorageFsPath, "tasks", id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const contextHistoryFilePath = path.join(taskDirPath, GlobalFileNames.contextHistory)
			const taskMetadataFilePath = path.join(taskDirPath, GlobalFileNames.taskMetadata)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)
			if (fileExists) {
				const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))
				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					contextHistoryFilePath,
					taskMetadataFilePath,
					apiConversationHistory,
				}
			}
		}
		// if we tried to get a task that doesn't exist, remove it from state
		// FIXME: this seems to happen sometimes when the json file doesn't save to disk for some reason
		await this.deleteTaskFromState(id)
		throw new Error("Task not found")
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		await downloadTask(historyItem.ts, apiConversationHistory)
	}

	/** Ids deleted in this session: a late loop save for one is a no-op (see patchTaskHistory). */
	private deletedTaskIds = new Set<string>()

	/** Tombstone ids removed in bulk (delete all), so a save already in flight cannot bring one back. */
	markTasksDeleted(ids: Iterable<string>): void {
		for (const id of ids) {
			this.deletedTaskIds.add(id)
		}
	}

	async deleteTaskFromState(id: string) {
		this.deletedTaskIds.add(id)
		this._chatTitles?.cancelFor(id)
		// Remove the task from history
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")
		const updatedTaskHistory = removeFromHistory(taskHistory, id)
		this.stateManager.setGlobalState("taskHistory", updatedTaskHistory)

		// Notify the webview that the task has been deleted
		await this.postStateToWebview()

		return updatedTaskHistory
	}

	async postStateToWebview() {
		const state = await this.getStateToPostToWebview()
		await sendStateUpdate(state)
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		// Get API configuration from cache for immediate access
		const apiConfiguration = this.stateManager.getApiConfiguration()
		const lastShownAnnouncementId = this.stateManager.getGlobalStateKey("lastShownAnnouncementId")
		const taskHistory = this.stateManager.getGlobalStateKey("taskHistory")
		const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
		const browserSettings = this.stateManager.getGlobalSettingsKey("browserSettings")
		const focusChainSettings = this.stateManager.getGlobalSettingsKey("focusChainSettings")
		const preferredLanguage = this.stateManager.getGlobalSettingsKey("preferredLanguage")
		const openaiReasoningEffort = this.stateManager.getGlobalSettingsKey("openaiReasoningEffort")
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const strictPlanModeEnabled = this.stateManager.getGlobalSettingsKey("strictPlanModeEnabled")
		const yoloModeToggled = this.stateManager.getGlobalSettingsKey("yoloModeToggled")
		const useAutoCondense = this.stateManager.getGlobalSettingsKey("useAutoCondense")
		const mcpMarketplaceEnabled = this.stateManager.getGlobalStateKey("mcpMarketplaceEnabled")
		const mcpDisplayMode = this.stateManager.getGlobalStateKey("mcpDisplayMode")
		const telemetrySetting = this.stateManager.getGlobalSettingsKey("telemetrySetting")
		const planActSeparateModelsSetting = this.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
		const enableCheckpointsSetting = this.stateManager.getGlobalSettingsKey("enableCheckpointsSetting")
		const globalAiHydroRulesToggles = this.stateManager.getGlobalSettingsKey("globalAiHydroRulesToggles")
		const globalWorkflowToggles = this.stateManager.getGlobalSettingsKey("globalWorkflowToggles")
		const shellIntegrationTimeout = this.stateManager.getGlobalSettingsKey("shellIntegrationTimeout")
		const terminalReuseEnabled = this.stateManager.getGlobalStateKey("terminalReuseEnabled")
		const vscodeTerminalExecutionMode = this.stateManager.getGlobalStateKey("vscodeTerminalExecutionMode")
		const defaultTerminalProfile = this.stateManager.getGlobalSettingsKey("defaultTerminalProfile")
		const isNewUser = this.stateManager.getGlobalStateKey("isNewUser")
		const welcomeViewCompleted = Boolean(this.stateManager.getGlobalStateKey("welcomeViewCompleted"))
		const customPrompt = this.stateManager.getGlobalSettingsKey("customPrompt")
		const mcpResponsesCollapsed = this.stateManager.getGlobalStateKey("mcpResponsesCollapsed")
		const terminalOutputLineLimit = this.stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
		const maxConsecutiveMistakes = this.stateManager.getGlobalSettingsKey("maxConsecutiveMistakes")
		const favoritedModelIds = this.stateManager.getGlobalStateKey("favoritedModelIds")
		const lastDismissedInfoBannerVersion = this.stateManager.getGlobalStateKey("lastDismissedInfoBannerVersion") || 0
		const lastDismissedModelBannerVersion = this.stateManager.getGlobalStateKey("lastDismissedModelBannerVersion") || 0
		const subagentsEnabled = this.stateManager.getGlobalSettingsKey("subagentsEnabled")
		const finalAnswerAuditEnabled = this.stateManager.getGlobalSettingsKey("finalAnswerAuditEnabled")
		const transcriptDetail = this.stateManager.getGlobalSettingsKey("transcriptDetail")
		const finalAnswerAuditGate = this.stateManager.getGlobalSettingsKey("finalAnswerAuditGate")
		const autoTitle = this.stateManager.getGlobalSettingsKey("autoTitle")
		const titleModel = this.stateManager.getGlobalSettingsKey("titleModel")

		const localAiHydroRulesToggles = this.stateManager.getWorkspaceStateKey("localAiHydroRulesToggles")
		const localWindsurfRulesToggles = this.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
		const localCursorRulesToggles = this.stateManager.getWorkspaceStateKey("localCursorRulesToggles")
		const workflowToggles = this.stateManager.getWorkspaceStateKey("workflowToggles")
		const autoCondenseThreshold = this.stateManager.getGlobalSettingsKey("autoCondenseThreshold")

		const currentTaskItem = this.task?.taskId ? (taskHistory || []).find((item) => item.id === this.task?.taskId) : undefined
		const aihydroMessages = this.task?.messageStateHandler.getAiHydroMessages() || []
		const checkpointManagerErrorMessage = this.task?.taskState.checkpointManagerErrorMessage
		// The study chip's state is host-owned (launch binding, tool-result signals, the user's choice); a state
		// for another chat is never shown.
		const boundState = this.task && this.studyBinding?.chatId === this.task.ulid ? this.studyBinding : undefined
		const chatProject = this.task && this.chatProject?.chatId === this.task.ulid ? this.chatProject : undefined
		const studyBinding =
			boundState && chatProject && (chatProject.projectId || chatProject.note)
				? {
						...boundState,
						project: {
							...(chatProject.projectId ? { id: chatProject.projectId } : {}),
							...(chatProject.title ? { title: chatProject.title } : {}),
							...(chatProject.note ? { note: chatProject.note } : {}),
						},
					}
				: boundState

		const processedTaskHistory = (taskHistory || [])
			.filter((item) => item.ts && item.task)
			.sort((a, b) => b.ts - a.ts)
			.slice(0, 100) // for now we're only getting the latest 100 tasks, but a better solution here is to only pass in 3 for recent task history, and then get the full task history on demand when going to the task history view (maybe with pagination?)

		const latestAnnouncementId = getLatestAnnouncementId()
		const shouldShowAnnouncement = lastShownAnnouncementId !== latestAnnouncementId
		const platform = process.platform as Platform
		const distinctId = getDistinctId()
		const version = ExtensionRegistryInfo.version
		const environment = AiHydroEnv.config().environment

		return {
			version,
			apiConfiguration,
			currentTaskItem,
			aihydroMessages,
			studyBinding,
			currentFocusChainChecklist: this.task?.taskState.currentFocusChainChecklist || null,
			checkpointManagerErrorMessage,
			autoApprovalSettings,
			browserSettings,
			focusChainSettings,
			preferredLanguage,
			openaiReasoningEffort,
			mode,
			strictPlanModeEnabled,
			yoloModeToggled,
			useAutoCondense,
			mcpMarketplaceEnabled,
			mcpDisplayMode,
			telemetrySetting,
			planActSeparateModelsSetting,
			enableCheckpointsSetting: enableCheckpointsSetting ?? true,
			platform,
			environment,
			distinctId,
			globalAiHydroRulesToggles: globalAiHydroRulesToggles || {},
			localAiHydroRulesToggles: localAiHydroRulesToggles || {},
			localWindsurfRulesToggles: localWindsurfRulesToggles || {},
			localCursorRulesToggles: localCursorRulesToggles || {},
			localWorkflowToggles: workflowToggles || {},
			globalWorkflowToggles: globalWorkflowToggles || {},
			shellIntegrationTimeout,
			terminalReuseEnabled,
			vscodeTerminalExecutionMode: vscodeTerminalExecutionMode,
			defaultTerminalProfile,
			isNewUser,
			welcomeViewCompleted: welcomeViewCompleted as boolean, // Can be undefined but is set to either true or false by the migration that runs on extension launch in extension.ts
			mcpResponsesCollapsed,
			terminalOutputLineLimit,
			maxConsecutiveMistakes,
			customPrompt,
			taskHistory: processedTaskHistory,
			shouldShowAnnouncement,
			favoritedModelIds,
			autoCondenseThreshold,
			backgroundCommandRunning: this.backgroundCommandRunning,
			backgroundCommandTaskId: this.backgroundCommandTaskId,
			// NEW: Add workspace information
			workspaceRoots: this.workspaceManager?.getRoots() ?? [],
			primaryRootIndex: this.workspaceManager?.getPrimaryIndex() ?? 0,
			isMultiRootWorkspace: (this.workspaceManager?.getRoots().length ?? 0) > 1,
			multiRootSetting: {
				user: this.stateManager.getGlobalStateKey("multiRootEnabled"),
				featureFlag: true, // Multi-root workspace is now always enabled
			},
			hooksEnabled: {
				user: this.stateManager.getGlobalStateKey("hooksEnabled"),
				featureFlag: featureFlagsService.getHooksEnabled(),
			},
			lastDismissedInfoBannerVersion,
			lastDismissedModelBannerVersion,
			remoteConfigSettings: this.stateManager.getRemoteConfigSettings(),
			subagentsEnabled,
			finalAnswerAuditEnabled,
			transcriptDetail,
			protectedRoots: getHostProtectedRoots(),
			finalAnswerAuditGate,
			autoTitle,
			titleModel,
			workspaceHtmlFiles: this.workspaceHtmlFiles.map((f) => ({
				path: f.relativePath,
				name: f.name,
			})),
			htmlPreviewVersion: this.htmlPreviewVersion,
			htmlPreviewActiveId: this.htmlPreviewActiveId,
			htmlPreviewActivationSeq: this.htmlPreviewActivationSeq,
		}
	}

	async clearTask() {
		if (this.task) {
			// Clear task settings cache when task ends
			await this.stateManager.clearTaskSettings()
		}
		await this.task?.abortTask()
		clearPending() // cancel and new task: nothing is waiting on the user any more
		this.task = undefined // removes reference to it, so once promises end it will be garbage collected
		this.studyBinding = undefined
		this.chatProject = undefined
	}

	// Caching mechanism to keep track of webview messages + API conversation history per provider instance

	/*
	Now that we use retainContextWhenHidden, we don't have to store a cache of aihydro messages in the user's state, but we could to reduce memory footprint in long conversations.

	- We have to be careful of what state is shared between AiHydroProvider instances since there could be multiple instances of the extension running at once. For example when we cached cline messages using the same key, two instances of the extension could end up using the same key and overwriting each other's messages.
	- Some state does need to be shared between the instances, i.e. the API key--however there doesn't seem to be a good way to notify the other instances that the API key has changed.

	We need to use a unique identifier for each AiHydroProvider instance's message cache since we could be running several instances of the extension outside of just the sidebar i.e. in editor panels.

	// conversation history to send in API requests

	/*
	It seems that some API messages do not comply with vscode state requirements. Either the Anthropic library is manipulating these values somehow in the backend in a way that's creating cyclic references, or the API returns a function or a Symbol as part of the message content.
	VSCode docs about state: "The value must be JSON-stringifyable ... value — A value. MUST not contain cyclic references."
	For now we'll store the conversation history in memory, and if we need to store in state directly we'd need to do a manual conversion to ensure proper json stringification.
	*/

	/**
	 * The task loop's save: loop-owned fields merge over the stored item (historyPatch.ts), so user and binding
	 * fields written in between are kept. Other writers use `patchTaskHistory` with their own writer name.
	 */
	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		// The project is a creation field: the first value stored wins, so a later save never moves the chat.
		const withProject =
			this.chatProject?.projectId && this.task?.taskId === item.id && this.chatProject.chatId === item.ulid
				? { ...item, projectId: this.chatProject.projectId }
				: item
		const history = this.patchTaskHistory(item.id, withProject, "loop")
		const pending = this.pendingStudyMirror
		if (pending && (pending.taskId === item.id || (!pending.taskId && item.ulid === pending.ulid))) {
			this.pendingStudyMirror = undefined
			return this.patchTaskHistory(item.id, { activeStudyId: pending.studyId }, "binding")
		}
		return history
	}

	/**
	 * The single write path for `HistoryItem`. Read-modify-write is synchronous (no await between the read and the
	 * set), so concurrent callers cannot interleave and lose each other's fields.
	 */
	patchTaskHistory(id: string, patch: Partial<HistoryItem>, writer: HistoryWriter): HistoryItem[] {
		const history = this.stateManager.getGlobalStateKey("taskHistory") ?? []
		// A save that was in flight when its chat was deleted must not bring the chat back (DECISIONS 2026-10-28).
		if (this.deletedTaskIds.has(id) && !history.some((h) => h.id === id)) {
			return history
		}
		const { history: next } = patchHistory(history, { ...patch, id }, writer)
		this.stateManager.setGlobalState("taskHistory", next)
		return next
	}

	/** A user rename: persists across every later save (`titleSource: "user"`). */
	renameTaskHistory(id: string, title: string): HistoryItem[] {
		return this.patchTaskHistory(id, { title, titleSource: "user" }, "user")
	}

	// ---- Chat titles (X1-P2) ------------------------------------------------------------------------------------

	private _chatTitles: ChatTitleService | undefined

	/** The title service. Created on first use so a controller built without a window (tests) never needs it. */
	get chatTitles(): ChatTitleService {
		this._chatTitles ??= new ChatTitleService({
			getHistory: () => this.stateManager.getGlobalStateKey("taskHistory") ?? [],
			patch: (id, patch, writer) => {
				this.patchTaskHistory(id, patch as Partial<HistoryItem>, writer)
			},
			settings: () => ({
				autoTitle: this.stateManager.getGlobalSettingsKey("autoTitle") !== false,
				titleModel: this.stateManager.getGlobalSettingsKey("titleModel") ?? "",
			}),
			call: (system, user, signal) => this.callTitleModel(system, user, signal),
			loadExchange: async (item) =>
				exchangeFromMessages(
					this.task?.taskId === item.id
						? this.task.messageStateHandler.getAiHydroMessages()
						: await getSavedAiHydroMessages(item.id),
				),
			studyLabelFor: (item) =>
				this.studyBinding && this.studyBinding.chatId === item.ulid && this.studyBinding.status === "bound"
					? this.studyBinding.label
					: undefined,
			autoTitleWritten: () => this.noticeAutoTitle(),
			changed: () => {
				void this.postStateToWebview().catch(() => {})
			},
			backup: async () => {
				await backupHistoryOnce(await this.taskHistoryFile(), new Date(), "bak-pre-titles-")
			},
			log: (message) => console.warn(message),
		})
		return this._chatTitles
	}

	/**
	 * The first time a model writes a title: one non-modal notice saying who wrote it and how to turn it off. Shown once
	 * per profile (`titleNoticeShown`); "Turn off" sets `autoTitle` false.
	 */
	private noticeAutoTitle(): void {
		try {
			if (this.stateManager.getGlobalStateKey("titleNoticeShown")) {
				return
			}
			this.stateManager.setGlobalState("titleNoticeShown", true)
			HostProvider.window
				.showMessage({
					type: ShowMessageType.INFORMATION,
					message:
						'AI-Hydro named this chat using your chat model: the first message, the first reply (cut short) and tool names were sent to your model provider. Turn this off in Settings, Features, "Write chat titles with a model".',
					options: { items: ["Turn off"] },
				})
				.then((response) => {
					if (response?.selectedOption === "Turn off") {
						this.stateManager.setGlobalState("autoTitle", false)
						void this.postStateToWebview().catch(() => {})
					}
				})
				.catch(() => {})
		} catch {
			// No host window (a headless run): the notice is a courtesy.
		}
	}

	/** A user rename or reset (`RenameChat`). A reset starts one automatic title, because the user asked for it. */
	renameChat(id: string, title: string, description?: string) {
		const result = this.chatTitles.rename(id, title, description)
		if (result.ok && result.reset) {
			void this.chatTitles.request(id, "reset")
		}
		return result
	}

	/** The live chat asks for its automatic title (after the first turn, and at the first completion). Never blocks. */
	requestChatTitle(trigger: "first_turn" | "completion"): void {
		const id = this.task?.taskId
		if (id) {
			void this.chatTitles.request(id, trigger)
		}
	}

	/** M2, once per extension host: a deterministic title for every earlier chat that has none. No model, no network. */
	private static titleMigrationStarted = false
	startTitleMigration(): void {
		if (Controller.titleMigrationStarted) {
			return
		}
		Controller.titleMigrationStarted = true
		// A moment after activation, so it never competes with startup.
		const timer = setTimeout(() => {
			void this.chatTitles.ensureFallbackTitles().catch((error) => console.error("[titles] M2 failed:", error))
		}, TITLE_MIGRATION_DELAY_MS)
		timer.unref?.()
	}

	/**
	 * One cheap model call for a title: the chat's provider, the configured `titleModel` if any, no tools, the reply
	 * read only as far as a title needs. Stops at once when `signal` aborts. Throws on any error (the caller falls back).
	 */
	private async callTitleModel(system: string, user: string, signal: AbortSignal): Promise<string> {
		const mode = this.stateManager.getGlobalSettingsKey("mode")
		const config = withTitleModel(
			this.stateManager.getApiConfiguration(),
			mode,
			this.stateManager.getGlobalSettingsKey("titleModel"),
		)
		const handler = buildApiHandler(config, mode)
		const iterator = handler.createMessage(system, [{ role: "user", content: user }])[Symbol.asyncIterator]()
		const aborted = new Promise<never>((_, reject) => {
			const stop = () => reject(new Error("title call cancelled"))
			if (signal.aborted) {
				stop()
			}
			signal.addEventListener("abort", stop, { once: true })
		})
		aborted.catch(() => {})
		let text = ""
		try {
			while (text.length < TITLE_REPLY_CHAR_CAP) {
				const next = await Promise.race([iterator.next(), aborted])
				if (next.done) {
					break
				}
				if (next.value.type === "text") {
					text += next.value.text
				}
			}
		} finally {
			// Closes the stream, which ends the request for the providers that tie it to the generator.
			void Promise.resolve(iterator.return?.(undefined)).catch(() => {})
		}
		return text
	}

	// ---- Projects on chats (X1-P1) --------------------------------------------------------------------------

	/** The chat's project, once known. `note` says why there is none (shown on the chip; never blocks the chat). */
	private chatProject: { chatId: string; projectId?: string; title?: string; note?: string } | undefined
	/** Overridable in tests. */
	projectBudgetMs = LAUNCH_PROJECT_BUDGET_MS
	projectRetryMs = 3_000

	/** The project id to send as `_meta.project_id` for this chat, or undefined (older server, not yet created). */
	getChatProjectId(chatId: string): string | undefined {
		return this.chatProject?.chatId === chatId ? this.chatProject.projectId : undefined
	}

	/**
	 * Decide the chat's project. A resumed chat keeps the one stored on its history item (immutable); an item with none
	 * stays without one rather than being guessed from today's folder (M1 places those). A new chat asks the server
	 * for the project of its workspace folder, within a short budget. Never throws.
	 */
	private async resolveChatProject(chatUlid: string, cwd: string, historyItem: HistoryItem | undefined): Promise<void> {
		if (historyItem) {
			this.chatProject = { chatId: chatUlid, projectId: historyItem.projectId }
			return
		}
		try {
			const workspace = await this.bindingWorkspace(cwd)
			if (!workspace) {
				this.chatProject = { chatId: chatUlid, note: "No folder is open, so this chat has no project." }
				return
			}
			let timer: ReturnType<typeof setTimeout> | undefined
			const result = await Promise.race([
				ensureProject(this.bindingHub, workspace, chatUlid),
				new Promise<EnsureProjectResult>((resolve) => {
					timer = setTimeout(
						() =>
							resolve({
								ok: false,
								code: "FAILED",
								reason: "The AI-Hydro server did not answer in time, so this chat has no project yet. Retrying.",
							}),
						this.projectBudgetMs,
					)
				}),
			]).finally(() => timer && clearTimeout(timer))
			this.applyProjectResult(chatUlid, result)
			if (!result.ok && result.code !== "OLD_SERVER") {
				this.scheduleProjectRetry(chatUlid, workspace, 1)
			}
		} catch (error) {
			this.chatProject = { chatId: chatUlid, note: error instanceof Error ? error.message : String(error) }
		}
	}

	private applyProjectResult(chatUlid: string, result: EnsureProjectResult): void {
		this.chatProject = result.ok
			? { chatId: chatUlid, projectId: result.projectId, title: result.title }
			: { chatId: chatUlid, note: result.reason }
		if (!result.ok) {
			console.warn(`[projects] chat ${chatUlid} has no project: ${result.reason}`)
		}
	}

	/** The server was not ready at launch (still starting): try again a few times, then stay without a project. */
	private scheduleProjectRetry(chatUlid: string, workspace: string, attempt: number): void {
		if (attempt > PROJECT_RETRY_MAX) {
			return
		}
		const timer = setTimeout(async () => {
			if (this.task?.ulid !== chatUlid || this.chatProject?.projectId) {
				return
			}
			const result = await ensureProject(this.bindingHub, workspace, chatUlid)
			if (this.task?.ulid !== chatUlid) {
				return
			}
			this.applyProjectResult(chatUlid, result)
			if (result.ok) {
				// Store it when the chat's item exists; otherwise the first save picks it up (updateTaskHistory).
				const taskId = this.task.taskId
				if ((this.stateManager.getGlobalStateKey("taskHistory") ?? []).some((h) => h.id === taskId)) {
					this.patchTaskHistory(taskId, { projectId: result.projectId }, "loop")
				}
			} else if (result.code !== "OLD_SERVER") {
				this.scheduleProjectRetry(chatUlid, workspace, attempt + 1)
			}
			void this.postStateToWebview().catch(() => {})
		}, this.projectRetryMs)
		timer.unref?.()
	}

	// ---- M1: assign a project to earlier chats ------------------------------------------------------------------

	private static projectMigrationStarted = false

	/**
	 * Start the background migration once per extension host. The AI-Hydro server connects after activation, so this
	 * waits for it (bounded); with the server absent or older than 2.8.3 it does nothing and the next activation
	 * tries again. Idempotent: a second run finds nothing to assign and makes no server call.
	 */
	startProjectMigration(): void {
		if (Controller.projectMigrationStarted) {
			return
		}
		Controller.projectMigrationStarted = true
		let polls = 0
		const tick = async () => {
			polls++
			if (!findBindingServer(this.bindingHub)) {
				if (polls < MIGRATION_POLL_MAX) {
					const t = setTimeout(tick, MIGRATION_POLL_MS)
					t.unref?.()
				}
				return
			}
			try {
				await this.migrateHistoryToProjects()
			} catch (error) {
				console.error("[projects] migration failed:", error)
			}
		}
		const first = setTimeout(tick, MIGRATION_POLL_MS)
		first.unref?.()
	}

	/** Plan, ask the server for one project per folder, and store `projectId` on the chats it placed. */
	async migrateHistoryToProjects(): Promise<{ assigned: number; unsorted: number; failedFolders: number }> {
		const history = this.stateManager.getGlobalStateKey("taskHistory") ?? []
		const plan = await planProjectMigration(history, (dir) =>
			fs.stat(dir).then(
				(st) => st.isDirectory(),
				() => false,
			),
		)
		const unsorted = plan.noDir.length + plan.missingDir.length
		if (plan.byDir.length === 0) {
			return { assigned: 0, unsorted, failedFolders: 0 }
		}
		const result = await resolveProjects(plan, async (dir) => {
			const r = await ensureProject(this.bindingHub, dir)
			return r.ok ? { ok: true, projectId: r.projectId } : r
		})
		if (result.assignments.length === 0) {
			this.logMigrationFailures(result)
			return { assigned: 0, unsorted, failedFolders: result.failed.length }
		}
		// One backup before the first write, never overwritten. If it cannot be taken, nothing is written.
		let firstWrite = false
		try {
			firstWrite = (await backupHistoryOnce(await this.taskHistoryFile())).created
		} catch (error) {
			console.error("[projects] M1: could not back up taskHistory.json, so nothing was assigned:", error)
			return { assigned: 0, unsorted, failedFolders: result.failed.length }
		}
		// Only chats that still exist: a chat deleted in another window since the plan was made is not brought back
		// as a bare {id, projectId} row.
		const stillThere = new Set((this.stateManager.getGlobalStateKey("taskHistory") ?? []).map((h) => h.id))
		const applied = result.assignments.filter((a) => stillThere.has(a.itemId))
		for (const a of applied) {
			// Creation field, first value wins.
			this.patchTaskHistory(a.itemId, { projectId: a.projectId }, "system")
			// The open chat was just placed: it sends the project from its next call on.
			if (this.task?.taskId === a.itemId && !this.chatProject?.projectId) {
				this.chatProject = { chatId: this.task.ulid, projectId: a.projectId }
			}
		}
		this.logMigrationFailures(result)
		// The notice is shown by the run that took the backup (the first that wrote), so a second window stays quiet.
		if (applied.length > 0 && firstWrite) {
			try {
				HostProvider.window
					.showMessage({
						type: ShowMessageType.INFORMATION,
						message: describeMigration(plan, { ...result, assignments: applied }),
					})
					.catch(() => {})
			} catch {
				// No host window (a headless run): the notice is a courtesy, the assignments are already stored.
			}
		}
		if (applied.length > 0) {
			void this.postStateToWebview().catch(() => {})
		}
		return { assigned: applied.length, unsorted, failedFolders: result.failed.length }
	}

	/** Where the history is persisted (overridable in tests). */
	taskHistoryFile(): Promise<string> {
		return getTaskHistoryStateFilePath()
	}

	private logMigrationFailures(result: { failed: Array<{ folder: string; code: string }> }): void {
		if (result.failed.length > 0) {
			console.warn(
				`[projects] M1: ${result.failed.length} folder(s) not placed this time: ${result.failed.map((f) => `${f.folder} (${f.code})`).join(", ")}`,
			)
		}
	}

	// ---- Study binding (X0-2) -------------------------------------------------------------------------------

	/** The chat's binding as the chip and picker show it. Only ever set through `setStudyBinding`. */
	studyBinding: StudyBindingState | undefined
	private studyBindingRefreshing = false
	/** Overridable in tests. */
	launchBindingBudgetMs = LAUNCH_BINDING_BUDGET_MS
	launchBindingRecheckMs = 2_000
	/** A binding made before the chat's first save: mirrored into history once the item exists. */
	private pendingStudyMirror: { taskId?: string; ulid: string; studyId: string } | undefined

	private get bindingHub(): BindingHub {
		return this.mcpHub as unknown as BindingHub
	}

	private async bindingWorkspace(cwd?: string): Promise<string | undefined> {
		return await resolveWorkspaceRoot(cwd ?? this.workspaceManager?.getPrimaryRoot()?.path)
	}

	/** Bind (or resume the binding of) a chat that is starting. Never throws and never blocks a task for long. */
	private async bindChatAtLaunch(
		chatUlid: string,
		cwd: string,
		historyItem: HistoryItem | undefined,
		launch: ChatLaunch | undefined,
	) {
		try {
			// A hung server must not hold the task back: after the budget the chip says so, and the next tool result
			// re-reads the binding from the server (observeStudyBindingSignal).
			let timer: ReturnType<typeof setTimeout> | undefined
			const abort = { aborted: false }
			const state = await Promise.race([
				(async () =>
					resolveLaunchBinding({
						hub: this.bindingHub,
						chatId: chatUlid,
						workspace: await this.bindingWorkspace(cwd),
						hint: launch?.studyHint,
						resumeStudyId: historyItem?.activeStudyId,
						resuming: !!historyItem,
						projectId: this.chatProject?.chatId === chatUlid ? this.chatProject.projectId : undefined,
						abort,
					}))(),
				new Promise<StudyBindingState>((resolve) => {
					timer = setTimeout(() => {
						// No write (rebind) starts after this; one already in flight is picked up by the re-read below.
						abort.aborted = true
						resolve({
							chatId: chatUlid,
							status: "unavailable",
							reason: "The AI-Hydro server did not answer in time, so the study was not bound. Re-checking.",
							canChoose: false,
						})
					}, this.launchBindingBudgetMs)
				}),
			]).finally(() => timer && clearTimeout(timer))
			if (abort.aborted) {
				setTimeout(() => void this.refreshStudyBinding(), this.launchBindingRecheckMs)
			}
			this.setStudyBinding(state, historyItem?.id)
		} catch (error) {
			this.setStudyBinding(
				{
					chatId: chatUlid,
					status: "unavailable",
					reason: error instanceof Error ? error.message : String(error),
					canChoose: false,
				},
				historyItem?.id,
			)
		}
	}

	/** Set the chip state; a bound study is mirrored into the chat's history item (binding writer). */
	setStudyBinding(state: StudyBindingState, taskId?: string): void {
		this.studyBinding = state
		if (state.status === "bound" && state.studyId) {
			this.mirrorStudy(taskId ?? this.task?.taskId, state.chatId, state.studyId)
		}
		void this.postStateToWebview().catch(() => {})
	}

	private mirrorStudy(taskId: string | undefined, chatId: string, studyId: string): void {
		const history = this.stateManager.getGlobalStateKey("taskHistory") ?? []
		const item = taskId ? history.find((h) => h.id === taskId) : undefined
		if (item) {
			if (item.activeStudyId !== studyId) {
				this.patchTaskHistory(item.id, { activeStudyId: studyId }, "binding")
			}
			this.pendingStudyMirror = undefined
		} else {
			this.pendingStudyMirror = { taskId, ulid: chatId, studyId }
		}
	}

	/**
	 * Tool results carry the server's own account of a binding change (`session_binding`) or of a failed resolution
	 * (an error code with labelled candidates). No tool name is consulted: only the shape of the result.
	 */
	observeStudyBindingSignal(serverName: string, resultText: string): void {
		const task = this.task
		// Only the trusted, connected first-party server may change what the chip says or what history mirrors: a
		// server that merely carries the name is ignored.
		if (!task || findBindingServer(this.bindingHub)?.name !== serverName) {
			return
		}
		const chatId = task.ulid
		const canChoose = this.studyBinding?.canChoose ?? false
		const signal = parseBindingSignal(resultText)
		if (signal?.kind === "binding") {
			if (signal.binding.chatId !== chatId) {
				return
			}
			this.setStudyBinding({
				chatId,
				status: "bound",
				studyId: signal.binding.studyId,
				label: signal.binding.label,
				reason: signal.binding.previousStudyId
					? `Changed from ${signal.binding.previousStudyId}.`
					: "Bound by the agent's last call.",
				by: "agent",
				canChoose,
			})
		} else if (signal?.kind === "skipped") {
			if (this.studyBinding) {
				this.setStudyBinding({ ...this.studyBinding, reason: signal.message })
			}
		} else if (signal?.kind === "unresolved") {
			const current = this.studyBinding?.chatId === chatId ? this.studyBinding : undefined
			if (current?.studyId) {
				// A known binding is never dropped by one call's failure: keep the study, show the error.
				this.setStudyBinding({
					...current,
					status: "bound",
					candidates: undefined,
					reason: `A tool call could not resolve a study: ${signal.message ?? "unresolved"}. This chat stays bound to ${current.studyId}.`,
				})
			} else {
				this.setStudyBinding({
					chatId,
					status: signal.candidates.length > 0 ? "choose" : "none",
					candidates: signal.candidates,
					reason:
						signal.candidates.length > 0
							? "A tool could not tell which study this chat is about. Pick one."
							: "No study is bound to this chat.",
					canChoose,
				})
			}
		} else if (this.studyBinding?.status !== "bound") {
			// An older server reports no binding change: ask it, so the chip still follows the agent's own binding.
			void this.refreshStudyBinding()
		}
	}

	/** Ask the server what this chat is bound to (the audit's channel) and show it. */
	async refreshStudyBinding(): Promise<void> {
		const task = this.task
		if (!task || this.studyBindingRefreshing) {
			return
		}
		this.studyBindingRefreshing = true
		try {
			const server = findBindingServer(this.bindingHub)
			if (!server) {
				return
			}
			const status: ChatStatus | undefined = await chatStatus(
				this.bindingHub,
				server,
				task.ulid,
				await this.bindingWorkspace(),
				undefined,
				this.getChatProjectId(task.ulid),
			)
			if (this.task !== task) {
				return
			}
			if (status?.bound && status.studyId && this.studyBinding?.studyId !== status.studyId) {
				this.setStudyBinding({
					chatId: task.ulid,
					status: "bound",
					studyId: status.studyId,
					label: this.studyBinding?.candidates?.find((c) => c.studyId === status.studyId)?.label,
					reason: "Bound to this chat.",
					by: "server",
					canChoose: this.studyBinding?.canChoose ?? false,
				})
			}
		} finally {
			this.studyBindingRefreshing = false
		}
	}

	/** The chip was opened: list the studies to pick from (labelled by the server) and show the picker. */
	async openStudyPicker(): Promise<void> {
		const task = this.task
		if (!task) {
			return
		}
		const current = this.studyBinding?.chatId === task.ulid ? this.studyBinding : undefined
		try {
			const caps = findBindingServer(this.bindingHub)
			const canChoose = caps ? (await readCapabilities(this.bindingHub, caps)).has("binding.v2") : false
			if (!canChoose) {
				this.setStudyBinding({
					chatId: task.ulid,
					status: current?.status === "bound" ? "bound" : "unavailable",
					studyId: current?.studyId,
					label: current?.label,
					reason: "This AI-Hydro server version cannot switch the study from here. Update aihydro-tools.",
					canChoose: false,
				})
				return
			}
			const candidates = await candidatesForPicker(
				this.bindingHub,
				await this.bindingWorkspace(),
				this.getChatProjectId(task.ulid),
			)
			this.setStudyBinding({
				chatId: task.ulid,
				status: "choose",
				studyId: current?.studyId,
				label: current?.label,
				candidates,
				reason: current?.studyId ? "Switch this chat to another study." : "Pick the study this chat is about.",
				by: current?.by,
				canChoose: true,
			})
		} catch (error) {
			this.setStudyBinding({
				chatId: task.ulid,
				status: current?.status === "bound" ? "bound" : "unavailable",
				studyId: current?.studyId,
				label: current?.label,
				reason: `Could not list studies: ${error instanceof Error ? error.message : String(error)}`,
				canChoose: false,
			})
		}
	}

	/** The user chose a study in the picker: bind once, then show it. A refusal keeps the picker open with the reason. */
	async chooseStudy(studyId: string): Promise<void> {
		const task = this.task
		const current = this.studyBinding
		if (!task || !current || current.chatId !== task.ulid || !current.candidates?.some((c) => c.studyId === studyId)) {
			return // only a study that was offered can be chosen
		}
		const server = findBindingServer(this.bindingHub)
		const result = server
			? await rebindChat(
					this.bindingHub,
					server,
					task.ulid,
					studyId,
					await this.bindingWorkspace(),
					undefined,
					this.getChatProjectId(task.ulid),
				)
			: ({ ok: false, code: "NO_SERVER", message: "The AI-Hydro server is not connected." } as const)
		if (this.task !== task) {
			return
		}
		if (result.ok) {
			this.setStudyBinding({
				chatId: task.ulid,
				status: "bound",
				studyId: result.studyId,
				label: current.candidates.find((c) => c.studyId === studyId)?.label,
				reason: "Chosen by you.",
				by: "user",
				canChoose: current.canChoose,
			})
		} else {
			this.setStudyBinding({ ...current, reason: `Could not bind: ${result.message}` })
		}
	}

	/** Dismiss the picker without binding ("No study", or "New study" which the next delineation creates). */
	declineStudyChoice(kind: "none" | "new"): void {
		const task = this.task
		if (!task || !this.studyBinding || this.studyBinding.chatId !== task.ulid) {
			return
		}
		if (this.studyBinding.studyId) {
			// Closing the picker over a bound chat (switch mode) keeps the binding.
			this.setStudyBinding({ ...this.studyBinding, status: "bound", candidates: undefined, reason: "Bound to this chat." })
			return
		}
		this.setStudyBinding({
			chatId: task.ulid,
			status: "none",
			reason:
				kind === "new"
					? "Not bound by you. A delineation creates a new study; the server may still resolve one."
					: "Not bound by you; the server may still resolve a study.",
			canChoose: this.studyBinding.canChoose,
		})
		// The server is the authority: show what it says now.
		void this.refreshStudyBinding()
	}

	// Map layer management methods

	/**
	 * Add or update a map layer
	 * @param layer The layer to add/update
	 */
	addMapLayer(layer: MapLayer): void {
		console.log(`[Controller] Adding map layer: ${layer.id}`)
		const op = layer.metadata?.__operation
		if (op === "remove") {
			this.removeMapLayer(layer.id)
			return
		}
		if (op === "clear") {
			this.clearMapLayers()
			return
		}
		this.mapLayers.set(layer.id, layer)
		if (!this.mapLayerOrder.includes(layer.id)) {
			this.mapLayerOrder.push(layer.id)
		}
		this.notifyMapLayerSubscribers(layer)
		void this.syncMapLayerCatalog()
	}

	/**
	 * Update an existing layer's style/metadata without replacing geojson.
	 */
	updateMapLayer(layerId: string, patch: MapLayerPatch): MapLayer | undefined {
		const existing = this.mapLayers.get(layerId)
		if (!existing) {
			return undefined
		}
		const merged = mergeMapLayerPatch(existing, patch)
		this.mapLayers.set(layerId, merged)
		this.notifyMapLayerSubscribers(merged)
		void this.syncMapLayerCatalog()
		return merged
	}

	/** Workspace folder that scopes the persisted layer catalog ("" when no folder is open). */
	private currentMapScope(): string {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ""
	}

	private async syncMapLayerCatalog(): Promise<void> {
		// Never rewrite the catalog before startup restore has read it: the rewrite would drop what it has not loaded.
		await this.mapHydration
		const catalog = await buildMapLayerCatalogAsync(
			this.getMapLayers(),
			this.mapLayerOrder,
			this.currentMapScope(),
			this.mapOverflowEntries,
		)
		await persistMapLayerCatalog(catalog)
	}

	/** Entries beyond the restore cap (set by startup hydration). They stay in the catalog file. */
	setMapOverflowEntries(entries: MapLayerCatalogEntry[]): void {
		this.mapOverflowEntries = entries
	}

	getMapRestoreState(): { hydrating: boolean; olderCount: number } {
		return { hydrating: this.mapHydrating, olderCount: this.mapOverflowEntries.length }
	}

	/** Tells map subscribers whether restore is still running and how many older layers are kept but not loaded. */
	private emitMapRestoreState(): void {
		const state = this.getMapRestoreState()
		this.notifyMapLayerSubscribers(
			MapLayer.create({
				id: "__map_restore__",
				visible: false,
				metadata: {
					__operation: "restore_state",
					hydrating: state.hydrating ? "1" : "0",
					older_count: String(state.olderCount),
				},
			}),
		)
	}

	/** Loads the layers kept beyond the restore cap, placing them before the current layers. Returns how many loaded. */
	async restoreOlderMapLayers(): Promise<number> {
		await this.mapHydration
		const entries = this.mapOverflowEntries
		if (entries.length === 0) {
			return 0
		}
		this.mapOverflowEntries = []
		const { restoreCatalogEntries } = await import("@core/map/hydrateMapLayers")
		const added = await restoreCatalogEntries(this, entries, entries.length + this.mapLayers.size)
		const addedSet = new Set(added)
		this.mapLayerOrder = [...added, ...this.mapLayerOrder.filter((id) => !addedSet.has(id))]
		this.emitMapRestoreState()
		void this.syncMapLayerCatalog()
		return added.length
	}

	private notifyMapLayerSubscribers(layer: MapLayer): void {
		const payload = sanitizeMapLayerForWebview(layer)
		this.mapLayerSubscribers.forEach((subscriber) => {
			try {
				subscriber(payload)
			} catch (error) {
				console.error("[Controller] Error notifying layer subscriber:", error)
			}
		})
	}

	/**
	 * Remove a map layer
	 * @param layerId The ID of the layer to remove
	 */
	removeMapLayer(layerId: string): void {
		console.log(`[Controller] Removing map layer: ${layerId}`)

		const wasRemoved = this.mapLayers.delete(layerId)
		if (!wasRemoved) {
			return
		}
		this.mapLayerOrder = this.mapLayerOrder.filter((id) => id !== layerId)

		this.notifyMapLayerSubscribers(
			MapLayer.create({
				id: layerId,
				metadata: { __operation: "remove" },
				visible: false,
			}),
		)
		void this.syncMapLayerCatalog()
	}

	/**
	 * Clear all map layers
	 */
	clearMapLayers(): void {
		console.log("[Controller] Clearing all map layers")

		if (this.mapLayers.size === 0) {
			return
		}

		this.mapLayers.clear()
		this.mapLayerOrder = []
		void this.syncMapLayerCatalog()
		this.notifyMapLayerSubscribers(
			MapLayer.create({
				id: `__map_event_clear_${Date.now()}`,
				metadata: { __operation: "clear" },
				visible: false,
			}),
		)
	}

	getMapLayerOrder(): string[] {
		return [...this.mapLayerOrder]
	}

	/**
	 * Get all map layers
	 * @returns Array of all current map layers
	 */
	getMapLayers(): MapLayer[] {
		return Array.from(this.mapLayers.values())
	}

	/**
	 * Subscribe to map layer updates
	 * @param callback Function to call when a layer is added/updated
	 * @returns Unsubscribe function
	 */
	subscribeToMapLayerUpdates(callback: (layer: MapLayer) => void): () => void {
		console.log("[Controller] New layer subscription added")
		this.mapLayerSubscribers.add(callback)

		// Return unsubscribe function
		return () => {
			console.log("[Controller] Layer subscription removed")
			this.mapLayerSubscribers.delete(callback)
		}
	}

	// ─── Ledger / claims management ─────────────────────────────────────────

	/**
	 * Called by LedgerEventWatcher when a claim event arrives from the MCP server.
	 * Broadcasts the update to all subscribeToClaimUpdates() streaming subscribers.
	 */
	notifyClaimUpdate(update: ClaimUpdate): void {
		for (const cb of this.claimUpdateSubscribers) {
			try {
				cb(update)
			} catch (err) {
				console.error("[Controller] claimUpdateSubscribers callback error:", err)
			}
		}
	}

	/**
	 * Subscribe to claim updates from the MCP ledger.
	 * @returns Unsubscribe function.
	 */
	subscribeToClaimUpdates(callback: (update: ClaimUpdate) => void): () => void {
		this.claimUpdateSubscribers.add(callback)
		return () => {
			this.claimUpdateSubscribers.delete(callback)
		}
	}

	/** Refresh workspace root used for ROI persistence. */
	async refreshMapSessionWorkspaceRoot(): Promise<void> {
		await this.mapSessionService.initialize()
		const cwd = this.workspaceManager?.getPrimaryRoot()?.path || (await getCwd(getDesktopDir()))
		this.mapSessionService.setWorkspaceRoot(cwd)
	}

	// ─── HTML Preview management ─────────────────────────────────────────
	//
	// All artifact bookkeeping (file IO, hashing, mode detection) lives in
	// `htmlPreviewService`. The controller is responsible for translating
	// `ArtifactRef`s into the over-the-wire `HtmlPreviewItem` shape (with
	// the webview URI populated) and notifying subscribers.

	getArtifactPreviewService(): ArtifactPreviewService {
		return this.htmlPreviewService
	}

	getArtifactKernelService(): ArtifactKernelService {
		return this.artifactKernelService
	}

	/**
	 * Build a wire-format `HtmlPreviewItem` for an artifact. The webview URI
	 * is resolved through `VscodeHtmlPreviewProvider` so it matches the
	 * panel that's actually rendering the iframe; if no panel is open yet,
	 * we fall back to empty strings — the URI is recomputed and re-streamed
	 * the next time the panel is opened.
	 */
	toHtmlPreviewItem(ref: ArtifactRef): HtmlPreviewItem {
		// Lazy import to avoid a circular module dependency.
		const { VscodeHtmlPreviewProvider } = require("@/hosts/vscode/VscodeHtmlPreviewProvider") as {
			VscodeHtmlPreviewProvider: {
				getArtifactWebviewUri: (r: ArtifactRef) => { src: string; dir: string }
			}
		}
		const { src, dir } = VscodeHtmlPreviewProvider.getArtifactWebviewUri(ref)
		// Ship HTML inline so the iframe can use `srcdoc` (same-origin with
		// the parent webview, our CSP applies). Above the UTF-8 byte cap we
		// skip the inline copy and fall back to `webviewUri`.
		const inlineHtml = shouldInlineHtml(ref.byteLength) ? ref.html : ""
		return HtmlPreviewItem.create({
			id: ref.id,
			title: ref.title,
			htmlContent: inlineHtml,
			filePath: ref.fsPath,
			interactive: ref.mode === "interactive",
			// Trust keys are written last so nothing carried in `ref.metadata` can
			// spoof them. The webview only displays them; the host enforces.
			metadata: {
				...ref.metadata,
				byteLength: String(ref.byteLength),
				[ARTIFACT_TRUST_METADATA_KEYS.source]: ref.trustSource,
				[ARTIFACT_TRUST_METADATA_KEYS.allowed]: this.htmlPreviewService.canExecute(ref.id) ? "true" : "false",
			},
			webviewUri: src,
			dirUri: dir,
			contentHash: ref.contentHash,
			resolvedMode: ref.mode === "interactive" ? HtmlPreviewMode.INTERACTIVE : HtmlPreviewMode.SAFE,
		})
	}

	/**
	 * Allow or revoke execution for one document, push the updated item to the
	 * webview (so the badge and the injected bridge follow the real state), and
	 * stop the document's kernel on revoke. Returns whether execution is allowed.
	 */
	setArtifactExecutionAllowed(id: string, allowed: boolean): boolean {
		const resulting = this.htmlPreviewService.setExecutionAllowed(id, allowed)
		const ref = this.htmlPreviewService.get(id)
		if (!resulting) {
			this.artifactKernelService.stopSessionsForArtifact(id)
			this.artifactKernelService.stopSharedSessions()
		}
		if (ref) {
			this.htmlPreviewVersion++
			this.notifyHtmlPreviewSubscribers(this.toHtmlPreviewItem(ref))
			void this.postStateToWebview()
		}
		return resulting
	}

	/**
	 * @deprecated Prefer `htmlPreviewService.registerFile` /
	 * `registerInline`. This shim exists for backward compatibility with the
	 * old `addHtmlPreview` flow used by `previewHtml`.
	 */
	addHtmlPreview(ref: ArtifactRef): void {
		console.log(`[Controller] Adding HTML preview: ${ref.id}`)
		// The service already stored it; we just need to update the
		// active-id pointer + notify streaming subscribers + push state.
		this.htmlPreviewActiveId = ref.id
		this.htmlPreviewActivationSeq++
		this.htmlPreviewVersion++
		const item = this.toHtmlPreviewItem(ref)
		this.notifyHtmlPreviewSubscribers(item)
		void this.postStateToWebview()
	}

	/**
	 * Re-send every registered preview to the current subscribers and re-post state. Used when a
	 * freshly (re)loaded Studio shell reports it is ready, to cover replies that were posted while
	 * the previous document was being replaced.
	 */
	republishHtmlPreviews(): void {
		for (const item of this.getHtmlPreviews()) {
			this.notifyHtmlPreviewSubscribers(item)
		}
		void this.postStateToWebview()
	}

	private notifyHtmlPreviewSubscribers(item: HtmlPreviewItem): void {
		this.htmlPreviewSubscribers.forEach((subscriber) => {
			try {
				subscriber(item)
			} catch (error) {
				console.error("[Controller] Error notifying HTML preview subscriber:", error)
			}
		})
	}

	/**
	 * Pluggable resolver so host-specific code (VscodeHtmlPreviewProvider) can
	 * teach the controller how to map VS Code file IDs → canonical module IDs.
	 * Registered in VscodeHtmlPreviewProvider.initialize().
	 */
	private _moduleIdResolver: ((fileId: string) => string) | null = null

	registerModuleIdResolver(resolver: (fileId: string) => string): void {
		this._moduleIdResolver = resolver
	}

	resolvePreviewModuleId(id: string): string {
		return this._moduleIdResolver?.(id) ?? id
	}

	removeHtmlPreview(id: string): void {
		console.log(`[Controller] Removing HTML preview: ${id}`)
		this.artifactKernelService.stopSessionsForArtifact(id)
		const removed = this.htmlPreviewService.remove(id)
		if (!removed) return
		this.htmlPreviewVersion++
		if (this.htmlPreviewActiveId === id) {
			const remaining = this.htmlPreviewService.list()
			this.htmlPreviewActiveId = remaining.length > 0 ? remaining[remaining.length - 1].id : null
		}
		this.notifyHtmlPreviewSubscribers(HtmlPreviewItem.create({ id, metadata: { __operation: "remove" } }))
		void this.postStateToWebview()
		// Clear the preview session so `preview_list_modules` stops reporting a
		// module once its tab is closed.  Use the pluggable resolver so the host
		// can translate VS Code file IDs → manifest module IDs without a circular
		// import between the controller and VscodeHtmlPreviewProvider.
		const resolvedModuleId = this.resolvePreviewModuleId(id)
		this.previewSessionService.clearModule(resolvedModuleId)
		if (resolvedModuleId !== id) {
			this.previewSessionService.cleanupDiskFiles(id)
		}
	}

	clearHtmlPreviews(): void {
		console.log("[Controller] Clearing all HTML previews")
		if (this.htmlPreviewService.list().length === 0) return
		for (const ref of this.htmlPreviewService.list()) {
			this.artifactKernelService.stopSessionsForArtifact(ref.id)
		}
		this.htmlPreviewService.clear()
		this.previewSessionService.clearAll()
		this.htmlPreviewVersion++
		this.htmlPreviewActiveId = null
		this.notifyHtmlPreviewSubscribers(
			HtmlPreviewItem.create({
				id: `__html_preview_clear_${Date.now()}`,
				metadata: { __operation: "clear" },
			}),
		)
		void this.postStateToWebview()
	}

	getHtmlPreviews(): HtmlPreviewItem[] {
		return this.htmlPreviewService.list().map((ref) => this.toHtmlPreviewItem(ref))
	}

	subscribeToHtmlPreviewUpdates(callback: (item: HtmlPreviewItem) => void): () => void {
		console.log("[Controller] New HTML preview subscription added")
		this.htmlPreviewSubscribers.add(callback)
		return () => {
			console.log("[Controller] HTML preview subscription removed")
			this.htmlPreviewSubscribers.delete(callback)
		}
	}

	/**
	 * Service event handler — bound once in the constructor.
	 *
	 * Note: file-registration and inline-registration paths already call
	 * `addHtmlPreview`/`removeHtmlPreview`/`clearHtmlPreviews` themselves
	 * to update version/active-id atomically. This handler is reserved for
	 * future service-driven changes (e.g. file watcher) so the wiring is
	 * in place without duplicating state-update work today.
	 */
	private onArtifactChange = (_change: { kind: string; ref?: ArtifactRef }): void => {
		// Reserved for future use (e.g. external file watcher updates).
	}

	// Workspace GeoJSON file scanner methods

	/**
	 * Initialize the workspace GeoJSON file scanner
	 */
	private async initializeFileScanner(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			console.log("[Controller] No workspace folders, skipping file scanner initialization")
			return
		}

		try {
			this.fileScanner = new FileScanner()
			await this.fileScanner.initialize(workspaceFolders)

			// Set up callback for file changes
			this.fileScanner.onFilesChanged((files) => {
				console.log(`[Controller] Workspace GeoJSON files updated: ${files.length} files`)
				this.workspaceGeoJsonFiles = files
			})

			// Store initial files
			this.workspaceGeoJsonFiles = this.fileScanner.getFiles()
			console.log(`[Controller] File scanner initialized with ${this.workspaceGeoJsonFiles.length} GeoJSON files`)
		} catch (error) {
			console.error("[Controller] Failed to initialize file scanner:", error)
		}
	}

	/**
	 * Get list of workspace GeoJSON files
	 */
	getWorkspaceGeoJsonFiles(): WorkspaceGeoJsonFile[] {
		return this.workspaceGeoJsonFiles
	}

	// ─── Workspace HTML file scanning ─────────────────────────────────────────

	/**
	 * Scan workspace for HTML files and set up a watcher
	 */
	private async scanWorkspaceHtmlFiles(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return
		}

		try {
			this.workspaceHtmlFiles = []
			for (const folder of workspaceFolders) {
				const pattern = new vscode.RelativePattern(folder, "**/*.{html,htm}")
				const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**")
				for (const uri of uris) {
					const relativePath = path.relative(folder.uri.fsPath, uri.fsPath)
					this.workspaceHtmlFiles.push({
						uri,
						relativePath,
						name: path.basename(uri.fsPath),
					})
				}
			}
			console.log(`[Controller] Found ${this.workspaceHtmlFiles.length} HTML files in workspace`)

			// Set up file watcher for HTML files
			this.htmlFileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{html,htm}")
			this.htmlFileWatcher.onDidCreate(async (uri) => {
				if (uri.fsPath.includes("node_modules")) {
					return
				}
				const folder = vscode.workspace.getWorkspaceFolder(uri)
				if (folder) {
					// Deduplicate: skip if already tracked
					if (this.workspaceHtmlFiles.some((f) => f.uri.toString() === uri.toString())) {
						return
					}
					this.workspaceHtmlFiles.push({
						uri,
						relativePath: path.relative(folder.uri.fsPath, uri.fsPath),
						name: path.basename(uri.fsPath),
					})
					console.log(`[Controller] HTML file created: ${uri.fsPath}`)
					await this.postStateToWebview()
				}
			})
			this.htmlFileWatcher.onDidDelete(async (uri) => {
				if (uri.fsPath.includes("node_modules")) {
					return
				}
				const beforeLen = this.workspaceHtmlFiles.length
				this.workspaceHtmlFiles = this.workspaceHtmlFiles.filter((f) => f.uri.toString() !== uri.toString())
				if (this.workspaceHtmlFiles.length !== beforeLen) {
					console.log(`[Controller] HTML file deleted: ${uri.fsPath}`)
					await this.postStateToWebview()
				}
			})
			this.htmlFileWatcher.onDidChange(async (uri) => {
				if (uri.fsPath.includes("node_modules")) {
					return
				}
				const folder = vscode.workspace.getWorkspaceFolder(uri)
				if (folder) {
					const idx = this.workspaceHtmlFiles.findIndex((f) => f.uri.toString() === uri.toString())
					if (idx >= 0) {
						this.workspaceHtmlFiles[idx] = {
							uri,
							relativePath: path.relative(folder.uri.fsPath, uri.fsPath),
							name: path.basename(uri.fsPath),
						}
						console.log(`[Controller] HTML file changed: ${uri.fsPath}`)
						await this.postStateToWebview()
					}
				}
			})
		} catch (error) {
			console.error("[Controller] Failed to scan workspace HTML files:", error)
		}
	}

	/**
	 * Get list of workspace HTML files
	 */
	getWorkspaceHtmlFiles(): Array<{ uri: vscode.Uri; relativePath: string; name: string }> {
		return this.workspaceHtmlFiles
	}

	/**
	 * Surface the workspace HTML file list to the webview without loading
	 * file contents. The previous behavior of pre-loading every HTML file
	 * into memory on panel open was wasteful (hundreds of KB per file × up
	 * to 20 files) and confused users by showing items as "loaded" before
	 * they had clicked anything. The new flow is fully on-demand: clicking
	 * a file in the sidebar calls `previewHtml` with `filePath`.
	 */
	async loadWorkspaceHtmlPreviews(): Promise<void> {
		console.log(`[Controller] ${this.workspaceHtmlFiles.length} workspace HTML files available (lazy-load on click)`)
		// Just refresh the state signal so the sidebar's file list re-renders.
		this.htmlPreviewVersion++
		await this.postStateToWebview()
	}

	/**
	 * Read GeoJSON content from a workspace file
	 */
	async readWorkspaceGeoJson(file: WorkspaceGeoJsonFile): Promise<string> {
		if (!this.fileScanner) {
			throw new Error("File scanner not initialized")
		}
		return await this.fileScanner.readGeoJson(file)
	}

	/**
	 * Manually refresh workspace GeoJSON files
	 */
	async refreshWorkspaceGeoJsonFiles(): Promise<void> {
		if (this.fileScanner) {
			await this.fileScanner.refresh()
			this.workspaceGeoJsonFiles = this.fileScanner.getFiles()
		}
	}

	/**
	 * Add ONE workspace geo file to the map as a visible layer (user-initiated, from the Layers panel).
	 * Returns the layer id. Throws when the file cannot be read or converted.
	 */
	private async addWorkspaceFileAsLayer(file: WorkspaceGeoJsonFile): Promise<string> {
		let geojsonContent: string
		let originalFormat = "geojson"

		// Check if file requires format conversion
		if (file.requiresConversion) {
			console.log(`[Controller] Converting ${file.extension} file: ${file.name}`)

			// Special handling for shapefiles - need to read companion files
			if (file.extension.toLowerCase() === ".shp") {
				// Shapefile requires .shp, .shx, and .dbf files
				const basePath = file.uri.fsPath.replace(/\.shp$/i, "")
				const shpPath = `${basePath}.shp`
				const shxPath = `${basePath}.shx`
				const dbfPath = `${basePath}.dbf`
				const prjPath = `${basePath}.prj`

				console.log(`[Controller] Reading shapefile components from: ${basePath}`)

				// Read all required files
				const shpBuffer = await fs.readFile(shpPath)
				const shxBuffer = await fs.readFile(shxPath)
				const dbfBuffer = await fs.readFile(dbfPath)

				// PRJ file is optional
				let prjContent: string | undefined
				try {
					prjContent = await fs.readFile(prjPath, "utf8")
				} catch (_error) {
					console.log(`[Controller] No .prj file found (optional)`)
				}

				// Combine into object for shpjs
				const shapefileData = {
					shp: shpBuffer,
					shx: shxBuffer,
					dbf: dbfBuffer,
					prj: prjContent,
				}

				// Convert using the combined data
				const conversionResult = await geoFormatConverter.convert(shapefileData as any, file.extension, {
					includeStyles: true,
				})

				geojsonContent = JSON.stringify(conversionResult.geojson)
				originalFormat = conversionResult.metadata.originalFormat

				console.log(
					`[Controller] Successfully converted shapefile to GeoJSON (${conversionResult.metadata.featureCount} features)`,
				)
			} else {
				// For other formats, determine if we need buffer or string
				const needsBuffer = [".fgb"].includes(file.extension.toLowerCase())

				// Read raw file content
				let rawContent: string | Buffer
				if (needsBuffer) {
					// Read as Buffer for binary formats (flatgeobuf)
					const fileBuffer = await fs.readFile(file.uri.fsPath)
					rawContent = fileBuffer
				} else {
					// Read as string for text formats (KML, GPX, TopoJSON)
					rawContent = await this.readWorkspaceGeoJson(file)
				}

				// Convert to GeoJSON
				try {
					const conversionResult = await geoFormatConverter.convert(rawContent, file.extension, {
						includeStyles: true,
					})

					geojsonContent = JSON.stringify(conversionResult.geojson)
					originalFormat = conversionResult.metadata.originalFormat

					console.log(
						`[Controller] Successfully converted ${file.extension} to GeoJSON (${conversionResult.metadata.featureCount} features)`,
					)
				} catch (conversionError) {
					if (conversionError instanceof GeoConversionError) {
						console.error(`[Controller] Conversion failed for ${file.name}:`, conversionError.message)
						throw conversionError
					}
					throw conversionError
				}
			}
		} else {
			// Already GeoJSON, read directly
			geojsonContent = await this.readWorkspaceGeoJson(file)
		}

		// Parse to validate
		const _geojson = JSON.parse(geojsonContent)

		// Generate layer ID from file path. In a multi-root workspace the folder is part of the identity, so the
		// same relative path in two folders yields two layers; single-folder ids are unchanged.
		const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1
		const idSource = multiRoot ? `${file.workspaceFolderName}/${file.relativePath}` : file.relativePath
		const layerId = `workspace_${idSource.replace(/[^a-zA-Z0-9]/g, "_")}`

		// Determine format icon for display
		const formatIcon = this.getFormatIcon(file.extension)

		// Create MapLayer with workspace metadata
		const layer = {
			id: layerId,
			name: file.name,
			layerType: "polygon" as const,
			geojson: geojsonContent,
			visible: true,
			style: {
				fillColor: "#0066CC",
				fillOpacity: 0.5,
				color: "#0066CC",
				strokeColor: "#0066CC",
				strokeWidth: 3,
				weight: 3,
				opacity: 1,
			},
			metadata: {
				source: "workspace",
				path: file.relativePath,
				workspace_folder: file.workspaceFolder,
				lastModified: file.lastModified.toString(),
				originalFormat,
				formatIcon,
			},
		}

		// Add layer to controller (this will notify subscribers)
		this.addMapLayer(layer)

		console.log(`[Controller] Added workspace layer: ${file.name} (${originalFormat})`)

		return layerId
	}

	/** Add a workspace file chosen by the user (by workspace-relative path) as a layer. */
	async addWorkspaceGeoFileByPath(relativePath: string, workspaceFolder = ""): Promise<string> {
		const matches = this.workspaceGeoJsonFiles.filter(
			(candidate) =>
				candidate.relativePath === relativePath && (!workspaceFolder || candidate.workspaceFolder === workspaceFolder),
		)
		if (matches.length === 0) {
			throw new Error(`Workspace file not found: ${relativePath}`)
		}
		if (matches.length > 1) {
			throw new Error(`${relativePath} exists in more than one workspace folder; choose one from the list.`)
		}
		const file = matches[0]
		// The list was checked when scanned; re-check so a symlink swapped in since then cannot escape the folder.
		if (!(await realPathInsideFolder(file.workspaceFolder, file.uri.fsPath))) {
			throw new Error(`${relativePath} resolves outside its workspace folder and was not added.`)
		}
		return await this.addWorkspaceFileAsLayer(file)
	}

	/**
	 * Load ALL workspace geo files as map layers. NOT called automatically: opening the map used to register every
	 * valid `*.json` in the workspace, which flooded the layer list (decision D3). The Layers panel lists the files
	 * instead and the user adds them one at a time via addWorkspaceGeoFileByPath.
	 */
	async loadWorkspaceGeoJsonLayers(): Promise<void> {
		console.log(`[Controller] Loading ${this.workspaceGeoJsonFiles.length} workspace geo data files as map layers`)

		for (const file of this.workspaceGeoJsonFiles) {
			try {
				await this.addWorkspaceFileAsLayer(file)
			} catch (error) {
				console.error(`[Controller] Failed to load workspace file ${file.relativePath}:`, error)
				// Continue with next file instead of stopping completely
			}
		}
	}

	/**
	 * Get display icon for geo data format
	 */
	private getFormatIcon(extension: string): string {
		const ext = extension.toLowerCase()
		switch (ext) {
			case ".kml":
				return "🗺️"
			case ".gpx":
				return "📍"
			case ".topojson":
			case ".topo.json":
				return "🗾"
			case ".fgb":
				return "📦"
			case ".shp":
				return "🔷"
			default:
				return "📁"
		}
	}
}
