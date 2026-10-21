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
 * The prose the gate audits: every non-empty `say("text")` row since the last user message, then the result.
 * Auditing only `result` would let numbers be moved into narration the user also reads (anti-gaming, M4).
 */
export function collectAuditProse(rows: readonly RowLike[], result: string): string {
	let start = 0
	for (let i = rows.length - 1; i >= 0; i--) {
		const r = rows[i]
		if (r.type === "say" && (r.say === "task" || r.say === "user_feedback")) {
			start = i + 1
			break
		}
	}
	const narration = rows
		.slice(start)
		.filter((r) => r.type === "say" && r.say === "text" && !r.partial && (r.text ?? "").trim().length > 0)
		.map((r) => r.text as string)
	return [...narration, result].join("\n\n")
}

// ── Removed-value detection (approximate) ─────────────────────────────────────────────────────────────────────────

const MARKER_RE = /\[(?:run|claim|lit):[^\]\s][^\]]*\]/gi
const UNIT =
	"%|mm\\/(?:day|d|h|yr)|m³\\/s|m3\\/s|cms|cfs|km²|km2|ha|mm|cm|km|m²|m2|m³|m3|°C|K|years?|yrs?|days?|hours?|months?|observations?|samples?|gauges?|basins?|stations?|m|L|h"
const QUANTITY_RE = new RegExp(`(?<![\\w.])(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s?(${UNIT})(?![A-Za-z]))?`, "gi")

/** Quantities in prose: numbers with an optional attached unit. Marker contents are removed first; bare years are skipped. */
export function extractQuantities(prose: string): string[] {
	const text = prose.replace(MARKER_RE, " ")
	const out: string[] = []
	for (const m of text.matchAll(QUANTITY_RE)) {
		const raw = m[1].replace(/,/g, "")
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

function quantityKey(q: string): string {
	const m = q.match(/^([\d,]*\.?\d+)\s?(.*)$/)
	if (!m) {
		return q.toLowerCase()
	}
	return `${Number(m[1].replace(/,/g, ""))}|${m[2].toLowerCase()}`
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
