import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { AiHydroAskResponse } from "@shared/WebviewMessage"
import { type AnswerAuditGateState, createGateState } from "./answerAuditGate"

export class TaskState {
	// Streaming flags
	isStreaming = false
	isWaitingForFirstChunk = false
	didCompleteReadingStream = false

	// Content processing
	currentStreamingContentIndex = 0
	assistantMessageContent: AssistantMessageContent[] = []
	userMessageContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
	userMessageContentReady = false

	/** The map-context block last sent in this task; undefined when none was sent or compaction dropped it. */
	lastInjectedMapContext?: string

	/**
	 * Every change to the deleted range goes through here: whatever the model was sent earlier may now be cut from
	 * its view, so the map-context block is forgotten and the next turn sends it again.
	 */
	setConversationHistoryDeletedRange(range: [number, number] | undefined): void {
		this._conversationHistoryDeletedRange = range
		this.lastInjectedMapContext = undefined
	}

	// Presentation locks
	presentAssistantMessageLocked = false
	presentAssistantMessageHasPendingUpdates = false

	// Ask/Response handling
	askResponse?: AiHydroAskResponse
	askResponseText?: string
	askResponseImages?: string[]
	askResponseFiles?: string[]
	lastMessageTs?: number
	/** ts of the ask a webview response was last accepted for; a second response for it is a double delivery. */
	answeredAskTs?: number
	/**
	 * The `command_output` asks of the command currently streaming output. `flushBuffer` posts a new ask every few
	 * lines, so a click made for an earlier chunk of the same stream still answers the pending chunk. Set when the
	 * command starts and cleared when it ends; never inferred from the message list.
	 */
	commandOutputStream?: { askTs: Set<number> }

	// Plan mode specific state
	isAwaitingPlanResponse = false
	didRespondToPlanAskBySwitchingMode = false

	// Context and history
	private _conversationHistoryDeletedRange?: [number, number]
	/** Read-only on purpose: assign through setConversationHistoryDeletedRange so dependent per-turn state is reset. */
	get conversationHistoryDeletedRange(): [number, number] | undefined {
		return this._conversationHistoryDeletedRange
	}

	// Tool execution flags
	didRejectTool = false
	didAlreadyUseTool = false
	didEditFile: boolean = false

	// Model id the provider reported serving for the most recent API request (provenance; surfaced in MCP _meta)
	lastResponseModelId?: string

	// Consecutive request tracking
	consecutiveAutoApprovedRequestsCount: number = 0

	// Error tracking
	consecutiveMistakeCount: number = 0
	lastToolName = "" // Name of the last executed tool
	lastToolParams = "" // Canonical signature of last tool's params (via toolCallSignature)
	consecutiveIdenticalToolCount = 0 // Consecutive calls with identical tool name + params
	// Set once we auto-inject the decompose-task nudge on the first mistake-limit hit, so the
	// second hit falls through to a human-in-the-loop ask instead of nudging forever. Reset
	// after a human turn so a later, unrelated stuck-spell also gets one automatic recovery.
	mistakeNudgeAlreadyInjected = false
	// Consecutive turns where the model produced substantive reasoning but no tool call. Models
	// that "think out loud" across turns (notably DeepSeek) shouldn't be penalized as mistakes
	// for the first few such turns — only once they exceed the grace window do they count, so a
	// model stuck purely thinking still trips the guard eventually.
	consecutiveThinkingOnlyTurns = 0
	// Sliding window of the most recent tool failures (tool name + truncated error), used to
	// ground the auto-decompose nudge in concrete failures instead of generic boilerplate.
	recentToolErrors: string[] = []
	// Semantic loop detection (beyond byte-identical signatures):
	// Consecutive zero-result searches on the SAME target path (regex may vary). Reset on any hit.
	consecutiveZeroResultSearches = 0
	lastZeroResultSearchPath = ""
	// Sliding window of recently read file paths, to catch repeated reads of the same target.
	recentReadTargets: string[] = []
	// File read deduplication cache — prevents the model from endlessly reading the same files
	fileReadCache: Map<string, { readCount: number; mtime: number; imageBlock?: Anthropic.ImageBlockParam }> = new Map()
	didAutomaticallyRetryFailedApiRequest = false
	checkpointManagerErrorMessage?: string

	// Pre-completion answer-audit gate (W2-C): revision counters, hidden draft, cached eligibility inputs
	answerAuditGate: AnswerAuditGateState = createGateState()

	// Retry tracking for auto-retry feature
	autoRetryAttempts: number = 0

	// Task Initialization
	isInitialized = false

	// Focus Chain / Todo List Management
	apiRequestCount: number = 0
	apiRequestsSinceLastTodoUpdate: number = 0
	currentFocusChainChecklist: string | null = null
	todoListWasUpdatedByUser: boolean = false

	// Task Abort / Cancellation
	abort: boolean = false
	didFinishAbortingStream = false
	abandoned = false

	// Auto-context summarization
	currentlySummarizing: boolean = false
	lastAutoCompactTriggerIndex?: number

	// RAG Brain integration
	hasPromptedForRagInstall: boolean = false
}
