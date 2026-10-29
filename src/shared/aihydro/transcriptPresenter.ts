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
import type { AiHydroAsk, AiHydroMessage, AiHydroSay, AiHydroSayTool } from "../ExtensionMessage"
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
	 * Facts a message does not carry. Both are optional and FAIL SAFE: absent (or, for `effectClassFor`, returning
	 * undefined) means "unknown", and unknown lifts. Without `effectClassFor` every MCP call is lifted as effect-class
	 * unknown; without `isProtectedPath` every write-type native call that names a path is lifted. A2 supplies both
	 * from MCP annotations/trust and the protected-root list to narrow the lifting to what is actually risky.
	 *
	 * Resolver contract: `effectClassFor` must return the REAL effect class derived from the server's own annotations,
	 * and only for a trusted server (return undefined when the server is untrusted or has no annotations). Only
	 * DESTRUCTIVE and UNKNOWN lift: a resolver that answers WRITE or NETWORK folds the call, so returning those for an
	 * unverified server would hide it. A resolver that throws is treated as UNKNOWN (the call lifts); it never
	 * crashes the render.
	 */
	effectClassFor?: (
		message: AiHydroMessage,
	) => "READ" | "WRITE" | "NETWORK" | "DESTRUCTIVE" | "UNKNOWN" | "UNVERIFIED" | undefined
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
	| "no_decision"
	| "result_uninspected"
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
	/** How many source lines this line stands for (1 unless aggregated). */
	count: number
	/** The MCP server an effect line is about (set on effect lines only). */
	server?: string
	/**
	 * Every source line folded into this one, in order. A line always has at least itself; every lifted source `ts`
	 * of a group appears in exactly one line's `members` (across `lifted` and `absorbed`), so aggregation can shorten
	 * the list but never drop a fact.
	 */
	members: LiftMember[]
}

export interface LiftMember {
	text: string
	sourceTs: number
	callTs?: number
}

export type CostLabel =
	| { status: "none"; usd: null; label: "" }
	| { status: "exact"; usd: number; label: string }
	| { status: "lower-bound"; usd: number; label: string }
	| { status: "unavailable"; usd: null; label: string }
	| { status: "unrecorded"; usd: null; label: "no cost recorded" }

export interface HeaderFacts {
	/** Span of the group minus time spent waiting on the user (ms, from message timestamps). */
	agentMs: number
	/** Time between an answered approval ask and the next message (ms). */
	waitingMs: number
	/** Calls only (command, file/native tool, MCP tool). Requests, reasoning and checkpoints are not counted. */
	toolCount: number
	/** Calls that did not run: denied, or asked with no decision recorded. Not part of `toolCount`. */
	notRunCount: number
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
	/**
	 * Focus only: missing-fact notices (an MCP call whose server declares no effect) that are counted in the header
	 * instead of taking a row of their own. They are listed in full when the group is expanded and counted in
	 * `facts.liftedCount`. Always empty at Normal; never holds an error, refusal, denial, exit code or security finding.
	 */
	absorbed: LiftedLine[]
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

/** Containers deeper than this, or more nodes than NODE_BUDGET, are not inspected: the result is then lifted as such. */
const MAX_DEPTH = 8
const NODE_BUDGET = 100_000
const FAILURE_STATUSES = new Set(["failed", "error", "cancelled", "canceled", "corrupt", "timeout", "timed_out", "unavailable"])
const FAILURE_TEXT = /^(?:(?:error|failed|mcp error)\b|\[error\]|traceback \(most recent call last\))/i

const truthyError = (v: unknown) => v !== undefined && v !== null && v !== false && v !== "" && v !== 0
const lc = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : undefined)

interface ResultFindings {
	reasons: Array<{ reason: LiftReason; tone: LiftedLine["tone"]; text: string }>
	reused: boolean
}

/** True for an array of numbers, or an array whose elements are all arrays of numbers. */
function isNumericBlock(a: unknown[]): boolean {
	if (a.length === 0) {
		return false
	}
	if (a.every((x) => typeof x === "number")) {
		return true
	}
	return a.every((x) => Array.isArray(x) && x.every((y) => typeof y === "number"))
}

/** Visits every key at every depth, arrays included. Returns false when the depth or node bound stopped the walk. */
function walk(root: unknown, visit: (key: string, value: unknown) => void): boolean {
	let nodes = 0
	let complete = true
	const go = (v: unknown, depth: number) => {
		if (!Array.isArray(v) && !isRecord(v)) {
			return
		}
		if (depth > MAX_DEPTH || ++nodes > NODE_BUDGET) {
			complete = false
			return
		}
		if (Array.isArray(v)) {
			if (isNumericBlock(v)) {
				return // coordinates and scalar table rows hold no keys to check; they do not use the node budget
			}
			for (const x of v) {
				go(x, depth + 1)
			}
			return
		}
		for (const [k, x] of Object.entries(v)) {
			visit(k, x)
			go(x, depth + 1)
		}
	}
	go(root, 0)
	return complete
}

/**
 * What an MCP result says about itself. Generic shapes only, checked at every depth (arrays included):
 *   error: `isError: true`, a truthy `error`, `ok: false`, `success: false`, `status` (case-insensitive) in
 *   failed/error/cancelled/canceled/corrupt/timeout/timed_out/unavailable; a body starting (case-insensitively) with
 *   "Error", "Failed", "[ERROR]", "MCP error" or a Python traceback. Also: `blocking` true/"true", `area_check`
 *   fail/failed, refusal and provisional data from the tool-call presenter.
 * Intentionally NOT recognised: failure words that are not at the start of a plain-text body, bare HTTP status
 * numbers or `code` fields, `warnings` lists, `partial: true`, JSON encoded inside a string value, and `status`
 * values outside the list above. A result the walk could not finish (too deep or too large) is lifted as
 * "result_uninspected" rather than assumed fine. Reuse is only `_cached === true` or `reused === true` at the top
 * level or directly under `data`, so a column named `reused` in user data is not counted.
 */
export function inspectResult(text: string | undefined): ResultFindings {
	const out: ResultFindings = { reasons: [], reused: false }
	const add = (reason: LiftReason, tone: LiftedLine["tone"], t: string) => {
		if (!out.reasons.some((r) => r.reason === reason)) {
			out.reasons.push({ reason, tone, text: t })
		}
	}
	const trimmed = (text ?? "").replace(/^[\s\uFEFF]+/, "")
	if (FAILURE_TEXT.test(trimmed)) {
		add(
			"mcp_error",
			"error",
			oneLine(trimmed.replace(/^(?:error|failed|mcp error)\W*/i, ""), 160) || "Tool returned an error",
		)
	}
	let body: unknown
	try {
		body = JSON.parse(trimmed)
	} catch {
		return out
	}
	if (!isRecord(body) && !Array.isArray(body)) {
		return out
	}
	const complete = walk(body, (k, v) => {
		switch (k) {
			case "isError":
				if (v === true) {
					add("mcp_error", "error", "Tool reported an error")
				}
				break
			case "error":
				if (truthyError(v)) {
					add(
						"mcp_error",
						"error",
						`Tool error: ${v === true ? "reported" : oneLine(typeof v === "string" ? v : JSON.stringify(v), 160)}`,
					)
				}
				break
			case "ok":
			case "success":
				if (v === false) {
					add("mcp_error", "error", `Tool reported ${k}: false`)
				}
				break
			case "status": {
				const st = lc(v)
				if (st && FAILURE_STATUSES.has(st)) {
					add("mcp_error", "error", `Tool reported status: ${st}`)
				}
				break
			}
			case "blocking":
				if (v === true || lc(v) === "true") {
					add("blocking", "warning", "A result is marked blocking")
				}
				break
			case "area_check": {
				const st = lc(v)
				if (st === "fail" || st === "failed") {
					add("area_check_failed", "warning", "Basin area check failed")
				}
				break
			}
		}
	})
	if (!complete) {
		add("result_uninspected", "warning", "Result too large or deep to check for failures")
	}
	const top = isRecord(body) ? body : {}
	const data = isRecord(top.data) ? top.data : {}
	out.reused = [top, data].some((o) => o._cached === true || o.reused === true)
	const model = presentToolCall("", "", undefined, text)
	if (model.refusal) {
		// A refusal is the specific form of an error: one failure, one line.
		out.reasons = out.reasons.filter((r) => r.reason !== "mcp_error")
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
	let unpriced = 0
	let unavailable = 0
	let lower = false
	for (const r of rows) {
		if (r.status === "unavailable") {
			unavailable++
			unpriced++
		} else if (typeof r.cost !== "number" || !(r.cost > 0)) {
			unpriced++ // missing or zero: the host recorded no cost for this request
		} else {
			known++
			usd += r.cost
			lower = lower || r.status === "lower-bound"
		}
	}
	if (known === 0) {
		return unavailable > 0
			? { status: "unavailable", usd: null, label: "cost unavailable (pricing not verified)" }
			: { status: "unrecorded", usd: null, label: "no cost recorded" }
	}
	const fixed = `$${usd.toFixed(4)}`
	if (unpriced > 0 || lower) {
		return {
			status: "lower-bound",
			usd,
			label: `\u2265${fixed} (${unpriced > 0 ? `${unpriced} request${unpriced === 1 ? "" : "s"} unpriced` : "cache tokens unpriced"})`,
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
	notRunCount: number
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
	notRunCount: 0,
	costRows: [],
	requestCount: 0,
	retryCount: 0,
	failedRequestCount: 0,
	reuseCount: 0,
})

// ── Aggregation (X1-C1) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Why a lifted line may be merged with others. Only these families merge, and only with lines of the same family:
 *  - an MCP call whose server declares no effect (`unknown:`), or declares one it is not trusted for (`unverified:`),
 *    per server: a server fact, said once;
 *  - a command run under a non-protected-path policy class (`policy:`), per class;
 *  - an ask with no decision recorded.
 * Everything else (errors, refusals, denials, non-zero exits, protected paths, outside-workspace and DESTRUCTIVE
 * findings, limits, truncation, cancellations ...) has no entry and is one line per fact at every level.
 */
interface AggInfo {
	family: string
	/** What the call was, for the merged text. */
	subject: string
	server?: string
	policyClass?: string
}

const MAX_NAMED = 3

function serverOf(m: AiHydroMessage): string {
	const name = parseObject(m.text)?.serverName
	return typeof name === "string" && name.trim() ? name.trim() : "an MCP server"
}
function toolOf(m: AiHydroMessage, fallback: string): string {
	const o = parseObject(m.text)
	const t = o?.toolName ?? o?.uri
	return typeof t === "string" && t ? t : fallback
}

function nameList(subjects: string[]): string {
	const uniq = [...new Set(subjects)]
	const named = uniq.slice(0, MAX_NAMED).join(", ")
	return uniq.length > MAX_NAMED ? `${named}, +${uniq.length - MAX_NAMED}` : named
}

function mergedText(reason: LiftReason, infos: AggInfo[], verb: string): string {
	const n = infos.length
	const subjects = infos.map((i) => i.subject)
	const names = nameList(subjects)
	if (reason === "approved_security") {
		const server = infos[0].server ?? "an MCP server"
		return infos[0].family.startsWith("unverified:")
			? `${server}: effect unverified, server not trusted (${n} calls: ${names})`
			: `${server} declares no effect hints (${n} calls: ${names})`
	}
	if (reason === "policy_command") {
		return `${verb} ${n} commands (${(infos[0].policyClass ?? "policy").replace(/_/g, " ")}): ${names}`
	}
	return `${n} asks with no decision recorded: ${names}`
}

/**
 * Merge same-family lines (two or more) into one line with a count and every member listed. At Focus a lone or merged
 * "effect not declared" notice leaves the row list and is counted in the header (`absorbed`) instead; it stays in
 * `facts.liftedCount` and in the expansion. Order is the order of each family's first member.
 */
function aggregateLifts(
	lifted: readonly LiftedLine[],
	info: ReadonlyMap<string, AggInfo>,
	detail: DetailLevel,
): { shown: LiftedLine[]; absorbed: LiftedLine[] } {
	const byFamily = new Map<string, LiftedLine[]>()
	for (const l of lifted) {
		const f = info.get(l.key)?.family
		if (f !== undefined) {
			byFamily.set(f, [...(byFamily.get(f) ?? []), l])
		}
	}
	const shown: LiftedLine[] = []
	const absorbed: LiftedLine[] = []
	const done = new Set<string>()
	for (const l of lifted) {
		const a = info.get(l.key)
		let out = l
		if (a?.server !== undefined) {
			out = { ...l, server: a.server }
		}
		if (a !== undefined) {
			if (done.has(a.family)) {
				continue
			}
			done.add(a.family)
			const same = byFamily.get(a.family) ?? [l]
			if (same.length >= 2) {
				const infos = same.map((x) => info.get(x.key) as AggInfo)
				out = {
					key: `agg:${a.family}`,
					reason: l.reason,
					tone: l.tone,
					text: mergedText(l.reason, infos, same[0].text.startsWith("You approved") ? "You approved" : "Ran"),
					sourceTs: l.sourceTs,
					...(a.server !== undefined ? { server: a.server } : {}),
					count: same.length,
					members: same.flatMap((x) => x.members),
				}
			}
		}
		if (detail === "focus" && a !== undefined && a.family.startsWith("unknown:")) {
			absorbed.push(out)
		} else {
			shown.push(out)
		}
	}
	return { shown, absorbed }
}

const READ_ONLY_NATIVE_TOOLS: ReadonlySet<string> = new Set([
	"readFile",
	"listFilesTopLevel",
	"listFilesRecursive",
	"listCodeDefinitionNames",
	"searchFiles",
	"webFetch",
	"summarizeTask",
] satisfies AiHydroSayTool["tool"][])

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
			g.lifted
				.filter(
					(l) =>
						l.callTs !== undefined &&
						(l.reason === "mcp_error" ||
							l.reason === "refusal" ||
							(l.reason !== "call_failed" && l.tone === "error")),
				)
				.map((l) => l.callTs),
		)
		const lifted = g.lifted.filter((l) => !(l.reason === "call_failed" && resultCalls.has(l.callTs)))
		const { shown, absorbed } = aggregateLifts(lifted, aggInfo, options.detail)
		const startTs = g.members[0]?.ts ?? shown[0]?.sourceTs ?? absorbed[0].sourceTs
		const endTs = g.members.length ? g.members[g.members.length - 1].ts : startTs
		const span = Math.max(0, endTs - startTs)
		const waitingMs = Math.min(g.waitingMs, span)
		items.push({
			kind: "group",
			key: uniqueKey(`group:${startTs}`),
			startTs,
			endTs,
			members: g.members,
			lifted: shown,
			absorbed,
			rewindTs: g.rewindTs,
			open: false,
			facts: {
				agentMs: span - waitingMs,
				waitingMs,
				toolCount: g.toolCount,
				notRunCount: g.notRunCount,
				cost: costLabel(g.costRows),
				requestCount: g.requestCount,
				retryCount: g.retryCount,
				failedRequestCount: g.failedRequestCount,
				reuseCount: g.reuseCount,
				revisionCount: 0,
				liftedCount: shown.reduce((n, l) => n + l.count, 0) + absorbed.reduce((n, l) => n + l.count, 0),
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
		agg?: AggInfo,
	) => {
		const key = `${reason}:${m.ts}:${curIndex}`
		if (!grp.lifted.some((l) => l.key === key)) {
			grp.lifted.push({
				key,
				reason,
				tone,
				text,
				sourceTs: m.ts,
				...(callTs !== undefined ? { callTs } : {}),
				count: 1,
				members: [{ text, sourceTs: m.ts, ...(callTs !== undefined ? { callTs } : {}) }],
			})
			if (agg) {
				aggInfo.set(key, agg)
			}
		}
	}
	/** Why a line may be aggregated, by line key. A line with no entry is never merged. */
	const aggInfo = new Map<string, AggInfo>()

	let curIndex = 0
	// Native tools known to only read. Anything else that names a path is treated as a possible write.
	const isReadOnlyTool = (info: Json) => READ_ONLY_NATIVE_TOOLS.has(String(info.tool ?? ""))
	/** A resolver that throws is "unknown": the call lifts and the render survives. */
	const protectedPath = (p: string): boolean => {
		try {
			return options.isProtectedPath ? options.isProtectedPath(p) : false
		} catch {
			return true
		}
	}
	const effectOf = (m: AiHydroMessage): string | undefined => {
		try {
			return options.effectClassFor?.(m)
		} catch {
			return "UNKNOWN"
		}
	}

	/**
	 * Why an approval/run is security-relevant. "security": a policy class, an operation outside the workspace, a
	 * protected path or a DESTRUCTIVE effect. "unknown_effect": nothing but an effect class the server did not declare
	 * (an MCP call with no usable annotations): still lifted (never hidden), but it is a missing fact, not a finding,
	 * so it gets a neutral tone.
	 */
	const securityReason = (m: AiHydroMessage): "security" | "unknown_effect" | "unverified_effect" | undefined => {
		if (m.policyClass || m.isOperationOutsideWorkspace) {
			return "security"
		}
		const info = toolInfo(m)
		if (info) {
			if (info.operationIsLocatedInWorkspace === false) {
				return "security"
			}
			const path = typeof info.path === "string" ? info.path : typeof info.filePath === "string" ? info.filePath : undefined
			if (path !== undefined) {
				// Fail safe: with no path resolver anything not known to be read-only that names a path lifts.
				if (options.isProtectedPath ? protectedPath(path) : !isReadOnlyTool(info)) {
					return "security"
				}
			}
		}
		const effect = effectOf(m)
		if (effect === "DESTRUCTIVE") {
			return "security"
		}
		if (effect === "UNVERIFIED") {
			// The server declared annotations but is not trusted: they are not believed (and never fold a call).
			return "unverified_effect"
		}
		if (effect === "UNKNOWN") {
			return "unknown_effect"
		}
		// No annotations to read means the effect class is UNKNOWN, which lifts.
		return effect === undefined && kindOf(m) === "use_mcp_server" ? "unknown_effect" : undefined
	}
	const securityMarked = (m: AiHydroMessage): boolean => securityReason(m) !== undefined
	/**
	 * A per-item risk flag. A line for such an item is never aggregated (one line per call, the risk named in its text),
	 * whatever its family: merging would hide it behind a count or a "+N".
	 */
	const perItemRisk = (m: AiHydroMessage): string | undefined => {
		const info = toolInfo(m)
		if (m.isOperationOutsideWorkspace || info?.operationIsLocatedInWorkspace === false) {
			return "outside the workspace"
		}
		if (effectOf(m) === "DESTRUCTIVE") {
			return "destructive"
		}
		const path = typeof info?.path === "string" ? info.path : typeof info?.filePath === "string" ? info.filePath : undefined
		if (info && path !== undefined && (options.isProtectedPath ? protectedPath(path) : !isReadOnlyTool(info))) {
			return "touches a path"
		}
		return undefined
	}

	// Tasks from before the host recorded outcomes cannot say "no decision recorded": an ask without an outcome is
	// just old data there, shown neutrally and counted as a call.
	const recordedEra = messages.some((x) => x.askOutcome !== undefined || x.execOutcome !== undefined)

	const lastIndex = messages.length - 1
	messages.forEach((m, index) => {
		curIndex = index
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
					// A `pending` row holds the unchecked draft until the gate reveals it: it renders as nothing, is not a
					// revision, and neither breaks nor splits a group (no lifted line, no member, no item).
					if (parseObject(m.text)?.stage === "pending") {
						return
					}
					closeAll()
					const p = parseAnswerAuditPayload(m.text)
					if (!p) {
						items.push({ kind: "passthrough", key: uniqueKey(`passthrough:${m.ts}`), ts: m.ts, messages: [m] })
					} else if (p.stage === "final") {
						// Attached to its answer (or surfaced after the loop if the answer is not in the list).
					} else {
						const interrupted = p.stage === "interrupted"
						const prev = items[items.length - 1]
						// Only a rejected draft (stage "revision") is a revision; an interrupted audit is not.
						if (prev?.kind === "group" && p.stage === "revision") {
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

		if (isCallKind(kind) && !isCondenseTool(m)) {
			const state = deriveCallState(m, messages)
			const what = describeCall(m)
			if (kind === "use_mcp_server") {
				outstandingCalls.push(m.ts)
			}
			// An approval ask nobody answered: it may never have run, so it is neither counted as a call nor as waiting.
			const undecided = recordedEra && m.type === "ask" && !m.askOutcome && state === "unknown"
			const denied = m.askOutcome === "denied" || state === "denied"
			if (isApprovalAsk(m) && !undecided) {
				const next = messages[index + 1]
				if (next && next.ts >= m.ts) {
					grp.waitingMs += next.ts - m.ts
				}
			}
			if (undecided || denied) {
				grp.notRunCount++
			} else {
				grp.toolCount++
			}
			if (undecided) {
				const risk = perItemRisk(m)
				lift(
					grp,
					m,
					"no_decision",
					"notice",
					`Asked to ${what}${risk ? ` (${risk})` : ""}; no decision recorded`,
					m.ts,
					risk ? undefined : { family: "no_decision", subject: what },
				)
			} else if (denied) {
				lift(grp, m, "call_denied", "warning", `You denied: ${what}`, m.ts)
			} else if (kind === "command" && typeof m.exitCode === "number" && m.exitCode !== 0) {
				lift(grp, m, "exit_nonzero", "error", `Exited with code ${m.exitCode}: ${what}`, m.ts)
			} else if (kind === "command" && (m.exitCode === "unknown" || m.execOutcome === "unknown")) {
				lift(grp, m, "exit_unknown", "warning", `Exit code unknown: ${what}`, m.ts)
			} else if (m.execOutcome === "failed" || state === "failed") {
				lift(grp, m, "call_failed", "error", `Failed: ${what}`, m.ts)
			} else if (m.policyClass) {
				const risk = perItemRisk(m)
				lift(
					grp,
					m,
					"policy_command",
					"warning",
					`${m.type === "ask" ? "You approved" : "Ran"} (${m.policyClass.replace(/_/g, " ")}${risk ? `, ${risk}` : ""}): ${what}`,
					m.ts,
					// A protected path or any per-item risk is a finding in itself: one line per call, never merged.
					m.policyClass === "protected_path" || risk
						? undefined
						: { family: `policy:${m.type}:${m.policyClass}`, subject: what, policyClass: m.policyClass },
				)
			} else if (securityReason(m) === "unverified_effect") {
				lift(
					grp,
					m,
					"approved_security",
					"notice",
					`${m.type === "ask" ? "You approved" : "Ran"} (effect unverified: server not trusted): ${what}`,
					m.ts,
					{ family: `unverified:${m.type}:${serverOf(m)}`, subject: toolOf(m, what), server: serverOf(m) },
				)
			} else if (securityReason(m) === "unknown_effect") {
				lift(
					grp,
					m,
					"approved_security",
					"notice",
					`${m.type === "ask" ? "You approved" : "Ran"} (effect not declared by the server): ${what}`,
					m.ts,
					{ family: `unknown:${m.type}:${serverOf(m)}`, subject: toolOf(m, what), server: serverOf(m) },
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
				} else if (reason !== undefined && reason !== null) {
					// A reason this version does not know: show it rather than assume it was benign.
					lift(grp, m, "request_failed", "warning", `Request ended: ${oneLine(String(reason), 80)}`)
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
