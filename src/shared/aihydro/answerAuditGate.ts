/**
 * Pure helpers for the pre-completion answer-audit gate (W2-C), shared by the host (gate, tests) and the webview
 * (interim summary). No React, no host or vscode imports.
 *
 * Everything here that inspects prose is APPROXIMATE and extension-side: aihydro-tools main (2.6.0) has no
 * `previous_prose` input and no `[unverified]` marker, so removed values are found by comparing numeric tokens and
 * evidence markers between drafts. The result is disclosed as "removed ... from the draft", never as a verdict.
 */

import { MAX_DRAFT_TEXT_CHARS } from "./transcriptContracts"

// ── Progress line (the only thing shown while the gate is eligible and the draft is hidden) ───────────────────────

export const AUDIT_PROGRESS_DRAFTING = "Drafting answer…"
export const AUDIT_PROGRESS_CHECKING = "Checking answer against evidence…"

/** True for the plain-text body of the transient progress row (a partial `answer_audit` say that is not JSON). */
export function isAuditProgressText(text: string | undefined): boolean {
	return text === AUDIT_PROGRESS_DRAFTING || text === AUDIT_PROGRESS_CHECKING
}

// ── Draft cap ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function capDraft(text: string): { draftText: string; draftTruncated?: true } {
	return text.length > MAX_DRAFT_TEXT_CHARS
		? { draftText: text.slice(0, MAX_DRAFT_TEXT_CHARS), draftTruncated: true }
		: { draftText: text }
}

// ── What the audit reads ──────────────────────────────────────────────────────────────────────────────────────────

interface RowLike {
	type?: string
	say?: string
	ask?: string
	text?: string
	partial?: boolean
}

/**
 * The prose the gate audits (plan M4): every non-empty `say("text")` row since the last user message, then the
 * result. Auditing only `result` would let numbers be moved into narration the user also reads.
 *
 * `older` is the part the model cannot revise this turn: narration from earlier turns of the cycle (before the
 * latest API request). `current` is this turn's narration plus the result. Findings that sit only in `older` are
 * disclosed but never sent to the model as revision instructions or counted toward the hard gate (B1).
 */
export function splitAuditProse(rows: readonly RowLike[], result: string): { full: string; older: string; current: string } {
	let start = 0
	for (let i = rows.length - 1; i >= 0; i--) {
		const r = rows[i]
		if (r.type === "say" && (r.say === "task" || r.say === "user_feedback")) {
			start = i + 1
			break
		}
	}
	let turnStart = start
	for (let i = rows.length - 1; i >= start; i--) {
		if (rows[i].type === "say" && rows[i].say === "api_req_started") {
			turnStart = i + 1
			break
		}
	}
	const narration = (from: number, to: number) =>
		rows
			.slice(from, to)
			.filter((r) => r.type === "say" && r.say === "text" && !r.partial && (r.text ?? "").trim().length > 0)
			.map((r) => r.text as string)
	const older = narration(start, turnStart)
	const current = [...narration(turnStart, rows.length), result]
	return { full: [...older, ...current].join("\n\n"), older: older.join("\n\n"), current: current.join("\n\n") }
}

export function collectAuditProse(rows: readonly RowLike[], result: string): string {
	return splitAuditProse(rows, result).full
}

const flat = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase()

/**
 * True when a finding's excerpt appears in earlier-turn narration and nowhere in this turn's text: it cannot be fixed
 * by a revision. An excerpt that is missing or cannot be located counts as revisable (the safe default).
 */
export function isOlderNarrationOnly(excerpt: string | undefined, older: string, current: string): boolean {
	const ex = flat((excerpt ?? "").replace(/^(?:…|\.\.\.)+|(?:…|\.\.\.)+$/g, ""))
	if (ex.length < 3) {
		return false
	}
	return flat(older).includes(ex) && !flat(current).includes(ex)
}

// ── Removed-value detection (approximate) ─────────────────────────────────────────────────────────────────────────

const MARKER_RE = /\[(?:run|claim|lit):[^\]\s][^\]]*\]/gi
const NUM = "[-−]?(?:\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+)(?:[eE][-+]?\\d+)?"
const UNIT =
	"%|mm\\/(?:day|d|h|yr)|m³\\/s|m3\\/s|cms|cfs|km²|km2|ha|mm|cm|km|m²|m2|m³|m3|°C|K|years?|yrs?|days?|hours?|months?|observations?|samples?|gauges?|basins?|stations?|m|L|h"
const QUANTITY_RE = new RegExp(`(?<![\\w.])(${NUM})(?:\\s?(${UNIT})(?![A-Za-z]))?`, "gi")

/** Quantities in prose: numbers with an optional attached unit. Marker contents are removed first; bare years are skipped. */
export function extractQuantities(prose: string): string[] {
	const text = prose.replace(MARKER_RE, " ")
	const out: string[] = []
	for (const m of text.matchAll(QUANTITY_RE)) {
		const raw = m[1].replace(/,/g, "").replace("−", "-")
		const unit = (m[2] ?? "").toLowerCase()
		const value = Number(raw)
		if (!Number.isFinite(value)) {
			continue
		}
		const isYearLike = !unit && !raw.includes(".") && Number.isInteger(value) && value >= 1800 && value <= 2200
		if (isYearLike) {
			continue
		}
		out.push(`${m[1]}${m[2] ? ` ${m[2]}` : ""}`.trim())
	}
	return out
}

/** Key for matching a quantity across drafts: signed numeric value plus a unit with ²/³ normalised. */
export function quantityKey(q: string): string {
	const m = q.match(new RegExp(`^(${NUM})\\s?(.*)$`))
	if (!m) {
		return q.toLowerCase()
	}
	const unit = m[2].toLowerCase().replace(/²/g, "2").replace(/³/g, "3")
	return `${Number(m[1].replace(/,/g, "").replace("−", "-"))}|${unit}`
}

export function extractMarkers(prose: string): string[] {
	return (prose.match(MARKER_RE) ?? []).map((m) => m.trim())
}

function multisetMissing(prev: string[], next: string[], key: (s: string) => string): string[] {
	const remaining = new Map<string, number>()
	for (const n of next) {
		remaining.set(key(n), (remaining.get(key(n)) ?? 0) + 1)
	}
	const missing: string[] = []
	for (const p of prev) {
		const k = key(p)
		const left = remaining.get(k) ?? 0
		if (left > 0) {
			remaining.set(k, left - 1)
		} else {
			missing.push(p)
		}
	}
	return missing
}

export interface DroppedEvidence {
	droppedQuantities: string[]
	droppedClaimMarkers: string[]
	/** Quantities detected in the NEW prose: 0 means the revision reports no values at all. */
	quantitiesRemaining: number
}

/** Quantities and evidence markers present in `previous` and absent from `next` (multiset difference). */
export function diffDroppedEvidence(previous: string, next: string): DroppedEvidence {
	const nextQuantities = extractQuantities(next)
	return {
		droppedQuantities: multisetMissing(extractQuantities(previous), nextQuantities, quantityKey),
		droppedClaimMarkers: multisetMissing(extractMarkers(previous), extractMarkers(next), (s) => s.toLowerCase()),
		quantitiesRemaining: nextQuantities.length,
	}
}

/**
 * Everything the cycle removed, for the shown answer's footer (F5): the diff of the first draft against the shown
 * answer, plus anything an intermediate revision dropped that is still absent from the shown answer (a value
 * introduced in revision 1 and removed in revision 2 never appears in the first draft).
 */
export function cumulativeDropped(
	firstDraft: string,
	shown: string,
	stepDrops: { quantities: string[]; markers: string[] },
): DroppedEvidence {
	const base = diffDroppedEvidence(firstDraft, shown)
	const shownQ = new Set(extractQuantities(shown).map(quantityKey))
	const haveQ = new Set(base.droppedQuantities.map(quantityKey))
	const shownM = new Set(extractMarkers(shown).map((m) => m.toLowerCase()))
	const haveM = new Set(base.droppedClaimMarkers.map((m) => m.toLowerCase()))
	const droppedQuantities = [...base.droppedQuantities]
	for (const q of stepDrops.quantities) {
		const k = quantityKey(q)
		if (!shownQ.has(k) && !haveQ.has(k)) {
			haveQ.add(k)
			droppedQuantities.push(q)
		}
	}
	const droppedClaimMarkers = [...base.droppedClaimMarkers]
	for (const m of stepDrops.markers) {
		const k = m.toLowerCase()
		if (!shownM.has(k) && !haveM.has(k)) {
			haveM.add(k)
			droppedClaimMarkers.push(m)
		}
	}
	return { droppedQuantities, droppedClaimMarkers, quantitiesRemaining: base.quantitiesRemaining }
}

const MAX_LISTED = 8

function listed(items: string[]): string {
	const shown = items.slice(0, MAX_LISTED).join(", ")
	return items.length > MAX_LISTED ? `${shown}, … (+${items.length - MAX_LISTED} more)` : shown
}

/**
 * Footer sentences for what a revision removed. `draftHadHard`: the rejected draft had hard findings. Returns [] when
 * nothing was removed. The match is approximate, and the wording says so.
 */
export function droppedEvidenceLines(args: {
	attempt: number
	droppedQuantities?: string[]
	droppedClaimMarkers?: string[]
	quantitiesRemaining?: number
	draftHadHard: boolean
}): string[] {
	if (args.attempt <= 0) {
		return []
	}
	const lines: string[] = []
	const q = args.droppedQuantities ?? []
	const m = args.droppedClaimMarkers ?? []
	if (q.length > 0) {
		lines.push(`Revision removed ${q.length} ${q.length === 1 ? "quantity" : "quantities"} from the draft: ${listed(q)}`)
	}
	if (m.length > 0) {
		lines.push(`Revision removed ${m.length} evidence ${m.length === 1 ? "marker" : "markers"}: ${listed(m)}`)
	}
	if (args.quantitiesRemaining === 0 && args.draftHadHard) {
		lines.push("The requested values are no longer reported in this answer")
	}
	return lines
}
