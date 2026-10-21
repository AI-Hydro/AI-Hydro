/**
 * Pure transcript presenter (Wave 2, W2-A1): turns the UNFILTERED processed message list into the items the chat
 * renders. No UI wiring here and no React, webview or host imports: the presenter is a function of messages (plus
 * optional resolvers for facts a message does not carry), so it can be tested in node and reused by the replay view.
 *
 * Model:
 *  - Foldable "machinery" (requests, reasoning, calls, results, checkpoints, routine notices) is collected into a
 *    maximal `WorkGroup`. A group breaks only on a user turn, non-empty prose, a PENDING ask, an error, a completion
 *    or an answer audit. Empty or whitespace-only text never breaks a group, and lifted lines never split one.
 *  - Anything the reader must not miss (failures, refusals, cancellations, truncation, security-relevant approvals,
 *    ...) is LIFTED: it appears as its own line under the collapsed header AND in the header counts. Nothing that
 *    `classify` calls "lift" or "break" can end up only folded.
 *  - Unknown kinds are `passthrough`, never `fold`: the safe failure mode is "show it", not "hide it".
 *  - Header facts are derived from the messages only (timestamps, recorded costs, recorded outcomes). A fact the
 *    messages do not support is absent or labelled, never invented (cost in particular never reads `$0.0000`).
 *  - No tool-name literals: tools are recognised by message kind and by the generic shape of their results.
 */
import type { AiHydroAsk, AiHydroMessage, AiHydroSay } from "../ExtensionMessage"
import { deriveCallState } from "./askOutcome"
import { isElevatedMcpLevel } from "./infoNotice"
import { presentToolCall } from "./toolCallPresenter"
import { type AnswerAuditPayload, classifyLegacyInfoNotice, isLiftedNotice, parseAnswerAuditPayload } from "./transcriptContracts"

// ── Classification ──────────────────────────────────────────────────────────────────────────────────────────────

export type MessageClass = "fold" | "lift" | "break" | "prose" | "answer" | "passthrough"

/**
 * Every kind, keyed by a Record so adding a kind to `AiHydroSay`/`AiHydroAsk` without listing it here is a compile
 * error. The property tests enumerate these.
 */
const SAY_CLASS: Record<AiHydroSay, MessageClass> = {
	task: "break",
	error: "break",
	error_retry: "lift",
	api_req_started: "fold",
	api_req_finished: "fold",
	text: "prose",
	reasoning: "fold",
	completion_result: "answer",
	user_feedback: "break",
	user_feedback_diff: "fold",
	api_req_retried: "lift",
	command: "fold",
	command_output: "fold",
	tool: "fold",
	shell_integration_warning: "lift",
	shell_integration_warning_with_suggestion: "lift",
	browser_action_launch: "passthrough",
	browser_action: "passthrough",
	browser_action_result: "passthrough",
	mcp_server_request_started: "fold",
	mcp_server_response: "fold",
	mcp_notification: "fold",
	use_mcp_server: "fold",
	diff_error: "lift",
	deleted_api_reqs: "lift",
	aihydroignore_error: "lift",
	checkpoint_created: "fold",
	load_mcp_documentation: "fold",
	html_preview: "passthrough",
	// Floor is "lift": only a notice the registry knows to be informational is demoted to fold (see `isLiftedInfo`).
	info: "lift",
	task_progress: "fold",
	answer_audit: "answer",
}

const ASK_CLASS: Record<AiHydroAsk, MessageClass> = {
	followup: "prose",
	plan_mode_respond: "prose",
	command: "fold",
	command_output: "fold",
	completion_result: "answer",
	tool: "fold",
	api_req_failed: "lift",
	resume_task: "break",
	resume_completed_task: "break",
	mistake_limit_reached: "lift",
	auto_approval_max_req_reached: "lift",
	browser_action_launch: "passthrough",
	use_mcp_server: "fold",
	new_task: "passthrough",
	condense: "lift",
	summarize_task: "lift",
	report_bug: "passthrough",
	install_dependencies: "passthrough",
	workspace_env_setup: "passthrough",
}

export const ALL_SAY_KINDS = Object.keys(SAY_CLASS) as AiHydroSay[]
export const ALL_ASK_KINDS = Object.keys(ASK_CLASS) as AiHydroAsk[]

/**
 * The static floor for a kind. A "fold" kind may still be promoted to a lifted line by its content (a failed call, an
 * error-shaped result, an elevated notification); a "lift" or "break" kind is never demoted, except an `info` notice
 * the registry knows to be informational. `type` disambiguates the kinds that exist as both a say and an ask.
 * Unknown kinds are `passthrough`.
 */
export function classify(kind: AiHydroSay | AiHydroAsk | string, type?: "ask" | "say"): MessageClass {
	if (type !== "ask" && Object.hasOwn(SAY_CLASS, kind)) {
		return SAY_CLASS[kind as AiHydroSay]
	}
	if (type !== "say" && Object.hasOwn(ASK_CLASS, kind)) {
		return ASK_CLASS[kind as AiHydroAsk]
	}
	return assertNever(kind)
}

/** Exhaustiveness anchor: if a kind is added to the unions and not to the tables, `Record` already fails to compile. */
function assertNever(_kind: string): MessageClass {
	return "passthrough"
}

function classOf(m: AiHydroMessage): MessageClass {
	const kind = m.type === "ask" ? m.ask : m.say
	return kind ? classify(kind, m.type) : "passthrough"
}

// ── Output model ────────────────────────────────────────────────────────────────────────────────────────────────

export type DetailLevel = "focus" | "normal" | "verbose"

export interface PresentOptions {
	detail: DetailLevel
	/**
	 * Facts a message does not carry. Both are optional; without them the corresponding approvals are not
	 * security-marked (the presenter cannot know), and the caller (A2) supplies them from MCP annotations/settings.
	 */
	effectClassFor?: (message: AiHydroMessage) => "READ" | "WRITE" | "NETWORK" | "DESTRUCTIVE" | "UNKNOWN" | undefined
	isProtectedPath?: (path: string) => boolean
}

export type LiftReason =
	| "error"
	| "request_cancelled"
	| "request_failed"
	| "request_retried"
	| "refusal"
	| "area_check_failed"
	| "provisional"
	| "unrecognised_info"
	| "info_notice"
	| "context_truncated"
	| "context_condensed"
	| "unpaired_result"
	| "call_failed"
	| "call_denied"
	| "exit_nonzero"
	| "exit_unknown"
	| "mcp_error"
	| "blocking"
	| "mcp_notification"
	| "ignore_error"
	| "diff_error"
	| "shell_integration"
	| "checkpoint_checked_out"
	| "answer_revision"
	| "rewind"
	| "limit_reached"
	| "approved_security"
	| "policy_command"

export interface LiftedLine {
	key: string
	reason: LiftReason
	tone: "error" | "warning" | "notice"
	text: string
	/** `ts` of the message the line comes from. */
	sourceTs: number
	/** For call-level lines: the call row, so a result-level line for the same call can replace it. */
	callTs?: number
}

export type CostLabel =
	| { status: "none"; usd: null; label: "" }
	| { status: "exact"; usd: number; label: string }
	| { status: "lower-bound"; usd: number; label: string }
	| { status: "unavailable"; usd: null; label: string }

export interface HeaderFacts {
	/** Span of the group minus time spent waiting on the user (ms, from message timestamps). */
	agentMs: number
	/** Time between an answered approval ask and the next message (ms). */
	waitingMs: number
	/** Calls only (command, file/native tool, MCP tool). Requests, reasoning and checkpoints are not counted. */
	toolCount: number
	cost: CostLabel
	requestCount: number
	retryCount: number
	failedRequestCount: number
	/** Results the server marked as reused (`_cached`/`reused`). */
	reuseCount: number
	/** Answer revisions that directly follow this group. */
	revisionCount: number
	liftedCount: number
}

export interface UserTurn {
	kind: "user"
	key: string
	ts: number
	text: string
	images?: string[]
	files?: string[]
	message: AiHydroMessage
}
export interface Prose {
	kind: "prose"
	key: string
	ts: number
	text: string
	partial: boolean
	message: AiHydroMessage
}
export interface WorkGroup {
	kind: "group"
	/** `group:<ts of the first member>`: stable while the group grows, including under partial streaming. */
	key: string
	startTs: number
	endTs: number
	/** Everything folded into the group, in order (including the sources of lifted lines). */
	members: AiHydroMessage[]
	lifted: LiftedLine[]
	facts: HeaderFacts
	/** `ts` of the latest checkpoint in the group: where "Rewind" for this group's work points. No row of its own. */
	rewindTs?: number
	/** True when the group is the live tail at `normal` detail. */
	open: boolean
}
export interface PendingPrompt {
	kind: "pending"
	key: string
	ts: number
	ask: AiHydroAsk
	message: AiHydroMessage
}
export interface ErrorItem {
	kind: "error"
	key: string
	ts: number
	text: string
	message: AiHydroMessage
}
export interface Answer {
	kind: "answer"
	key: string
	ts: number
	text: string
	partial: boolean
	/** The `final` audit row for this answer, when there is one. */
	audit?: AnswerAuditPayload
	/** Rejected drafts disclosed by audit rows (history entries plus revision rows). */
	revisionCount: number
	message: AiHydroMessage
}
export type DividerKind = "resumed" | "answer_revision" | "answer_interrupted"
export interface Divider {
	kind: "divider"
	key: string
	ts: number
	dividerKind: DividerKind
	text: string
	message: AiHydroMessage
}
export interface Passthrough {
	kind: "passthrough"
	key: string
	ts: number
	messages: AiHydroMessage[]
}
export type TranscriptItem = UserTurn | Prose | WorkGroup | PendingPrompt | ErrorItem | Answer | Divider | Passthrough

// ── Small helpers ───────────────────────────────────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const hasText = (s: string | undefined) => (s ?? "").trim() !== ""

function parseObject(text: string | undefined): Json | undefined {
	if (!text) {
		return undefined
	}
	try {
		const v = JSON.parse(text)
		return isRecord(v) ? v : undefined
	} catch {
		return undefined
	}
}

function oneLine(text: string | undefined, max = 200): string {
	const line =
		(text ?? "")
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l !== "") ?? ""
	return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const kindOf = (m: AiHydroMessage) => (m.type === "ask" ? m.ask : m.say)
const isCallKind = (k: string | undefined) => k === "command" || k === "tool" || k === "use_mcp_server"
/** Approval-style asks: the answer is a run/deny decision. */
const isApprovalAsk = (m: AiHydroMessage) => m.type === "ask" && isCallKind(m.ask)

function toolInfo(m: AiHydroMessage): Json | undefined {
	return kindOf(m) === "tool" ? parseObject(m.text) : undefined
}
const isCondenseTool = (m: AiHydroMessage) => toolInfo(m)?.tool === "summarizeTask"

/** Short description of a call row for lifted text. */
function describeCall(m: AiHydroMessage): string {
	const kind = kindOf(m)
	if (kind === "command") {
		return oneLine((m.text ?? "").split("\nOutput:")[0])
	}
	const o = parseObject(m.text)
	if (!o) {
		return oneLine(m.text)
	}
	if (kind === "use_mcp_server") {
		const name = [o.serverName, o.toolName ?? o.uri].filter((x) => typeof x === "string" && x).join(".")
		return name || "MCP call"
	}
	return [o.tool, o.path].filter((x) => typeof x === "string" && x).join(" ") || "tool call"
}

// ── Result inspection (generic shapes, no tool names) ───────────────────────────────────────────────────────────

const MAX_DEPTH = 4
const truthyError = (v: unknown) => v !== undefined && v !== null && v !== false && v !== "" && v !== 0

interface ResultFindings {
	reasons: Array<{ reason: LiftReason; tone: LiftedLine["tone"]; text: string }>
	reused: boolean
}

function walk(v: unknown, depth: number, visit: (key: string, value: unknown, depth: number) => void): void {
	if (depth > MAX_DEPTH) {
		return
	}
	if (Array.isArray(v)) {
		for (const x of v.slice(0, 50)) {
			walk(x, depth + 1, visit)
		}
	} else if (isRecord(v)) {
		for (const [k, x] of Object.entries(v)) {
			visit(k, x, depth)
			walk(x, depth + 1, visit)
		}
	}
}

/** What an MCP result says about itself. Error shapes count at the top level (and one level under it); blocking, area check and reuse at bounded depth. */
export function inspectResult(text: string | undefined): ResultFindings {
	const out: ResultFindings = { reasons: [], reused: false }
	const add = (reason: LiftReason, tone: LiftedLine["tone"], t: string) => {
		if (!out.reasons.some((r) => r.reason === reason)) {
			out.reasons.push({ reason, tone, text: t })
		}
	}
	const trimmed = (text ?? "").trimStart()
	if (trimmed.startsWith("Error:")) {
		add("mcp_error", "error", oneLine(trimmed.replace(/^Error:\s*/, ""), 160) || "Tool returned an error")
	}
	const body = parseObject(text)
	if (!body) {
		return out
	}
	const errorShape = (o: Json, depth: number) => {
		if (o.isError === true) {
			add("mcp_error", "error", "Tool reported an error")
		}
		if (truthyError(o.error) && o.error !== true) {
			add(
				"mcp_error",
				"error",
				`Tool error: ${oneLine(typeof o.error === "string" ? o.error : JSON.stringify(o.error), 160)}`,
			)
		} else if (o.error === true) {
			add("mcp_error", "error", oneLine(typeof o.message === "string" ? o.message : "Tool returned an error", 160))
		}
		if (o.ok === false) {
			add("mcp_error", "error", "Tool reported ok: false")
		}
		if (o.status === "error") {
			add("mcp_error", "error", "Tool reported status: error")
		}
		const nested = o.data ?? o.result
		if (depth === 0 && isRecord(nested)) {
			errorShape(nested, 1)
		}
	}
	errorShape(body, 0)
	walk(body, 0, (k, v) => {
		if (k === "blocking" && v === true) {
			add("blocking", "warning", "A result is marked blocking")
		}
		if (k === "area_check" && v === "fail") {
			add("area_check_failed", "warning", "Basin area check failed")
		}
		if ((k === "_cached" && truthyError(v)) || (k === "reused" && v === true)) {
			out.reused = true
		}
	})
	const model = presentToolCall("", "", undefined, text)
	if (model.refusal) {
		add(
			"refusal",
			"error",
			`Refused${model.refusal.code ? ` (${model.refusal.code})` : ""}: ${oneLine(model.refusal.message, 160)}`,
		)
	}
	if (model.siteResolution?.areaCheck === "fail") {
		add("area_check_failed", "warning", "Basin area check failed")
	}
	if (model.quality?.provisional && model.quality.provisional.count > 0) {
		add("provisional", "warning", `Provisional data: ${model.quality.provisional.count}/${model.quality.provisional.total}`)
	}
	return out
}

// ── Cost ────────────────────────────────────────────────────────────────────────────────────────────────────────

function costLabel(rows: Array<{ cost?: number; status?: string }>): CostLabel {
	if (rows.length === 0) {
		return { status: "none", usd: null, label: "" }
	}
	let usd = 0
	let known = 0
	let unknown = 0
	let lower = false
	for (const r of rows) {
		if (r.status === "unavailable" || typeof r.cost !== "number" || !(r.cost > 0)) {
			unknown++
			continue
		}
		known++
		usd += r.cost
		lower = lower || r.status === "lower-bound"
	}
	if (known === 0) {
		return { status: "unavailable", usd: null, label: "cost unavailable (pricing not verified)" }
	}
	const fixed = `$${usd.toFixed(4)}`
	if (unknown > 0 || lower) {
		return {
			status: "lower-bound",
			usd,
			label: `≥${fixed} (${unknown > 0 ? `${unknown} request${unknown === 1 ? "" : "s"} unpriced` : "cache tokens unpriced"})`,
		}
	}
	return { status: "exact", usd, label: fixed }
}

// ── Presenter ───────────────────────────────────────────────────────────────────────────────────────────────────

interface GroupBuilder {
	members: AiHydroMessage[]
	lifted: LiftedLine[]
	waitingMs: number
	toolCount: number
	costRows: Array<{ cost?: number; status?: string }>
	requestCount: number
	retryCount: number
	failedRequestCount: number
	reuseCount: number
	rewindTs?: number
}

const newGroup = (): GroupBuilder => ({
	members: [],
	lifted: [],
	waitingMs: 0,
	toolCount: 0,
	costRows: [],
	requestCount: 0,
	retryCount: 0,
	failedRequestCount: 0,
	reuseCount: 0,
})

export function presentTranscript(messages: readonly AiHydroMessage[], options: PresentOptions): TranscriptItem[] {
	if (options.detail === "verbose") {
		return messages.map((m) => ({ kind: "passthrough" as const, key: `msg:${m.ts}`, ts: m.ts, messages: [m] }))
	}

	const items: TranscriptItem[] = []
	const usedKeys = new Set<string>()
	const uniqueKey = (base: string) => {
		let key = base
		for (let n = 2; usedKeys.has(key); n++) {
			key = `${base}#${n}`
		}
		usedKeys.add(key)
		return key
	}

	// Final audits by the answer they describe, so the answer item can carry its audit whatever the row order.
	const auditByAnswerTs = new Map<number, AnswerAuditPayload>()
	const claimedAudits = new Set<number>()
	for (const m of messages) {
		if (m.say === "answer_audit") {
			const p = parseAnswerAuditPayload(m.text)
			if (p && p.stage === "final") {
				auditByAnswerTs.set(p.answerTs, p)
			}
		}
	}

	let g: GroupBuilder | undefined
	let outstandingCalls: number[] = [] // MCP calls awaiting a response, by call ts
	let browserRun: AiHydroMessage[] | undefined

	const closeBrowser = () => {
		if (browserRun) {
			items.push({
				kind: "passthrough",
				key: uniqueKey(`passthrough:${browserRun[0].ts}`),
				ts: browserRun[0].ts,
				messages: browserRun,
			})
			browserRun = undefined
		}
	}
	const closeGroup = () => {
		if (!g || (g.members.length === 0 && g.lifted.length === 0)) {
			g = undefined
			return
		}
		// A result-level line for a call replaces that call's own failure line (one fact, one line).
		const resultCalls = new Set(
			g.lifted.filter((l) => l.reason !== "call_failed" && l.callTs !== undefined).map((l) => l.callTs),
		)
		const lifted = g.lifted.filter((l) => !(l.reason === "call_failed" && resultCalls.has(l.callTs)))
		const startTs = g.members[0]?.ts ?? lifted[0].sourceTs
		const endTs = g.members.length ? g.members[g.members.length - 1].ts : startTs
		const span = Math.max(0, endTs - startTs)
		const waitingMs = Math.min(g.waitingMs, span)
		items.push({
			kind: "group",
			key: uniqueKey(`group:${startTs}`),
			startTs,
			endTs,
			members: g.members,
			lifted,
			rewindTs: g.rewindTs,
			open: false,
			facts: {
				agentMs: span - waitingMs,
				waitingMs,
				toolCount: g.toolCount,
				cost: costLabel(g.costRows),
				requestCount: g.requestCount,
				retryCount: g.retryCount,
				failedRequestCount: g.failedRequestCount,
				reuseCount: g.reuseCount,
				revisionCount: 0,
				liftedCount: lifted.length,
			},
		})
		g = undefined
	}
	const closeAll = () => {
		closeGroup()
		closeBrowser()
	}
	const group = () => {
		closeBrowser()
		return (g ??= newGroup())
	}
	const lift = (
		grp: GroupBuilder,
		m: AiHydroMessage,
		reason: LiftReason,
		tone: LiftedLine["tone"],
		text: string,
		callTs?: number,
	) => {
		const key = `${reason}:${m.ts}`
		if (!grp.lifted.some((l) => l.key === key)) {
			grp.lifted.push({ key, reason, tone, text, sourceTs: m.ts, ...(callTs !== undefined ? { callTs } : {}) })
		}
	}

	const securityMarked = (m: AiHydroMessage): boolean => {
		if (m.policyClass || m.isOperationOutsideWorkspace) {
			return true
		}
		const info = toolInfo(m)
		if (info) {
			if (info.operationIsLocatedInWorkspace === false) {
				return true
			}
			if (typeof info.path === "string" && options.isProtectedPath?.(info.path)) {
				return true
			}
		}
		const effect = options.effectClassFor?.(m)
		return effect === "DESTRUCTIVE" || effect === "UNKNOWN"
	}

	const lastIndex = messages.length - 1
	messages.forEach((m, index) => {
		const cls = classOf(m)
		const kind = kindOf(m)
		const isTail = index === lastIndex

		// ── browser sessions: passthrough, contiguous, never folded ──
		if (
			cls === "passthrough" &&
			(kind === "browser_action_launch" || kind === "browser_action" || kind === "browser_action_result")
		) {
			if (m.type === "ask" && isTail && !m.askOutcome) {
				closeAll()
				items.push({ kind: "pending", key: uniqueKey(`pending:${m.ts}`), ts: m.ts, ask: m.ask as AiHydroAsk, message: m })
				return
			}
			closeGroup()
			if (!browserRun) {
				browserRun = []
			}
			browserRun.push(m)
			return
		}

		// ── pending asks always break (and are shown as prompts) ──
		if (m.type === "ask" && isTail && !m.askOutcome) {
			closeAll()
			items.push({ kind: "pending", key: uniqueKey(`pending:${m.ts}`), ts: m.ts, ask: m.ask as AiHydroAsk, message: m })
			return
		}

		switch (cls) {
			case "break": {
				closeAll()
				if (kind === "task" || kind === "user_feedback") {
					items.push({
						kind: "user",
						key: uniqueKey(`user:${m.ts}`),
						ts: m.ts,
						text: m.text ?? "",
						images: m.images,
						files: m.files,
						message: m,
					})
					outstandingCalls = []
				} else if (kind === "error") {
					items.push({ kind: "error", key: uniqueKey(`error:${m.ts}`), ts: m.ts, text: m.text ?? "", message: m })
				} else {
					items.push({
						kind: "divider",
						key: uniqueKey(`divider:${m.ts}`),
						ts: m.ts,
						dividerKind: "resumed",
						text: kind === "resume_completed_task" ? "Resumed a completed task" : "Resumed from an interrupted task",
						message: m,
					})
				}
				return
			}
			case "prose": {
				if (!hasText(m.text)) {
					return // never breaks a group
				}
				closeAll()
				const o = m.type === "ask" ? parseObject(m.text) : undefined
				const body =
					typeof o?.question === "string" ? o.question : typeof o?.response === "string" ? o.response : (m.text ?? "")
				items.push({
					kind: "prose",
					key: uniqueKey(`prose:${m.ts}`),
					ts: m.ts,
					text: body,
					partial: !!m.partial,
					message: m,
				})
				return
			}
			case "answer": {
				if (kind === "answer_audit") {
					closeAll()
					const p = parseAnswerAuditPayload(m.text)
					if (!p) {
						items.push({ kind: "passthrough", key: uniqueKey(`passthrough:${m.ts}`), ts: m.ts, messages: [m] })
					} else if (p.stage === "final") {
						// Attached to its answer (or surfaced after the loop if the answer is not in the list).
					} else {
						const interrupted = p.stage === "interrupted"
						const prev = items[items.length - 1]
						if (prev?.kind === "group") {
							prev.facts.revisionCount++
						}
						items.push({
							kind: "divider",
							key: uniqueKey(`divider:${m.ts}`),
							ts: m.ts,
							dividerKind: interrupted ? "answer_interrupted" : "answer_revision",
							text: interrupted
								? "Answer audit interrupted"
								: `Answer revised (attempt ${p.attempt}): ${p.violations.length} finding${p.violations.length === 1 ? "" : "s"}`,
							message: m,
						})
					}
					return
				}
				if (!hasText(m.text)) {
					return // an empty (or not yet started) completion carries nothing to show and never breaks a group
				}
				closeAll()
				const audit = auditByAnswerTs.get(m.ts)
				if (audit) {
					claimedAudits.add(m.ts)
				}
				items.push({
					kind: "answer",
					key: uniqueKey(`answer:${m.ts}`),
					ts: m.ts,
					text: m.text ?? "",
					partial: !!m.partial,
					audit,
					revisionCount: audit?.history?.length ?? 0,
					message: m,
				})
				return
			}
			case "passthrough": {
				closeAll()
				items.push({ kind: "passthrough", key: uniqueKey(`passthrough:${m.ts}`), ts: m.ts, messages: [m] })
				return
			}
			case "lift":
			case "fold":
				break
		}

		// ── machinery: fold, with content-based lifting ──
		const grp = group()
		grp.members.push(m)

		// An answered approval ask: the wait is the user's time; it folds unless security-marked or denied.
		if (isApprovalAsk(m)) {
			const next = messages[index + 1]
			if (next && next.ts >= m.ts) {
				grp.waitingMs += next.ts - m.ts
			}
		}

		if (isCallKind(kind) && !isCondenseTool(m)) {
			grp.toolCount++
			const state = deriveCallState(m, messages)
			const what = describeCall(m)
			if (kind === "use_mcp_server") {
				outstandingCalls.push(m.ts)
			}
			if (m.askOutcome === "denied" || state === "denied") {
				lift(grp, m, "call_denied", "warning", `You denied: ${what}`, m.ts)
			} else if (kind === "command" && typeof m.exitCode === "number" && m.exitCode !== 0) {
				lift(grp, m, "exit_nonzero", "error", `Exited with code ${m.exitCode}: ${what}`, m.ts)
			} else if (kind === "command" && (m.exitCode === "unknown" || m.execOutcome === "unknown")) {
				lift(grp, m, "exit_unknown", "warning", `Exit code unknown: ${what}`, m.ts)
			} else if (m.execOutcome === "failed" || state === "failed") {
				lift(grp, m, "call_failed", "error", `Failed: ${what}`, m.ts)
			} else if (m.policyClass) {
				lift(
					grp,
					m,
					"policy_command",
					"warning",
					`${m.type === "ask" ? "You approved" : "Ran"} (${m.policyClass.replace(/_/g, " ")}): ${what}`,
					m.ts,
				)
			} else if (securityMarked(m)) {
				lift(grp, m, "approved_security", "warning", `${m.type === "ask" ? "You approved" : "Ran"}: ${what}`, m.ts)
			}
			return
		}

		switch (kind) {
			case "api_req_started": {
				grp.requestCount++
				const info = parseObject(m.text) ?? {}
				grp.costRows.push({
					cost: typeof info.cost === "number" ? info.cost : undefined,
					status: info.costStatus as string | undefined,
				})
				if (isRecord(info.retryStatus)) {
					grp.retryCount++
				}
				const reason = info.cancelReason
				if (reason === "user_cancelled") {
					lift(grp, m, "request_cancelled", "notice", "Request cancelled by you")
				} else if (reason === "streaming_failed" || reason === "retries_exhausted") {
					grp.failedRequestCount++
					const detail =
						typeof info.streamingFailedMessage === "string" ? `: ${oneLine(info.streamingFailedMessage, 140)}` : ""
					lift(
						grp,
						m,
						"request_failed",
						"error",
						`${reason === "retries_exhausted" ? "Request failed after retries" : "Request failed while streaming"}${detail}`,
					)
				} else if (typeof info.streamingFailedMessage === "string") {
					grp.failedRequestCount++
					lift(grp, m, "request_failed", "error", `Request failed: ${oneLine(info.streamingFailedMessage, 160)}`)
				}
				return
			}
			case "api_req_retried":
			case "error_retry":
				grp.retryCount++
				lift(grp, m, "request_retried", "warning", oneLine(m.text) || "Request retried")
				return
			case "api_req_failed":
				grp.failedRequestCount++
				lift(grp, m, "request_failed", "error", `Request failed: ${oneLine(m.text, 160)}`)
				return
			case "mistake_limit_reached":
			case "auto_approval_max_req_reached":
				lift(grp, m, "limit_reached", "warning", oneLine(m.text) || "A limit was reached")
				return
			case "condense":
			case "summarize_task":
				lift(grp, m, "context_condensed", "notice", "Context condensed")
				return
			case "deleted_api_reqs":
				lift(grp, m, "rewind", "notice", "Earlier requests removed by a rewind")
				return
			case "diff_error":
				lift(grp, m, "diff_error", "error", oneLine(m.text) || "Edit did not apply")
				return
			case "aihydroignore_error":
				lift(grp, m, "ignore_error", "warning", oneLine(m.text) || "A file is excluded by .aihydroignore")
				return
			case "shell_integration_warning":
			case "shell_integration_warning_with_suggestion":
				lift(grp, m, "shell_integration", "warning", oneLine(m.text) || "Shell integration warning")
				return
			case "info": {
				const notice = m.infoNotice ?? classifyLegacyInfoNotice(m.text)
				if (isLiftedNotice(notice)) {
					const reason: LiftReason =
						notice.class === "unclassified"
							? "unrecognised_info"
							: notice.class === "context_truncated"
								? "context_truncated"
								: "info_notice"
					lift(grp, m, reason, "warning", oneLine(m.text) || "Notice")
				}
				return
			}
			case "mcp_notification":
				if (isElevatedMcpLevel(m.mcpLevel)) {
					lift(grp, m, "mcp_notification", "warning", `MCP ${m.mcpLevel}: ${oneLine(m.text, 160)}`)
				}
				return
			case "mcp_server_response": {
				const callTs = outstandingCalls.shift()
				const found = inspectResult(m.text)
				if (found.reused) {
					grp.reuseCount++
				}
				if (callTs === undefined) {
					lift(grp, m, "unpaired_result", "warning", "A tool result arrived with no matching call")
				}
				for (const r of found.reasons) {
					lift(grp, m, r.reason, r.tone, r.text, callTs)
				}
				return
			}
			case "checkpoint_created":
				grp.rewindTs = m.ts
				if (m.isCheckpointCheckedOut) {
					lift(grp, m, "checkpoint_checked_out", "notice", "Workspace files are restored to this checkpoint")
				}
				return
			case "tool":
				if (isCondenseTool(m)) {
					lift(grp, m, "context_condensed", "notice", "Context condensed")
				}
				return
			default:
				return
		}
	})

	closeAll()

	// Final audits whose answer is not in the list stay visible rather than vanishing.
	for (const [answerTs] of auditByAnswerTs) {
		if (!claimedAudits.has(answerTs)) {
			const row = messages.find((x) => x.say === "answer_audit" && parseAnswerAuditPayload(x.text)?.answerTs === answerTs)
			if (row) {
				const at = items.findIndex((it) => (it.kind === "group" ? it.startTs : it.ts) > row.ts)
				const item: Passthrough = {
					kind: "passthrough",
					key: uniqueKey(`passthrough:${row.ts}`),
					ts: row.ts,
					messages: [row],
				}
				items.splice(at === -1 ? items.length : at, 0, item)
			}
		}
	}

	// At `normal` detail the live tail group starts open.
	if (options.detail === "normal") {
		const last = items[items.length - 1]
		if (last?.kind === "group") {
			last.open = true
		}
	}
	return items
}
