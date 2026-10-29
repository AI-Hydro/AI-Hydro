/** Where a chat was launched from. Written once at creation (see HISTORY_FIELD_OWNERS). */
export type HistoryOrigin = "chat" | "map" | "ledger" | "preview"

export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	checkpointManagerErrorMessage?: string

	// Fields below are declared now so later PRs never reopen the merge rules. Each has exactly one owner
	// (src/core/storage/historyPatch.ts). A build that predates them keeps them on disk and ignores them.
	/**
	 * Display title (src/shared/chatTitle.ts). A "user" title is never overwritten by the loop or the system. "fallback" is
	 * the deterministic title, "auto" one a model wrote; both may be replaced, a "user" one only by the user.
	 */
	title?: string
	titleSource?: "auto" | "fallback" | "user"
	description?: string
	/** How many times a model has been called to title this chat (at most two automatic runs). Written with the title. */
	titleRuns?: number
	pinned?: boolean
	memoryMode?: string
	/** Project the chat belongs to. Immutable once set. */
	projectId?: string
	/** How the chat was launched. Immutable once set. */
	origin?: HistoryOrigin
	/** The user's own question when the prompt was wrapped (a map launch). Immutable once set. */
	userQuestion?: string
	/** Study the chat is bound to, mirrored from the server's `session_binding`. Written by the binding writer only. */
	activeStudyId?: string
}
