// type that represents json data that is sent from extension to webview, called ExtensionMessage and has 'type' enum which can be 'plusButtonClicked' or 'settingsButtonClicked' or 'hello'

import { WorkspaceRoot } from "@shared/multi-root/types"
import { GlobalStateAndSettings } from "@shared/storage/state-keys"
import type { Environment } from "../config"
import { AiHydroFeatureSetting } from "./AiHydroFeatureSetting"
import { AutoApprovalSettings } from "./AutoApprovalSettings"
import type { CommandExit, CommandPolicyClass } from "./aihydro/commandEvidence"
import type { InfoNotice, McpNotificationLevel } from "./aihydro/infoNotice"
import { AiHydroRulesToggles } from "./aihydro-rules"
import { ApiConfiguration } from "./api"
import { BrowserSettings } from "./BrowserSettings"
import { FocusChainSettings } from "./FocusChainSettings"
import { HistoryItem } from "./HistoryItem"
import { McpDisplayMode } from "./McpDisplayMode"
import { Mode, OpenaiReasoningEffort } from "./storage/types"
import { TelemetrySetting } from "./TelemetrySetting"
// webview will hold state
export interface ExtensionMessage {
	type: "grpc_response" | "commandResult"
	grpc_response?: GrpcResponse
	commandResult?: CommandResult
}

export type CommandResult = {
	command: string
	ok: boolean
	message?: string
	[key: string]: unknown
}

export type GrpcResponse = {
	message?: any // JSON serialized protobuf message
	request_id: string // Same ID as the request
	error?: string // Optional error message
	is_streaming?: boolean // Whether this is part of a streaming response
	sequence_number?: number // For ordering chunks in streaming responses
}

export type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "unknown"

export const DEFAULT_PLATFORM = "unknown"

export const COMMAND_CANCEL_TOKEN = "__aihydro_command_cancel__"

/** A study offered for binding, labelled the way the server labels it (never a bare id). */
export interface StudyCandidateView {
	studyId: string
	label: string
	/** ISO timestamp of the study's last run, when the server reports one. */
	lastRun?: string
}

/**
 * Which study this chat is bound to, for the header chip and the picker. The host owns it: it is set at launch
 * (before the first tool call), refreshed from `session_binding` on tool results, and changed only by the user's
 * choice in the picker or by the agent's own explicit rebind. The extension never reads the server's files for it.
 *
 *  - `bound`        a study is bound; `studyId` and `label` are set.
 *  - `choose`       several studies could be meant and none was chosen: `candidates` are offered, nothing is bound.
 *  - `none`         no study is bound (a new study is created by the next delineation, or the user chose "No study").
 *  - `unavailable`  the server could not be asked (not connected, not trusted, or too old to list studies).
 */
export interface StudyBindingState {
	/** The chat id the state describes (the task ulid). A state for another chat is never shown. */
	chatId: string
	status: "bound" | "choose" | "none" | "unavailable"
	studyId?: string
	label?: string
	candidates?: StudyCandidateView[]
	/** Why this state: shown as the chip tooltip and the picker's lead-in. */
	reason?: string
	/** Where a bound study came from. */
	by?: "map-layer" | "map-artifact" | "workspace" | "resume" | "user" | "agent" | "server"
	/**
	 * Why `unavailable`, when the cause is one the user can fix: the AI-Hydro Tools server is connected but its launcher
	 * is not confirmed. The header then offers "Trust this launcher..." (host-set, display only).
	 */
	cause?: "untrusted_server"
	/** Whether this server can list studies and rebind a chat (capability flags); gates the picker's choices. */
	canChoose: boolean
	/**
	 * The chat's project (X1-P1), added by the host when it posts state. `id` is the immutable `prj_` id (never shown
	 * on its own); `title` is the server's name for it; `note` says why the chat has no project (server absent or older
	 * than 2.8.3). The picker lists this project's studies.
	 */
	project?: { id?: string; title?: string; note?: string }
}

export interface ExtensionState {
	isNewUser: boolean
	welcomeViewCompleted: boolean
	apiConfiguration?: ApiConfiguration
	autoApprovalSettings: AutoApprovalSettings
	browserSettings: BrowserSettings
	remoteBrowserHost?: string
	preferredLanguage?: string
	openaiReasoningEffort?: OpenaiReasoningEffort
	mode: Mode
	checkpointManagerErrorMessage?: string
	aihydroMessages: AiHydroMessage[]
	currentTaskItem?: HistoryItem
	currentFocusChainChecklist?: string | null
	/** The study this chat is bound to, or the choice it is waiting on. See StudyBindingState. */
	studyBinding?: StudyBindingState
	mcpMarketplaceEnabled?: boolean
	mcpDisplayMode: McpDisplayMode
	planActSeparateModelsSetting: boolean
	enableCheckpointsSetting?: boolean
	platform: Platform
	environment?: Environment
	shouldShowAnnouncement: boolean
	taskHistory: HistoryItem[]
	telemetrySetting: TelemetrySetting
	shellIntegrationTimeout: number
	terminalReuseEnabled?: boolean
	terminalOutputLineLimit: number
	maxConsecutiveMistakes: number
	defaultTerminalProfile?: string
	vscodeTerminalExecutionMode: string
	backgroundCommandRunning?: boolean
	backgroundCommandTaskId?: string
	lastCompletedCommandTs?: number
	version: string
	distinctId: string
	globalAiHydroRulesToggles: AiHydroRulesToggles
	localAiHydroRulesToggles: AiHydroRulesToggles
	localWorkflowToggles: AiHydroRulesToggles
	globalWorkflowToggles: AiHydroRulesToggles
	mcpResponsesCollapsed?: boolean
	strictPlanModeEnabled?: boolean
	yoloModeToggled?: boolean
	useAutoCondense?: boolean
	focusChainSettings: FocusChainSettings
	customPrompt?: string
	autoCondenseThreshold?: number
	favoritedModelIds: string[]
	// NEW: Add workspace information
	workspaceRoots: WorkspaceRoot[]
	primaryRootIndex: number
	isMultiRootWorkspace: boolean
	multiRootSetting: AiHydroFeatureSetting
	lastDismissedInfoBannerVersion: number
	lastDismissedModelBannerVersion: number
	hooksEnabled?: AiHydroFeatureSetting
	remoteConfigSettings?: Partial<GlobalStateAndSettings>
	subagentsEnabled?: boolean
	finalAnswerAuditEnabled?: boolean
	transcriptDetail?: "focus" | "normal" | "verbose"
	/** Roots whose files the agent may not write without approval (host-computed; the webview only displays). */
	protectedRoots?: string[]
	finalAnswerAuditGate?: boolean
	/** Chat titles: false means no model call for a title. */
	autoTitle?: boolean
	/** A model id on the chat's provider for title calls; empty means the chat's model. */
	titleModel?: string
	/** Discovered workspace HTML files (path + name) for the HTML Preview file browser */
	workspaceHtmlFiles: Array<{ path: string; name: string }>
	/** Incremented whenever HTML preview items change — used as a reliable signal for the webview to refresh */
	htmlPreviewVersion: number
	/** Currently active HTML preview item ID, or null */
	htmlPreviewActiveId: string | null
	/**
	 * Incremented each time the host explicitly opens a document in Studio (auto-open, "Add to Studio",
	 * an agent hand-off). The shell activates `htmlPreviewActiveId` once per increment, so opening a
	 * document shows it without the shell having to reload.
	 */
	htmlPreviewActivationSeq?: number
}

export interface AiHydroMessage {
	ts: number
	type: "ask" | "say"
	ask?: AiHydroAsk
	say?: AiHydroSay
	text?: string
	reasoning?: string
	images?: string[]
	files?: string[]
	partial?: boolean
	commandCompleted?: boolean
	/** Recorded by the host when the user answers a tool/command/MCP/browser ask. Absent = no evidence either way. */
	askOutcome?: "approved" | "denied"
	/** Recorded by the host when a call's result is returned (ToolExecutor). Absent = no completion evidence. */
	execOutcome?: "completed" | "failed" | "unknown"
	/** `say: "info"` rows: which kind of notice and how serious. `text` still carries the words; absent on old tasks. */
	infoNotice?: InfoNotice
	/** `mcp_notification` rows: the level the server sent (absent on old tasks; treat as "info"). */
	mcpLevel?: McpNotificationLevel
	/** Command rows: process exit code, or "unknown" when the host could not observe it. Absent = not recorded. */
	exitCode?: CommandExit
	/** Command rows the host's policy flagged (subagent launch, protected path, danger grant, ...). */
	policyClass?: CommandPolicyClass
	lastCheckpointHash?: string
	isCheckpointCheckedOut?: boolean
	isOperationOutsideWorkspace?: boolean
	conversationHistoryIndex?: number
	conversationHistoryDeletedRange?: [number, number] // for when conversation history is truncated for API requests
}

export type AiHydroAsk =
	| "followup"
	| "plan_mode_respond"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"
	| "auto_approval_max_req_reached"
	| "browser_action_launch"
	| "use_mcp_server"
	| "new_task"
	| "condense"
	| "summarize_task"
	| "report_bug"
	| "install_dependencies"
	| "workspace_env_setup"

export type AiHydroSay =
	| "task"
	| "error"
	| "error_retry"
	| "api_req_started"
	| "api_req_finished"
	| "text"
	| "reasoning"
	| "completion_result"
	| "user_feedback"
	| "user_feedback_diff"
	| "api_req_retried"
	| "command"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "shell_integration_warning_with_suggestion"
	| "browser_action_launch"
	| "browser_action"
	| "browser_action_result"
	| "mcp_server_request_started"
	| "mcp_server_response"
	| "mcp_notification"
	| "use_mcp_server"
	| "diff_error"
	| "deleted_api_reqs"
	| "aihydroignore_error"
	| "checkpoint_created"
	| "load_mcp_documentation"
	| "html_preview"
	| "info" // Added for general informational messages like retry status
	| "task_progress"
	| "answer_audit" // structured audit of a final answer (W2-B emits it; the proto enum is reserved at 1001)

export interface AiHydroSayTool {
	tool:
		| "editedExistingFile"
		| "newFileCreated"
		| "readFile"
		| "listFilesTopLevel"
		| "listFilesRecursive"
		| "listCodeDefinitionNames"
		| "searchFiles"
		| "webFetch"
		| "summarizeTask"
	path?: string
	diff?: string
	content?: string
	regex?: string
	filePattern?: string
	operationIsLocatedInWorkspace?: boolean
	startLine?: number
	endLine?: number
	totalLines?: number
}

// must keep in sync with system prompt
export const browserActions = ["launch", "click", "type", "scroll_down", "scroll_up", "close"] as const
export type BrowserAction = (typeof browserActions)[number]

export interface AiHydroSayBrowserAction {
	action: BrowserAction
	coordinate?: string
	text?: string
}

export type BrowserActionResult = {
	screenshot?: string
	logs?: string
	currentUrl?: string
	currentMousePosition?: string
}

export interface AiHydroAskUseMcpServer {
	serverName: string
	type: "use_mcp_tool" | "access_mcp_resource"
	toolName?: string
	arguments?: string
	uri?: string
	/** Set when a stored "Always" grant exists but failed the run-time recheck (M-3); the ask says why. */
	autoApprovePaused?: string
	/** With `autoApprovePaused`: the ask offers "Trust this launcher..." because the pause is a trust problem (host-set). */
	autoApprovePausedFix?: "trust_launcher"
}

export interface AiHydroPlanModeResponse {
	response: string
	options?: string[]
	selected?: string
}

export interface AiHydroAskQuestion {
	question: string
	options?: string[]
	selected?: string
}

export interface AiHydroAskNewTask {
	context: string
}

export interface AiHydroApiReqInfo {
	request?: string
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	cost?: number
	/** "unavailable": pricing not verified, no cost number; "lower-bound": cost excludes unpriced cache tokens. */
	costStatus?: "unavailable" | "lower-bound"
	cancelReason?: AiHydroApiReqCancelReason
	streamingFailedMessage?: string
	retryStatus?: {
		attempt: number
		maxAttempts: number
		delaySec: number
		errorSnippet?: string
	}
}

export type AiHydroApiReqCancelReason = "streaming_failed" | "user_cancelled" | "retries_exhausted"

export const COMPLETION_RESULT_CHANGES_FLAG = "HAS_CHANGES"
