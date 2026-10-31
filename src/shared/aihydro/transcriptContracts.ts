/**
 * Frozen shared contracts for the Wave 2 chat redesign (W2-0). Types plus tiny pure helpers only: no React, no
 * webview or host imports, so the presenter (webview), the audit gate (host) and the proto layer can all depend on it.
 *
 * Change rules: additive only. `AnswerAuditPayload.v` and the legacy registry are the compatibility surface; a
 * breaking change needs a new `v`, never an edit to v1.
 */

// ── Info notices ────────────────────────────────────────────────────────────────────────────────────────────────

// The `InfoNotice {class, severity}` shape and the host's class list are owned by `infoNotice.ts` (W2-0h; this
// file carries an identical copy until both PRs are merged). This section only adds the legacy registry for rows
// written before notices carried structure.
import { INFO_CLASS_SEVERITY, INFO_CLASSES, type InfoClass, type InfoNotice } from "./infoNotice"

export type { InfoClass, InfoNotice, InfoSeverity } from "./infoNotice"

/** What a legacy plain-string row is classified as when nothing in the registry matches: always lifted. */
export const UNCLASSIFIED_CLASS = "unclassified" as const
export type ClassifiedInfoNotice = InfoNotice | { class: typeof UNCLASSIFIED_CLASS; severity: "warning" }

/**
 * Legacy plain-string `info` notices written before notices carried `{class, severity}`. Matching is by prefix on the
 * trimmed text (the first paragraph is the muted line; later paragraphs are raw detail, see MutedNotice.splitNotice).
 */
export const LEGACY_INFO_NOTICE_REGISTRY: ReadonlyArray<{ prefix: string; class: InfoClass }> = [
	{ prefix: "malformed tool call; retried", class: "malformed_tool_call" },
	{ prefix: "Native tool call not at end of message; not run.", class: "native_call_not_run" },
	{ prefix: "Repaired a native tool call", class: "native_call_repaired" },
	// Written as `Skipped: '<tool>' is not a tool on '<server>'. ...` (UseMcpToolHandler).
	{ prefix: "Skipped: '", class: "unknown_tool" },
]

/** Registry lookup for a legacy plain-string info notice; unmatched text is lifted as `unclassified`. */
export function classifyLegacyInfoNotice(text: string | undefined): ClassifiedInfoNotice {
	const value = (text ?? "").trim()
	for (const entry of LEGACY_INFO_NOTICE_REGISTRY) {
		if (!value.startsWith(entry.prefix)) {
			continue
		}
		// Only the not-a-tool refusal is `unknown_tool`; any other "Skipped:" text stays unclassified.
		if (entry.class === "unknown_tool" && !/^Skipped: '[^']*' is not a tool\b/.test(value)) {
			continue
		}
		return { class: entry.class, severity: INFO_CLASS_SEVERITY[entry.class] }
	}
	return { class: UNCLASSIFIED_CLASS, severity: "warning" }
}

/**
 * True when the notice must stay visible outside a collapsed group. The class is trusted over the stored severity:
 * a known class folds only if its own table severity is "info" (so only `native_call_repaired`); an unknown class is
 * always lifted, whatever severity was stored with it.
 */
export function isLiftedNotice(notice: { class: string; severity: string }): boolean {
	if (!(INFO_CLASSES as readonly string[]).includes(notice.class)) {
		return true
	}
	return INFO_CLASS_SEVERITY[notice.class as InfoClass] !== "info"
}

// ── Answer audit ────────────────────────────────────────────────────────────────────────────────────────────────

export const ANSWER_AUDIT_PAYLOAD_VERSION = 1 as const

/** Silent revisions the gate may make before it discloses what remains (plan decision, W2-C). */
export const MAX_AUDIT_REVISIONS = 2

/** Longest draft text kept per attempt in a payload; longer drafts keep `draftHash` and set `draftTruncated`. */
export const MAX_DRAFT_TEXT_CHARS = 20_000

/**
 * `final`: the answer shown. `revision`: a rejected draft that was revised. `interrupted`: the gate exited early.
 * `pending` (additive, W2-C): a draft persisted, hidden, before its audit starts so a reload can reveal it; renders
 * as nothing.
 */
export type AnswerAuditStage = "final" | "revision" | "interrupted" | "pending"

/** `passed` is the only status a footer may present as clean. `skipped` and `unavailable` never are. */
export type AnswerAuditStatus = "passed" | "violations" | "unavailable" | "skipped"

/** `graded`: the tools auditor reported per-violation severity. `legacy`: older tools; severity is `unknown`. */
export type AnswerAuditSchema = "graded" | "legacy"

export type AnswerAuditSeverity = "hard" | "advisory" | "unknown"

export interface AnswerAuditViolation {
	kind: string
	severity: AnswerAuditSeverity
	excerpt?: string
	message?: string
	fixHint?: string
	/** Graded schema (aihydro-tools >= 2.6.0) extras, kept as their own fields. */
	category?: string
	suggestedMarker?: string
	resolvedPath?: string
}

/** Why the answer is shown with a caveat. */
export type AnswerAuditDisclosureKind = "findings_remain" | "audit_unavailable" | "audit_skipped" | "interrupted"

export interface AnswerAuditDisclosure {
	kind: AnswerAuditDisclosureKind
	/** Short human reason (e.g. "stopped by user", "audit timed out after 45s"). */
	reason?: string
}

/**
 * One gate attempt's draft record, kept so a rejected draft can be shown ("Show draft (n)") and so removed values
 * can be disclosed (anti-gaming, M4).
 *
 * Storage decision: `draftHash` (sha-256 hex of the draft text, computed by the host) is always present.
 * `draftText` is stored in the payload, which lives in the `answer_audit` row's `text` inside the task's local
 * `ui_messages.json` like every other transcript row; it is capped at MAX_DRAFT_TEXT_CHARS (`draftTruncated`
 * records the cut). Draft text is never put in telemetry. A reader must work with `draftHash` alone.
 */
export interface AnswerDraftRecord {
	draftHash: string
	draftText?: string
	draftTruncated?: boolean
}

/** One attempt in the revision history (earlier attempts only; the current one is the payload itself). */
export interface AnswerRevisionEvent extends AnswerDraftRecord {
	/** 0 = the model's first draft; 1..MAX_AUDIT_REVISIONS = revisions. */
	attempt: number
	ts: number
	hardCount: number
	advisoryCount: number
	violations: AnswerAuditViolation[]
	/** Quantities present in the previous attempt and absent here (the auditor's `dropped_quantities`). */
	droppedQuantities?: string[]
	droppedClaimMarkers?: string[]
	costUsd?: number
}

/**
 * Why the pre-completion gate (the revise-before-showing loop) did not run for an answer. Recorded on the shown
 * answer's `answer_audit` row, so a skip is never silent. The first four are the user's own settings or mode; the
 * rest mean the safeguard could not engage and the answer was shown with the display-only audit instead.
 */
export type AnswerAuditGateSkip =
	| "gate-setting-off"
	| "audit-disabled"
	| "plan-mode"
	| "no-trusted-server"
	| "no-audit-tool"
	| "graded-schema-unknown"
	| "study-not-bound"

/** What a reader is told for each skip reason. `chosen` skips are the user's own choice and show only at Verbose. */
export const GATE_SKIP_TEXT: Record<AnswerAuditGateSkip, { text: string; chosen: boolean }> = {
	"gate-setting-off": { text: "the answer check before showing is turned off in settings", chosen: true },
	"audit-disabled": { text: "the answer audit is turned off in settings", chosen: true },
	"plan-mode": { text: "Plan mode", chosen: true },
	"no-trusted-server": {
		text: "the AI-Hydro tools server is not trusted (its launch identity changed or it is not the registered one)",
		chosen: false,
	},
	"no-audit-tool": { text: "the connected tools server has no audit tool", chosen: false },
	"graded-schema-unknown": { text: "the tools server is too old for graded audits", chosen: false },
	"study-not-bound": { text: "no study was bound to this chat when the answer was written", chosen: false },
}

/** Body (JSON in `text`) of the `answer_audit` say. */
export interface AnswerAuditPayload extends AnswerDraftRecord {
	v: typeof ANSWER_AUDIT_PAYLOAD_VERSION
	stage: AnswerAuditStage
	status: AnswerAuditStatus
	sessionId?: string
	/** Numbers traced to evidence / numbers found. Absent when the auditor did not report them. */
	cited?: number
	total?: number
	/** Counts over ALL findings; `violations` is the complete list (no display cap). */
	hardCount: number
	advisoryCount: number
	violations: AnswerAuditViolation[]
	schema: AnswerAuditSchema
	/** 0 = the first draft was audited as shown; n = shown after n silent revisions. */
	attempt: number
	/** `ts` of the answer row this audit describes. */
	answerTs: number
	disclosure?: AnswerAuditDisclosure
	droppedQuantities?: string[]
	droppedClaimMarkers?: string[]
	/**
	 * Additive (W2-C): quantities the extension detected in the answer as shown (approximate token match). 0 on a
	 * revised answer whose draft had hard findings means the requested values are no longer reported.
	 */
	quantitiesRemaining?: number
	/**
	 * Additive (W2-C): findings (a subset of `violations`) whose text sits only in narration from earlier turns of the
	 * cycle. A revision cannot change that text, so they were never sent to the model as revision instructions and do
	 * not count toward the hard gate; the footer discloses them separately.
	 */
	unrevisableFindings?: AnswerAuditViolation[]
	/** Graded schema: count of findings the auditor exempted, by reason (e.g. year-like numbers). */
	exemptByReason?: Record<string, number>
	/** Earlier attempts, oldest first. */
	history?: AnswerRevisionEvent[]
	/**
	 * Additive (0.4.6): the reason the revise-before-showing gate did not run for this answer. Absent when it ran. The
	 * answer then carries the display-only audit, if that ran.
	 */
	gateSkipped?: AnswerAuditGateSkip
}

export function isHardFinding(v: Pick<AnswerAuditViolation, "severity">): boolean {
	return v.severity === "hard"
}

/** hard/advisory counts for a violation list; `unknown` severity is counted in neither (it is shown as unknown). */
export function countFindings(violations: readonly Pick<AnswerAuditViolation, "severity">[]): {
	hardCount: number
	advisoryCount: number
	unknownCount: number
} {
	let hardCount = 0
	let advisoryCount = 0
	let unknownCount = 0
	for (const v of violations) {
		if (v.severity === "hard") {
			hardCount++
		} else if (v.severity === "advisory") {
			advisoryCount++
		} else {
			unknownCount++
		}
	}
	return { hardCount, advisoryCount, unknownCount }
}

/** True only when the audit actually ran and found nothing: the one state a footer may call clean. */
export function isCleanAudit(p: Pick<AnswerAuditPayload, "status" | "violations" | "disclosure">): boolean {
	return p.status === "passed" && p.violations.length === 0 && !p.disclosure
}

const SEVERITIES: readonly AnswerAuditSeverity[] = ["hard", "advisory", "unknown"]
const isStr = (x: unknown): x is string => typeof x === "string"
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)

function parseViolation(raw: any): AnswerAuditViolation | undefined {
	if (!raw || typeof raw !== "object" || !isStr(raw.kind)) {
		return undefined
	}
	return {
		kind: raw.kind,
		severity: SEVERITIES.includes(raw.severity) ? raw.severity : "unknown",
		...(isStr(raw.excerpt) ? { excerpt: raw.excerpt } : {}),
		...(isStr(raw.message) ? { message: raw.message } : {}),
		...(isStr(raw.fixHint) ? { fixHint: raw.fixHint } : {}),
		...(isStr(raw.category) ? { category: raw.category } : {}),
		...(isStr(raw.suggestedMarker) ? { suggestedMarker: raw.suggestedMarker } : {}),
		...(isStr(raw.resolvedPath) ? { resolvedPath: raw.resolvedPath } : {}),
	}
}

function parseExempt(raw: any): Record<string, number> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined
	}
	const out: Record<string, number> = {}
	for (const [k, v] of Object.entries(raw)) {
		if (isNum(v)) {
			out[k] = v
		}
	}
	return Object.keys(out).length ? out : undefined
}

/**
 * Tolerant reader for an `answer_audit` row's text. Returns undefined for anything that is not a v1 payload, so a
 * future `v` is ignored rather than misread.
 */
export function parseAnswerAuditPayload(text: string | undefined): AnswerAuditPayload | undefined {
	let raw: any
	try {
		raw = JSON.parse(text ?? "")
	} catch {
		return undefined
	}
	if (!raw || typeof raw !== "object" || raw.v !== ANSWER_AUDIT_PAYLOAD_VERSION) {
		return undefined
	}
	const stage: AnswerAuditStage[] = ["final", "revision", "interrupted", "pending"]
	const status: AnswerAuditStatus[] = ["passed", "violations", "unavailable", "skipped"]
	if (!stage.includes(raw.stage) || !status.includes(raw.status) || !isNum(raw.answerTs) || !isStr(raw.draftHash)) {
		return undefined
	}
	const violations = (Array.isArray(raw.violations) ? raw.violations : [])
		.map(parseViolation)
		.filter((v: AnswerAuditViolation | undefined): v is AnswerAuditViolation => !!v)
	// Counts are recomputed from the list so a stale or hand-edited count can never make a footer look cleaner.
	const { hardCount, advisoryCount } = countFindings(violations)
	return {
		v: ANSWER_AUDIT_PAYLOAD_VERSION,
		stage: raw.stage,
		status: raw.status,
		...(isStr(raw.sessionId) ? { sessionId: raw.sessionId } : {}),
		...(isNum(raw.cited) ? { cited: raw.cited } : {}),
		...(isNum(raw.total) ? { total: raw.total } : {}),
		hardCount,
		advisoryCount,
		violations,
		schema: raw.schema === "graded" ? "graded" : "legacy",
		attempt: isNum(raw.attempt) ? raw.attempt : 0,
		answerTs: raw.answerTs,
		draftHash: raw.draftHash,
		...(isStr(raw.draftText) ? { draftText: raw.draftText } : {}),
		...(raw.draftTruncated === true ? { draftTruncated: true } : {}),
		...(raw.disclosure && typeof raw.disclosure === "object" && isStr(raw.disclosure.kind)
			? { disclosure: raw.disclosure as AnswerAuditDisclosure }
			: {}),
		...(Array.isArray(raw.droppedQuantities) ? { droppedQuantities: raw.droppedQuantities.filter(isStr) } : {}),
		...(Array.isArray(raw.droppedClaimMarkers) ? { droppedClaimMarkers: raw.droppedClaimMarkers.filter(isStr) } : {}),
		...(Array.isArray(raw.unrevisableFindings)
			? {
					unrevisableFindings: raw.unrevisableFindings
						.map(parseViolation)
						.filter((v: AnswerAuditViolation | undefined): v is AnswerAuditViolation => !!v),
				}
			: {}),
		...(isNum(raw.quantitiesRemaining) ? { quantitiesRemaining: raw.quantitiesRemaining } : {}),
		...(parseExempt(raw.exemptByReason) ? { exemptByReason: parseExempt(raw.exemptByReason) } : {}),
		...(Array.isArray(raw.history) ? { history: raw.history as AnswerRevisionEvent[] } : {}),
		...(isStr(raw.gateSkipped) && Object.hasOwn(GATE_SKIP_TEXT, raw.gateSkipped)
			? { gateSkipped: raw.gateSkipped as AnswerAuditGateSkip }
			: {}),
	}
}
