import type { HistoryItem } from "@shared/HistoryItem"

/**
 * One writer for `HistoryItem` (X0-1).
 *
 * Before this, the task loop rebuilt the whole item on every save and `toggleTaskFavorite` replaced fields on its
 * own, so each overwrote the other (a favourite toggled during a running task was reverted by the next message).
 * Now every write is a patch from a named writer, merged over the stored item, and each field has exactly one owner:
 *
 *  - `loop`     host-computed fields, overwritten on every save (tokens, cost, size, ts, ...).
 *  - `creation` fields written once when the chat is created and never changed after (cwd, origin, project, ulid).
 *               Any writer may supply them; the first value wins.
 *  - `user`     fields the user sets (favourite, pin, description, memory mode, a renamed title). Only the `user`
 *               writer touches them.
 *  - `binding`  the study mirror (`activeStudyId`), written when a binding is confirmed.
 *  - `title`    `title`/`titleSource`: the `user` writer sets both; the `system` writer may set an automatic title
 *               only while the stored `titleSource` is not "user".
 *
 * Fields the table does not know are preserved from the stored item and are rejected from a patch (with a warning)
 * unless the writer is `system` (migrations, imports, the dev task generator).
 */
export type HistoryWriter = "loop" | "user" | "binding" | "system"

export type HistoryOwner = "loop" | "creation" | "user" | "binding" | "title"

export const HISTORY_FIELD_OWNERS: Readonly<Record<string, HistoryOwner>> = {
	// loop
	ts: "loop",
	task: "loop",
	tokensIn: "loop",
	tokensOut: "loop",
	cacheWrites: "loop",
	cacheReads: "loop",
	totalCost: "loop",
	size: "loop",
	shadowGitConfigWorkTree: "loop",
	conversationHistoryDeletedRange: "loop",
	checkpointManagerErrorMessage: "loop",
	// creation (first value wins)
	ulid: "creation",
	cwdOnTaskInitialization: "creation",
	projectId: "creation",
	origin: "creation",
	userQuestion: "creation",
	// user
	isFavorited: "user",
	pinned: "user",
	description: "user",
	memoryMode: "user",
	// title (user, or system while not user-titled)
	title: "title",
	titleSource: "title",
	// binding
	activeStudyId: "binding",
}

function mayWrite(owner: HistoryOwner, writer: HistoryWriter): boolean {
	if (writer === "system") {
		return true
	}
	switch (owner) {
		case "loop":
			return writer === "loop"
		case "creation":
			return true
		case "user":
			return writer === "user"
		case "binding":
			return writer === "binding"
		case "title":
			return writer === "user"
	}
}

/**
 * Merge `patch` over `existing` under the ownership table. Pure: returns a new item and never mutates its inputs.
 * `existing` undefined creates the item (the creation fields are taken as given).
 */
export function mergeHistoryItem(
	existing: HistoryItem | undefined,
	patch: Partial<HistoryItem> & { id: string },
	writer: HistoryWriter,
): HistoryItem {
	const next: Record<string, unknown> = { ...(existing ?? {}) }
	next.id = patch.id
	const stored = (existing ?? {}) as Record<string, unknown>
	for (const [key, value] of Object.entries(patch)) {
		if (key === "id") {
			continue
		}
		const owner = HISTORY_FIELD_OWNERS[key]
		if (!owner) {
			if (writer === "system") {
				next[key] = value
			} else {
				console.warn(`[history] ignored unowned field '${key}' from writer '${writer}'`)
			}
			continue
		}
		if (!mayWrite(owner, writer)) {
			continue
		}
		if (owner === "creation" && stored[key] !== undefined && stored[key] !== null) {
			continue
		}
		if (owner === "title" && writer === "system" && stored.titleSource === "user") {
			continue
		}
		if (value === undefined) {
			// An undefined value never erases a stored one: a field is removed only by the writer that owns it
			// passing an explicit null.
			continue
		}
		if (value === null) {
			delete next[key]
			continue
		}
		next[key] = value
	}
	return next as HistoryItem
}

/** Merge into a history list (replaces the list, never mutates it). Appends when the id is new. */
export function patchHistory(
	history: readonly HistoryItem[],
	patch: Partial<HistoryItem> & { id: string },
	writer: HistoryWriter,
): { history: HistoryItem[]; item: HistoryItem } {
	const index = history.findIndex((h) => h.id === patch.id)
	const item = mergeHistoryItem(index === -1 ? undefined : history[index], patch, writer)
	const next = [...history]
	if (index === -1) {
		next.push(item)
	} else {
		next[index] = item
	}
	return { history: next, item }
}

export function removeFromHistory(history: readonly HistoryItem[], id: string): HistoryItem[] {
	return history.filter((h) => h.id !== id)
}
