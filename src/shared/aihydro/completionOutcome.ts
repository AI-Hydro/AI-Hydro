/**
 * Honest exit (feature scout N1). `attempt_completion` may say the task was not fully done: `outcome` is
 * `done | partial | infeasible` and `unmet` lists what was not done and why. `done` is the absence of a record (every old row and
 * every normal completion), so only the two honest-exit outcomes are ever stored on a row.
 *
 * Model-supplied, so it is a statement by the model, never evidence: the card shows it as "the agent says", the audit does
 * not read it, and nothing is gated on it. It exists so a model that could not finish has a first-class way to say so
 * instead of an answer that reads as complete.
 *
 * Host-free: shared by the extension host, the proto layer and the webview.
 */

export const COMPLETION_OUTCOMES = ["done", "partial", "infeasible"] as const
export type CompletionOutcomeKind = (typeof COMPLETION_OUTCOMES)[number]

/** What a row stores: only the outcomes that need showing. */
export interface CompletionOutcome {
	outcome: "partial" | "infeasible"
	/** What was not done and why, one item per entry. May be empty (the model gave an outcome and no list). */
	unmet: string[]
}

export const OUTCOME_LABEL: Record<CompletionOutcome["outcome"], string> = {
	partial: "Partly done",
	infeasible: "Could not be done",
}

const MAX_ITEMS = 10
const MAX_ITEM_CHARS = 300

/** `unmet` as the model writes it: one item per line, optional list markers. */
export function parseUnmet(text: string | undefined): string[] {
	return (text ?? "")
		.split("\n")
		.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
		.filter(Boolean)
		.slice(0, MAX_ITEMS)
		.map((item) => (item.length > MAX_ITEM_CHARS ? `${item.slice(0, MAX_ITEM_CHARS - 1)}…` : item))
}

/**
 * The record for an `attempt_completion` call, or undefined when it says `done` or says nothing (the normal case). A value
 * that is not one of the three is treated as absent: a typo must not turn a completion into an error.
 */
export function completionOutcomeOf(outcome: string | undefined, unmet: string | undefined): CompletionOutcome | undefined {
	const kind = (outcome ?? "").trim().toLowerCase()
	if (kind !== "partial" && kind !== "infeasible") {
		return undefined
	}
	return { outcome: kind, unmet: parseUnmet(unmet) }
}

/** Parse a stored record (the proto field). Unknown shapes are absent. */
export function parseCompletionOutcome(json: string | undefined): CompletionOutcome | undefined {
	if (!json) {
		return undefined
	}
	try {
		const raw = JSON.parse(json)
		if (raw && (raw.outcome === "partial" || raw.outcome === "infeasible")) {
			return {
				outcome: raw.outcome,
				unmet: Array.isArray(raw.unmet) ? raw.unmet.filter((u: unknown): u is string => typeof u === "string") : [],
			}
		}
	} catch {
		/* not a record */
	}
	return undefined
}
