import { checkUserTitle, DESCRIPTION_MAX, fallbackTitle, isBulkTitleCandidate } from "@shared/chatTitle"
import type { HistoryItem } from "@shared/HistoryItem"
import type { HistoryWriter } from "../storage/historyPatch"
import { generateTitle, type TitleInput, type TitleModelCall, type TitleSettings } from "./titleGenerator"

/**
 * Chat titles on the host (X1-P2): the one place that decides when a title is written and by whom.
 *
 * Every write goes through `patch`, the controller's `patchTaskHistory`, so the merge rules of historyPatch.ts hold:
 * a user title is a lock, and an automatic one that finishes after a rename is dropped at write time (no timing race).
 * This class holds no history of its own.
 */

/** A patch to a history item; `null` removes a field (only the owner may). */
export type HistoryPatch = { [K in keyof HistoryItem]?: HistoryItem[K] | null }

export type TitleTrigger = "first_turn" | "completion"

/** What the live chat or the saved messages say about a chat: the first reply and the tool names, never tool output. */
export interface ChatExchange {
	firstAssistantText?: string
	toolNames: string[]
}

export interface ChatTitleDeps {
	getHistory(): readonly HistoryItem[]
	patch(id: string, patch: HistoryPatch, writer: HistoryWriter): void
	settings(): TitleSettings & { titleModel: string }
	call: TitleModelCall
	loadExchange(item: HistoryItem): Promise<ChatExchange | undefined>
	studyLabelFor(item: HistoryItem): string | undefined
	/** Tell the webview the history changed. */
	changed(): void
	/** One backup of the history file before the first write of M2. Throws if it cannot be taken. */
	backup?(): Promise<void>
	log?(message: string): void
}

/** At most two automatic generations per chat: after the first turn and at the first completion (PSMH §4.1). */
const MAX_AUTO_RUNS = 2

export type RenameResult =
	| { ok: true; item: HistoryItem; reset?: boolean }
	| { ok: false; reason: "not_found" | "invalid"; detail?: string }

export interface BulkResult {
	status: "done" | "cancelled" | "disabled" | "busy"
	titled: number
	failed: number
	skipped: number
}

export class ChatTitleService {
	private inflight = new Map<string, AbortController>()
	private bulk: AbortController | undefined

	constructor(private readonly deps: ChatTitleDeps) {}

	private find(id: string): HistoryItem | undefined {
		return this.deps.getHistory().find((h) => h.id === id)
	}

	private sourceFor(item: HistoryItem): TitleInput {
		return {
			origin: item.origin,
			userQuestion: item.userQuestion,
			task: item.task,
			studyLabel: this.deps.studyLabelFor(item),
		}
	}

	// ---- User rename ---------------------------------------------------------------------------------------

	/**
	 * A user rename: stores the title and locks it. An empty title is "reset to automatic": the lock is cleared and the
	 * deterministic title is stored until the next automatic one. A description given with it is locked the same way.
	 * Anything an automatic title is doing for this chat right now is cancelled.
	 */
	rename(id: string, title: string, description?: string): RenameResult {
		const item = this.find(id)
		if (!item) {
			return { ok: false, reason: "not_found" }
		}
		this.cancelFor(id)
		if (title.trim() === "" && description === undefined) {
			this.deps.patch(id, { title: null, titleSource: null, description: null, titleRuns: null }, "user")
			const fb = fallbackTitle(this.sourceFor(this.find(id) ?? item))
			this.deps.patch(id, { title: fb, titleSource: "fallback" }, "system")
			this.deps.changed()
			return { ok: true, item: this.find(id) ?? item, reset: true }
		}
		const patch: HistoryPatch = { titleSource: "user" }
		if (title.trim() !== "") {
			const checked = checkUserTitle(title)
			if (!checked.ok) {
				return { ok: false, reason: "invalid", detail: checked.reason }
			}
			patch.title = checked.text
		}
		if (description !== undefined) {
			if (description.trim() === "") {
				patch.description = null
			} else {
				const d = checkUserTitle(description, DESCRIPTION_MAX)
				if (!d.ok) {
					return { ok: false, reason: "invalid", detail: d.reason }
				}
				patch.description = d.text
			}
		}
		this.deps.patch(id, patch, "user")
		this.deps.changed()
		return { ok: true, item: this.find(id) ?? item }
	}

	// ---- Automatic title -----------------------------------------------------------------------------------

	/** Cancel any automatic title being made for `id` (the chat was renamed or deleted). */
	cancelFor(id: string): void {
		this.inflight.get(id)?.abort()
		this.inflight.delete(id)
	}

	dispose(): void {
		for (const c of this.inflight.values()) {
			c.abort()
		}
		this.inflight.clear()
		this.bulk?.abort()
	}

	/**
	 * Ask for an automatic title for a live chat. Never throws and never waits for the model: a title is a courtesy. A
	 * user-titled chat is left alone, as is a chat that has had its two automatic runs. `force` is the user's own
	 * request to start over (after "reset to automatic").
	 */
	request(id: string, trigger: TitleTrigger | "reset"): Promise<void> {
		return this.run(id, trigger).catch((error) => {
			this.deps.log?.(`[title] ${id}: ${error instanceof Error ? error.message : String(error)}`)
		})
	}

	private async run(id: string, trigger: TitleTrigger | "reset"): Promise<void> {
		const item = this.find(id)
		if (!item || item.titleSource === "user" || this.inflight.has(id)) {
			return
		}
		const runs = item.titleRuns ?? 0
		const settings = this.deps.settings()
		// With automatic titles off the only job is to fill a gap: a chat that has a title is left as it is, so a
		// long chat does not rewrite its history and repost state on every reply.
		if (!settings.autoTitle && item.title && trigger !== "reset") {
			return
		}
		if (trigger !== "reset" && settings.autoTitle) {
			if (trigger === "first_turn" && runs >= 1) {
				return
			}
			if (trigger === "completion" && runs >= MAX_AUTO_RUNS) {
				return
			}
		}
		const controller = new AbortController()
		this.inflight.set(id, controller)
		try {
			const exchange = settings.autoTitle ? await this.deps.loadExchange(item).catch(() => undefined) : undefined
			const result = await generateTitle({
				input: { ...this.sourceFor(item), ...exchange },
				settings,
				call: this.deps.call,
				signal: controller.signal,
			})
			if (result.cancelled) {
				return
			}
			this.write(id, result, runs)
		} finally {
			if (this.inflight.get(id) === controller) {
				this.inflight.delete(id)
			}
		}
	}

	/** Store an automatic result. Re-reads the item: it may have been deleted or renamed while the model was working. */
	private write(
		id: string,
		result: { title: string; description?: string; source: "auto" | "fallback"; modelCalled: boolean },
		runsBefore: number,
	): void {
		const current = this.find(id)
		if (!current || current.titleSource === "user") {
			return
		}
		const runs = result.modelCalled ? Math.max(runsBefore, current.titleRuns ?? 0) + 1 : (current.titleRuns ?? 0)
		// No count is written for a title no model was asked for.
		const runsPatch = runs > 0 ? { titleRuns: runs } : {}
		if (result.source === "fallback") {
			// A fallback never replaces a title a model already wrote; it only fills a gap.
			if (current.title && current.titleSource === "auto") {
				this.deps.patch(id, runsPatch, "system")
				return
			}
			this.deps.patch(id, { title: result.title, titleSource: "fallback", ...runsPatch }, "system")
		} else {
			this.deps.patch(
				id,
				{
					title: result.title,
					titleSource: "auto",
					...runsPatch,
					...(result.description ? { description: result.description } : {}),
				},
				"system",
			)
		}
		this.deps.changed()
	}

	// ---- M2: fallback titles for every earlier chat -------------------------------------------------------

	/**
	 * Give every chat that has no title the deterministic one (`titleSource: "fallback"`). Free, additive and idempotent:
	 * a chat with a title of any source is not looked at, and no model is called. Takes one backup before the first
	 * write. Returns how many chats were titled.
	 */
	async ensureFallbackTitles(): Promise<number> {
		const todo = this.deps.getHistory().filter((h) => !h.title && h.titleSource !== "user")
		if (todo.length === 0) {
			return 0
		}
		if (this.deps.backup) {
			try {
				await this.deps.backup()
			} catch (error) {
				this.deps.log?.(`[title] M2: could not back up the history, so no title was written: ${String(error)}`)
				return 0
			}
		}
		let count = 0
		for (const item of todo) {
			const current = this.find(item.id)
			if (!current || current.title || current.titleSource === "user") {
				continue
			}
			this.deps.patch(item.id, { title: fallbackTitle(this.sourceFor(current)), titleSource: "fallback" }, "system")
			count++
		}
		if (count > 0) {
			this.deps.changed()
		}
		return count
	}

	// ---- Opt-in bulk titling -------------------------------------------------------------------------------

	/** Chats a bulk run would title: the ones no model has titled and the user has not named. */
	bulkCandidates(): HistoryItem[] {
		return this.deps.getHistory().filter(isBulkTitleCandidate)
	}

	cancelBulk(): void {
		this.bulk?.abort()
	}

	/**
	 * Title earlier chats with the model. Runs only when the user asks (the banner's button), one chat at a time, and
	 * can be cancelled between chats and during one. With `autoTitle` off it does nothing and calls no model. A chat
	 * the user renames while it runs is skipped.
	 */
	async runBulk(): Promise<BulkResult> {
		const result: BulkResult = { status: "done", titled: 0, failed: 0, skipped: 0 }
		if (!this.deps.settings().autoTitle) {
			return { ...result, status: "disabled" }
		}
		if (this.bulk) {
			return { ...result, status: "busy" }
		}
		const controller = new AbortController()
		this.bulk = controller
		try {
			for (const candidate of this.bulkCandidates()) {
				if (controller.signal.aborted) {
					result.status = "cancelled"
					break
				}
				const item = this.find(candidate.id)
				if (!item || !isBulkTitleCandidate(item) || this.inflight.has(item.id)) {
					result.skipped++
					continue
				}
				const exchange = await this.deps.loadExchange(item).catch(() => undefined)
				const generated = await generateTitle({
					input: { ...this.sourceFor(item), ...exchange },
					settings: this.deps.settings(),
					call: this.deps.call,
					signal: controller.signal,
				})
				if (generated.cancelled) {
					result.status = "cancelled"
					break
				}
				if (generated.source === "auto") {
					this.write(item.id, generated, item.titleRuns ?? 0)
					result.titled++
				} else {
					// The model's reply was unusable or the call failed: the chat keeps its fallback title.
					if (generated.modelCalled) {
						this.deps.patch(item.id, { titleRuns: (item.titleRuns ?? 0) + 1 }, "system")
					}
					result.failed++
				}
			}
		} finally {
			this.bulk = undefined
			this.deps.changed()
		}
		return result
	}
}
