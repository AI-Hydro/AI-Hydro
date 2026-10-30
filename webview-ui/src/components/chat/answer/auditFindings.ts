import { AIHYDRO_MARKER_SOURCE, markerFromMatch } from "@shared/aihydro/evidenceMarkers"
import type { AnswerAuditPayload, AnswerAuditViolation } from "@shared/aihydro/transcriptContracts"

/**
 * Human-facing view of the audit's findings. The auditor's text is written for the agent ("Add [run:…] immediately
 * after '774.15'"); this module turns each finding into what a reader needs: which number, where, and what is wrong
 * with its link. The agent-directed text (fix hint, raw marker) stays on the view so Verbose can still show it.
 * Presentation only: nothing here changes what the gate blocks or allows.
 */

/** Finding kinds that are about one number in the prose. */
const NUMBER_KINDS = new Set(["uncited_number", "untraced_number", "run_id_not_found", "json_path_not_found", "value_mismatch"])

/** Kinds meaning "no [run:] marker on this number" (`untraced_number` is the name older servers and fixtures use). */
const UNLINKED_KINDS = new Set(["uncited_number", "untraced_number"])

const STATUS_BY_KIND: Record<string, string> = {
	uncited_number: "Not linked to a run",
	untraced_number: "Not linked to a run",
	run_id_not_found: "Link points to a run that is not recorded",
	json_path_not_found: "Link points to a value the run does not have",
	value_mismatch: "Value differs from the run",
	claim_not_found: "Claim not found",
	claim_bad_status: "Claim is not in a citable state",
	lit_unresolvable: "Literature reference not found in the index",
	malformed_marker: "Citation is malformed",
	stale_claim: "Claim predates the latest run",
}

/** `[run:<id>]` without `#<path>`: names a run but not which value, so the auditor can check nothing against it. */
const PATHLESS_RUN = /\[run:[A-Za-z0-9][A-Za-z0-9._-]*\]/

export const PATHLESS_RUN_STATUS = "Run reference has no #path, so the value could not be checked"

const QUOTED_NUMBER = /['"‘’“”]([-+−]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?%?)['"‘’“”]/

export interface RunHint {
	runId: string
	jsonPath: string
}

export interface FindingView {
	kind: string
	severity: AnswerAuditViolation["severity"]
	/** The number as written in the answer, when the finding is about one and the message names it. */
	quantity?: string
	/** Plain-text context around the number (markdown and markers removed), capped. */
	context?: string
	/** What is wrong, in a sentence a reader can act on. */
	status: string
	/** The run the auditor suggests the number came from. */
	runHint?: RunHint
	/** Agent-directed text: shown only at Verbose. */
	fixHint?: string
	marker?: string
	message?: string
}

const humanize = (kind: string): string => {
	const s = kind.replace(/[_-]+/g, " ").trim()
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Finding"
}

/** Excerpt as plain prose around `quantity`: emphasis, code ticks and citation markers removed, whitespace flattened. */
export function contextSnippet(excerpt: string | undefined, quantity?: string, width = 56): string | undefined {
	if (!excerpt) {
		return undefined
	}
	const flat = excerpt
		.replace(new RegExp(AIHYDRO_MARKER_SOURCE, "g"), "")
		.replace(/[*_`]{1,3}/g, "")
		.replace(/\s+/g, " ")
		.trim()
	if (!flat) {
		return undefined
	}
	const at = quantity ? flat.indexOf(quantity) : -1
	if (at < 0) {
		return flat.length > width * 2 ? `${flat.slice(0, width * 2).trimEnd()}…` : flat
	}
	const from = Math.max(0, at - width)
	const to = Math.min(flat.length, at + quantity!.length + width)
	return `${from > 0 ? "…" : ""}${flat.slice(from, to).trim()}${to < flat.length ? "…" : ""}`
}

/** A finding about a run reference that is missing its `#path` (the number beside it, or the reference itself). */
export function isPathlessRunFinding(v: AnswerAuditViolation): boolean {
	if (v.kind === "malformed_marker") {
		return PATHLESS_RUN.test(v.message ?? "") || PATHLESS_RUN.test(v.excerpt ?? "")
	}
	return UNLINKED_KINDS.has(v.kind) && PATHLESS_RUN.test(v.excerpt ?? "")
}

function statusFor(v: AnswerAuditViolation): string {
	return isPathlessRunFinding(v) ? PATHLESS_RUN_STATUS : (STATUS_BY_KIND[v.kind] ?? humanize(v.kind))
}

export function viewFinding(v: AnswerAuditViolation): FindingView {
	const quantity = NUMBER_KINDS.has(v.kind) ? v.message?.match(QUOTED_NUMBER)?.[1] : undefined
	let runHint: RunHint | undefined
	if (v.suggestedMarker) {
		const m = new RegExp(AIHYDRO_MARKER_SOURCE).exec(v.suggestedMarker)
		const marker = m ? markerFromMatch(m) : undefined
		if (marker?.type === "run") {
			runHint = { runId: marker.runId, jsonPath: marker.jsonPath }
		}
	}
	return {
		kind: v.kind,
		severity: v.severity,
		quantity,
		context: contextSnippet(v.excerpt, quantity),
		status: statusFor(v),
		runHint,
		fixHint: v.fixHint,
		marker: v.suggestedMarker,
		message: v.message,
	}
}

/** "watershed.0b124654840f" -> "watershed.0b12…" */
export const shortRunId = (runId: string): string => (runId.length > 15 ? `${runId.slice(0, 14)}…` : runId)

/** "key_outputs.area_km2" -> "area_km2" */
export const shortPath = (jsonPath: string): string => jsonPath.split(".").pop() || jsonPath

/** "Likely from run watershed.0b12… (area_km2)" */
export const runHintText = (h: RunHint): string => `Likely from run ${shortRunId(h.runId)} (${shortPath(h.jsonPath)})`

export interface AuditSummaryView {
	/** One human sentence, e.g. "3 numbers aren't linked to a recorded run". */
	text: string
	/** `warn`: a hard finding; `note`: advisory only. */
	tone: "warn" | "note"
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * The collapsed summary. Counts come from the payload (`hardCount`/`advisoryCount` cover every finding), the wording
 * from what the hard findings are about. Undefined when the audit has nothing to review.
 */
export function auditSummaryView(p: AnswerAuditPayload): AuditSummaryView | undefined {
	if (p.status === "unavailable" || p.status === "skipped" || p.violations.length === 0) {
		return undefined
	}
	if (p.schema === "legacy") {
		const n = p.violations.length
		return { text: `${n} ${plural(n, "finding", "findings")} to review`, tone: "warn" }
	}
	const hardList = p.violations.filter((v) => v.severity === "hard")
	const hard = Math.max(p.hardCount, hardList.length)
	if (hard > 0) {
		const allNumbers = hardList.length > 0 && hardList.every((v) => NUMBER_KINDS.has(v.kind))
		const allUnlinked = allNumbers && hardList.every((v) => UNLINKED_KINDS.has(v.kind))
		const head = allUnlinked
			? `${hard} ${plural(hard, "number isn't", "numbers aren't")} linked to a recorded run`
			: allNumbers
				? `${hard} ${plural(hard, "number doesn't", "numbers don't")} match a recorded run`
				: `${hard} ${plural(hard, "finding needs", "findings need")} review`
		const adv = Math.max(p.advisoryCount, p.violations.filter((v) => v.severity === "advisory").length)
		// A reference without its #path is the one cause a reader can see and fix: say it, not just "needs review".
		const pathless = hardList.filter((v) => v.kind === "malformed_marker" && isPathlessRunFinding(v)).length
		const why = pathless > 0 ? ` · ${pathless} run ${plural(pathless, "reference has", "references have")} no #path` : ""
		return { text: `${head}${why}${adv > 0 ? ` · ${adv} more ${plural(adv, "note", "notes")}` : ""}`, tone: "warn" }
	}
	const adv = Math.max(p.advisoryCount, p.violations.length)
	return { text: `${adv} ${plural(adv, "note", "notes")} to review`, tone: "note" }
}

export interface UntracedTarget {
	quantity: string
	status: string
	runHint?: RunHint
}

/** quantity -> one target per finding naming it, in the recorded order. */
export type UntracedPlan = Map<string, UntracedTarget[]>

/** Numbers in the answer prose the audit could not trace, to underline in place. */
export function untracedPlan(violations: readonly AnswerAuditViolation[]): UntracedPlan {
	const plan: UntracedPlan = new Map()
	for (const v of violations) {
		const f = viewFinding(v)
		if (!f.quantity) {
			continue
		}
		const list = plan.get(f.quantity) ?? []
		list.push({ quantity: f.quantity, status: f.status, runHint: f.runHint })
		plan.set(f.quantity, list)
	}
	return plan
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

interface MdNode {
	type: string
	value?: string
	children?: MdNode[]
	data?: { hProperties?: Record<string, string> }
}

const SKIP_PARENTS = new Set(["link", "linkReference", "inlineCode", "code"])
/** A number cited with a chip right after it (optionally a unit in between) is traced: do not underline it. */
const CITED_TAIL = /^[^\d\n]{0,14}$/

/**
 * Mutates a markdown AST: wraps the first N occurrences of each untraced quantity (N = findings naming it) in a
 * `strong` carrying `data-untraced` properties. An occurrence directly followed by a citation chip is skipped.
 * Idempotent per call (counters are local), so reprocessing the same text gives the same result.
 */
export function markUntracedNumbers(tree: MdNode, plan: UntracedPlan): void {
	if (plan.size === 0) {
		return
	}
	const quantities = [...plan.keys()].sort((a, b) => b.length - a.length)
	const re = new RegExp(`(?<![\\d.])(?:${quantities.map(escapeRe).join("|")})(?![\\d]|\\.\\d)`, "g")
	const used = new Map<string, number>()
	const walk = (node: MdNode) => {
		if (!node.children || SKIP_PARENTS.has(node.type)) {
			return
		}
		const out: MdNode[] = []
		let changed = false
		node.children.forEach((child, idx) => {
			if (child.type !== "text" || typeof child.value !== "string") {
				walk(child)
				out.push(child)
				return
			}
			const text = child.value
			const next = node.children![idx + 1]
			const nextIsChip = !!next?.data?.hProperties?.["data-chip-type"]
			let last = 0
			let m: RegExpExecArray | null
			const parts: MdNode[] = []
			re.lastIndex = 0
			while ((m = re.exec(text)) !== null) {
				const q = m[0]
				const targets = plan.get(q)
				const n = used.get(q) ?? 0
				const tail = text.slice(m.index + q.length)
				if (!targets || n >= targets.length || (nextIsChip && CITED_TAIL.test(tail))) {
					continue
				}
				used.set(q, n + 1)
				const t = targets[n]
				if (m.index > last) {
					parts.push({ type: "text", value: text.slice(last, m.index) })
				}
				parts.push({
					type: "strong",
					data: {
						hProperties: {
							"data-untraced": "1",
							"data-untraced-status": t.status,
							...(t.runHint
								? { "data-untraced-run": t.runHint.runId, "data-untraced-path": t.runHint.jsonPath }
								: {}),
						},
					},
					children: [{ type: "text", value: q }],
				})
				last = m.index + q.length
			}
			if (parts.length === 0) {
				out.push(child)
				return
			}
			changed = true
			if (last < text.length) {
				parts.push({ type: "text", value: text.slice(last) })
			}
			out.push(...parts)
		})
		if (changed) {
			node.children = out
		}
	}
	walk(tree)
}
