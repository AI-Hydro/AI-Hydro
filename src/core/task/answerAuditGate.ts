import { createHash } from "node:crypto"
import {
	AUDIT_PROGRESS_CHECKING,
	capDraft,
	cumulativeDropped,
	type DroppedEvidence,
	diffDroppedEvidence,
	extractQuantities,
	isAuditProgressText,
	isOlderNarrationOnly,
	splitAuditProse,
} from "@shared/aihydro/answerAuditGate"
import { isServerTrusted } from "@shared/aihydro/firstPartyServers"
import {
	ANSWER_AUDIT_PAYLOAD_VERSION,
	type AnswerAuditDisclosure,
	type AnswerAuditGateSkip,
	type AnswerAuditPayload,
	type AnswerAuditViolation,
	type AnswerRevisionEvent,
	MAX_AUDIT_REVISIONS,
} from "@shared/aihydro/transcriptContracts"
import type { McpServer } from "@shared/mcp"
import { formatResponse } from "../prompts/responses"
import {
	AUDIT_TOOL_NAME,
	type AuditHub,
	type FinalAnswerAuditOutcome,
	runFinalAnswerAudit,
	toAnswerAuditPayload,
} from "./finalAnswerAudit"
import { isAiHydroServerName } from "./tools/handlers/aiHydroServer"

/**
 * Pre-completion answer-audit gate (W2-C).
 *
 * When eligible, the answer an agent proposes via `attempt_completion` is audited BEFORE the user sees it. A graded
 * audit with hard findings sends the model one non-error revision request (at most MAX_AUDIT_REVISIONS per
 * completion cycle); whatever remains is shown with a stated disclosure. Mechanism, not prompt: nothing here depends
 * on tool names beyond the audit and start_session tools, and every non-success exit reveals the hidden draft.
 *
 * Scope rule: the gate acts only on a GRADED outcome with hardCount > 0. Legacy, unavailable and skipped audits are
 * never gated. Eligibility is computed from cached, in-memory state only (no I/O) so a task that is not eligible
 * streams exactly as before with no added latency.
 */

/** Overall budget for the gate (status + audit calls, all revision rounds' audits counted individually). */
export const GATE_DEADLINE_MS = 45_000
export const START_SESSION_TOOL_NAME = "start_session"
export const PLAN_RESPOND_TOOL_NAME = "plan_mode_respond"

export interface HiddenDraft {
	text: string
	hash: string
	/** 0 = the model's first draft of this cycle; n = the draft after n revision requests. */
	attempt: number
	ts: number
	/** Audit outcome for this draft when one completed (a rejected draft awaiting its revision). */
	outcome?: FinalAnswerAuditOutcome
	/** The draft was rejected: it has an event in `history` (and a persisted revision row). */
	inHistory?: boolean
}

/** Per-task gate state (lives on TaskState). All fields are caches or cycle counters. */
export interface AnswerAuditGateState {
	/** Revision requests made in this completion cycle. Reset on user feedback, a new task, or a reveal. */
	revisions: number
	history: AnswerRevisionEvent[]
	previousProse?: string
	/** The first draft of this cycle (for the cumulative removed-value disclosure). */
	firstProse?: string
	hidden?: HiddenDraft
	/** Study id verified as bound to this chat by an earlier status call (refreshed on start_session). */
	boundStudyId?: string
	/** A first-party chat status ran in this task (a resumed task). Makes the gate eligible; never supplies a study id. */
	bindingProbed?: boolean
	/**
	 * A first-party tool result in this task carried a `session_binding` for THIS chat (any tool: delineation binds a
	 * study too, `bound_by: auto_create`). Like `bindingProbed` it is a flag, never a study id.
	 */
	bindingObserved?: boolean
	/** A first-party start_session succeeded in this task: a study is (very likely) bound. */
	sessionStarted: boolean
	/** A graded audit outcome was observed in this task, so the server speaks the graded schema. */
	gradedObserved: boolean
	/** Eligibility decided before streaming the current attempt_completion block; reused by execute(). */
	eligibleForBlock?: boolean
	/** The server the eligibility check chose: the gate audits on exactly this one and requires it to be trusted. */
	eligibleServer?: string
	/** Why the gate did not run for the current completion attempt (set by the eligibility check, shown on the answer). */
	skipReason?: AnswerAuditGateSkip
	/** Why the task was interrupted (set by the caller of abortTask: "stopped by user" is the default). */
	interruptReason?: string
}

export function createGateState(): AnswerAuditGateState {
	return { revisions: 0, history: [], sessionStarted: false, gradedObserved: false }
}

/** End the completion cycle: counters and draft records are dropped, caches (bound study, schema) are kept. */
export function resetGateCycle(state: AnswerAuditGateState): void {
	state.revisions = 0
	state.history = []
	state.previousProse = undefined
	state.firstProse = undefined
	state.hidden = undefined
	state.eligibleForBlock = undefined
}

/** A first-party `start_session` ran: study binding may have changed, so forget what was cached about it. */
export function noteSessionStarted(state: AnswerAuditGateState): void {
	state.boundStudyId = undefined
	state.sessionStarted = true
}

/**
 * A first-party `aihydro_chat_status` ran in this task, so the model has been told about the binding. It is NOT a
 * study id: the call is model-invoked, so its output is not taken as host evidence of which study is bound. (Current tools
 * servers refuse a differing `chat_id` with CHAT_ID_MISMATCH, so a spoof would not work there; this holds against any server.) The flag only makes a resumed task eligible; the audit then asks the server
 * itself, with the host-issued chat id (`runFinalAnswerAudit` makes its own `aihydro_chat_status` call), and fails
 * closed if no study is bound or the audited session differs.
 */
export function noteBindingProbed(state: AnswerAuditGateState): void {
	state.bindingProbed = true
}

/**
 * A first-party tool result carried a `session_binding` for this chat: the server itself reports a study bound
 * (`start_session`, `delineate_watershed` with `bound_by: auto_create`, ...). Model-invoked output again, so it is a flag only
 * and the audit still asks the server with the host's chat id and fails closed.
 */
export function noteBindingObserved(state: AnswerAuditGateState): void {
	state.bindingObserved = true
}

/** `aihydro_rebind_chat` ran: whatever study was cached may no longer be bound. */
export function noteBindingChanged(state: AnswerAuditGateState): void {
	state.boundStudyId = undefined
}

// ── Eligibility ───────────────────────────────────────────────────────────────────────────────────────────────────

export type GateIneligibleReason = AnswerAuditGateSkip | "not-attempt-completion"

export interface GateEligibility {
	eligible: boolean
	reason?: GateIneligibleReason
	serverName?: string
}

/** True when the server's audit tool description reads like the graded (2.6.0+) tool: it speaks of advisories. */
export function auditToolAdvertisesGraded(server: Pick<McpServer, "tools">): boolean {
	const tool = server.tools?.find((t) => t.name === AUDIT_TOOL_NAME)
	return !!tool && /\badvisor(?:y|ies)\b/i.test(tool.description ?? "")
}

export function computeGateEligibility(input: {
	toolName?: string
	mode: string | undefined
	gateSetting: boolean | undefined
	auditEnabled: boolean | undefined
	servers: readonly McpServer[]
	state: AnswerAuditGateState
	isTrusted?: (server: McpServer) => boolean
	/** The host's own record says a study is bound to this chat (the chip; a boolean, never a study id). */
	hostBound?: boolean
}): GateEligibility {
	if (input.toolName && input.toolName !== "attempt_completion") {
		return { eligible: false, reason: "not-attempt-completion" } // plan_mode_respond is never gated
	}
	if (input.gateSetting !== true) {
		return { eligible: false, reason: "gate-setting-off" }
	}
	if (input.auditEnabled === false) {
		return { eligible: false, reason: "audit-disabled" }
	}
	if (input.mode === "plan") {
		return { eligible: false, reason: "plan-mode" }
	}
	const trusted = input.isTrusted ?? ((s: McpServer) => isServerTrusted(s as any))
	const server = input.servers.find((s) => isAiHydroServerName(s.name) && s.status === "connected" && !s.disabled && trusted(s))
	if (!server) {
		return { eligible: false, reason: "no-trusted-server" }
	}
	if (!server.tools?.some((t) => t.name === AUDIT_TOOL_NAME)) {
		return { eligible: false, reason: "no-audit-tool" }
	}
	if (!input.state.gradedObserved && !auditToolAdvertisesGraded(server)) {
		return { eligible: false, reason: "graded-schema-unknown" }
	}
	const s = input.state
	if (!s.boundStudyId && !s.sessionStarted && !s.bindingProbed && !s.bindingObserved && !input.hostBound) {
		return { eligible: false, reason: "study-not-bound" }
	}
	return { eligible: true, serverName: server.name }
}

// ── The gate ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GateRow {
	type?: string
	say?: string
	ask?: string
	text?: string
	partial?: boolean
}

export interface GateContext {
	state: AnswerAuditGateState
	hub: AuditHub
	ulid: string
	workspaceRoot: string | undefined
	modelId?: string
	/** The chat's project (`_meta.project_id`, X1-P1), when it has one. */
	projectId?: string
	/** The attempt_completion `result`. */
	result: string
	rows(): readonly GateRow[]
	/** Persist one `answer_audit` row (replacing any progress line). */
	emit(payload: AnswerAuditPayload): Promise<void>
	/** Show or update the single activity line; passing undefined removes it. */
	setProgress(text: string | undefined): Promise<void>
	/** A message the user typed while the gate was running (consumed), if any. */
	takeUserMessage(): { text?: string; images?: string[]; files?: string[] } | undefined
	isAborted(): boolean
	/** The server judged eligible; the audit runs on it, and it must be trusted. */
	serverName?: string
	/** Test seams. */
	now?: () => number
	deadlineMs?: number
	runAudit?: typeof runFinalAnswerAudit
}

export type GateDecision =
	| { kind: "revise"; feedback: string; attempt: number }
	| { kind: "user_feedback"; text?: string; images?: string[]; files?: string[] }
	| { kind: "aborted" }
	| {
			kind: "accept"
			outcome: FinalAnswerAuditOutcome
			/** Silent revisions that preceded the shown answer. */
			attempt: number
			history: AnswerRevisionEvent[]
			dropped?: DroppedEvidence
			/** Findings only in earlier-turn narration: disclosed, never revisable (B1). */
			unrevisable: AnswerAuditViolation[]
			disclosure?: AnswerAuditDisclosure
			/** The audited text (narration + result): the draft the payload describes. */
			prose: string
	  }

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

function hardOf(violations: readonly AnswerAuditViolation[]): AnswerAuditViolation[] {
	return violations.filter((v) => v.severity === "hard")
}

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
	let timer: NodeJS.Timeout | undefined
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms))
	})
	return Promise.race([p, timeout]).finally(() => timer && clearTimeout(timer))
}

/** Event record for one rejected (or shown) draft; draft text is capped per the contract. */
function eventFor(
	attempt: number,
	ts: number,
	prose: string,
	hash: string,
	outcome: FinalAnswerAuditOutcome,
	dropped: DroppedEvidence | undefined,
): AnswerRevisionEvent {
	const payload = toAnswerAuditPayload(outcome, { stage: "revision", attempt, answerTs: ts, answer: prose })
	return {
		attempt,
		ts,
		hardCount: payload.hardCount,
		advisoryCount: payload.advisoryCount,
		violations: payload.violations,
		draftHash: hash,
		...capDraft(prose),
		...(dropped?.droppedQuantities.length ? { droppedQuantities: dropped.droppedQuantities } : {}),
		...(dropped?.droppedClaimMarkers.length ? { droppedClaimMarkers: dropped.droppedClaimMarkers } : {}),
	}
}

/**
 * Evaluate the model's current draft. Never throws for audit failures: an unavailable audit is an accepted outcome
 * shown with its disclosure, so the gate can delay an answer but never swallow one.
 */
export async function evaluateDraft(ctx: GateContext): Promise<GateDecision> {
	const { state } = ctx
	const now = ctx.now ?? Date.now
	const started = now()
	const deadlineMs = ctx.deadlineMs ?? GATE_DEADLINE_MS
	const runAudit = ctx.runAudit ?? runFinalAnswerAudit

	const split = splitAuditProse(ctx.rows(), ctx.result)
	const prose = split.full
	const hash = sha256(prose)
	const attemptIndex = state.revisions
	state.hidden = { text: prose, hash, attempt: attemptIndex, ts: started }
	state.firstProse ??= prose

	const userMessage = () => ctx.takeUserMessage()
	let typed = userMessage()
	if (typed) {
		return { kind: "user_feedback", ...typed }
	}

	// Persist the draft, hidden, BEFORE auditing it: a reload during the audit can then reveal it (F3).
	await ctx.emit({
		...toAnswerAuditPayload(
			{ status: "unavailable", reason: "audit pending" },
			{ stage: "pending", attempt: attemptIndex, answerTs: started, answer: prose },
		),
		...capDraft(prose),
	})
	await ctx.setProgress(AUDIT_PROGRESS_CHECKING)
	const timeoutNote = `timed out after ${Math.round(deadlineMs / 1000)}s`
	const outcome = await withDeadline(
		runAudit({
			hub: ctx.hub,
			ulid: ctx.ulid,
			workspaceRoot: ctx.workspaceRoot,
			answer: prose,
			modelIdReturned: ctx.modelId,
			projectId: ctx.projectId,
			timeoutMs: Math.max(1, deadlineMs - (now() - started)),
			boundStudy: state.boundStudyId,
			serverName: ctx.serverName,
			requireTrusted: true,
		}).catch(
			(error): FinalAnswerAuditOutcome => ({
				status: "unavailable",
				reason: error instanceof Error ? error.message : String(error),
			}),
		),
		deadlineMs,
		(): FinalAnswerAuditOutcome => ({ status: "unavailable", reason: timeoutNote }),
	)

	if (ctx.isAborted()) {
		return { kind: "aborted" }
	}
	typed = userMessage()
	if (typed) {
		return { kind: "user_feedback", ...typed }
	}

	if (outcome.status === "passed" || outcome.status === "violations") {
		if (outcome.sessionId) {
			state.boundStudyId = outcome.sessionId
		}
		if (outcome.schema === "graded") {
			state.gradedObserved = true
		}
	}
	if (state.hidden) {
		state.hidden.outcome = outcome
	}

	const dropped = state.previousProse !== undefined ? diffDroppedEvidence(state.previousProse, prose) : undefined
	// Findings that sit only in narration from earlier turns cannot be fixed by a revision: they are disclosed in the
	// footer but neither sent to the model as instructions nor counted toward the hard gate.
	const unrevisable: AnswerAuditViolation[] =
		outcome.status === "violations" && outcome.schema === "graded"
			? outcome.violations.filter((v) => isOlderNarrationOnly(v.excerpt, split.older, split.current))
			: []
	const revisableHard =
		outcome.status === "violations" && outcome.schema === "graded"
			? hardOf(outcome.violations).filter((v) => !unrevisable.includes(v))
			: []
	const gated = revisableHard.length > 0

	if (gated && state.revisions < MAX_AUDIT_REVISIONS) {
		const ts = now()
		state.history.push(eventFor(attemptIndex, ts, prose, hash, outcome, dropped))
		state.previousProse = prose
		state.revisions++
		if (state.hidden) {
			state.hidden.inHistory = true
		}
		const payload: AnswerAuditPayload = {
			...toAnswerAuditPayload(outcome, { stage: "revision", attempt: attemptIndex, answerTs: ts, answer: prose }),
			...capDraft(prose),
			...(unrevisable.length ? { unrevisableFindings: unrevisable } : {}),
			history: state.history.slice(0, -1),
			...(dropped?.droppedQuantities.length ? { droppedQuantities: dropped.droppedQuantities } : {}),
			...(dropped?.droppedClaimMarkers.length ? { droppedClaimMarkers: dropped.droppedClaimMarkers } : {}),
		}
		await ctx.emit(payload)
		return {
			kind: "revise",
			attempt: state.revisions,
			feedback: formatResponse.answerAuditRevisionRequest({
				hard: revisableHard,
				attempt: state.revisions,
				maxRevisions: MAX_AUDIT_REVISIONS,
			}),
		}
	}

	let disclosure: AnswerAuditDisclosure | undefined
	if (gated) {
		disclosure = {
			kind: "findings_remain",
			reason: `Shown with ${revisableHard.length} unresolved hard audit findings after ${state.revisions} revisions.`,
		}
	}
	return {
		kind: "accept",
		outcome,
		attempt: state.revisions,
		history: state.history.slice(),
		unrevisable,
		dropped:
			state.revisions > 0 && state.firstProse !== undefined
				? cumulativeDropped(state.firstProse, prose, {
						quantities: [
							...state.history.flatMap((e) => e.droppedQuantities ?? []),
							...(dropped?.droppedQuantities ?? []),
						],
						markers: [
							...state.history.flatMap((e) => e.droppedClaimMarkers ?? []),
							...(dropped?.droppedClaimMarkers ?? []),
						],
					})
				: undefined,
		disclosure,
		prose,
	}
}

// ── Payloads for the shown / interrupted rows ─────────────────────────────────────────────────────────────────────

/** Final-stage payload for an accepted decision. */
export function finalPayload(
	decision: Extract<GateDecision, { kind: "accept" }>,
	answerTs: number,
	hadHardBefore: boolean,
): AnswerAuditPayload {
	const base = toAnswerAuditPayload(decision.outcome, {
		stage: "final",
		attempt: decision.attempt,
		answerTs,
		answer: decision.prose,
	})
	const d = decision.dropped
	return {
		...base,
		...(decision.history.length ? { history: decision.history } : {}),
		...(decision.disclosure ? { disclosure: decision.disclosure } : {}),
		...(decision.unrevisable.length ? { unrevisableFindings: decision.unrevisable } : {}),
		...(d?.droppedQuantities.length ? { droppedQuantities: d.droppedQuantities } : {}),
		...(d?.droppedClaimMarkers.length ? { droppedClaimMarkers: d.droppedClaimMarkers } : {}),
		...(decision.attempt > 0 && hadHardBefore ? { quantitiesRemaining: extractQuantities(decision.prose).length } : {}),
	}
}

/** True when any earlier attempt of the cycle had hard findings (it always does after a revision). */
export function cycleHadHard(history: readonly AnswerRevisionEvent[]): boolean {
	return history.some((e) => e.hardCount > 0)
}

/**
 * Payload revealing a hidden draft because the gate was left early: "Unchecked draft (audit interrupted: <reason>)".
 * Carries the last audit result for that draft when there is one.
 */
export function interruptedPayload(
	state: AnswerAuditGateState,
	reason: string,
	now: number = Date.now(),
): AnswerAuditPayload | undefined {
	const draft = state.hidden
	if (!draft) {
		return undefined
	}
	const audited = draft.outcome && (draft.outcome.status === "violations" || draft.outcome.status === "passed")
	const base = toAnswerAuditPayload(
		audited ? draft.outcome! : { status: "unavailable", reason: `audit interrupted: ${reason}` },
		{ stage: "interrupted", attempt: draft.attempt, answerTs: now, answer: draft.text },
	)
	return {
		...base,
		status: audited ? base.status : "unavailable",
		draftHash: draft.hash,
		...capDraft(draft.text),
		disclosure: { kind: "interrupted", reason },
		...(state.history.length ? { history: draft.inHistory ? state.history.slice(0, -1) : state.history.slice() } : {}),
	}
}

/**
 * Resume check: if the last answer_audit row of a saved transcript is a `revision` or `pending` row (a draft held
 * back, or one persisted before its audit) with no `final` or `interrupted` row, no completion_result and no user
 * message after it, the draft behind it was hidden and never shown.
 */
export function findUnrevealedRevision(rows: readonly GateRow[]): AnswerAuditPayload | undefined {
	for (let i = rows.length - 1; i >= 0; i--) {
		const r = rows[i]
		// A shown answer or a later user message ends the question (the draft was shown, or already dealt with).
		if (r.type === "say" && (r.say === "completion_result" || r.say === "user_feedback")) {
			return undefined
		}
		if (r.type === "say" && r.say === "answer_audit" && !r.partial) {
			const p = parseJson(r.text)
			if (!p || p.v !== ANSWER_AUDIT_PAYLOAD_VERSION) {
				continue
			}
			return p.stage === "revision" || p.stage === "pending" ? (p as AnswerAuditPayload) : undefined
		}
	}
	return undefined
}

function parseJson(text: string | undefined): any {
	try {
		return JSON.parse(text ?? "")
	} catch {
		return undefined
	}
}

/** Payload revealing the draft behind a persisted `revision` row (reload / resume). */
export function interruptedFromRevision(rev: AnswerAuditPayload, reason: string, now: number = Date.now()): AnswerAuditPayload {
	return {
		...rev,
		stage: "interrupted",
		answerTs: now,
		disclosure: { kind: "interrupted", reason },
	}
}

// ── Transcript helpers ────────────────────────────────────────────────────────────────────────────────────────────

interface MessageStore {
	getAiHydroMessages(): any[]
	setAiHydroMessages(messages: any[]): void
	saveAiHydroMessagesAndUpdateHistory(): Promise<void>
	updateAiHydroMessage?(index: number, updates: Record<string, unknown>): Promise<void>
}

/** Remove the transient "Drafting answer… / Checking…" row (a partial `answer_audit` say with a progress body). */
export async function sweepAuditProgress(store: MessageStore): Promise<boolean> {
	const messages = store.getAiHydroMessages()
	const kept = messages.filter((m) => !(m.type === "say" && m.say === "answer_audit" && isAuditProgressText(m.text)))
	if (kept.length === messages.length) {
		return false
	}
	store.setAiHydroMessages(kept)
	await store.saveAiHydroMessagesAndUpdateHistory()
	return true
}

/**
 * Once a cycle's final (or interrupted) row exists, its `pending` rows no longer need the draft text: the answer is
 * stored once (as the completion row, or inside the final/interrupted payload). Keeps `draftHash` and the rest.
 * Returns how many rows were compacted. Never throws.
 */
export async function compactPendingRows(store: MessageStore): Promise<number> {
	if (!store.updateAiHydroMessage) {
		return 0
	}
	let compacted = 0
	try {
		const rows = store.getAiHydroMessages()
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i]
			if (r.type !== "say" || r.say !== "answer_audit" || r.partial) {
				continue
			}
			const p = parseJson(r.text)
			if (!p || p.v !== ANSWER_AUDIT_PAYLOAD_VERSION || p.stage !== "pending" || p.draftText === undefined) {
				continue
			}
			const { draftText: _text, draftTruncated: _cut, ...rest } = p
			await store.updateAiHydroMessage(i, { text: JSON.stringify(rest) })
			compacted++
		}
	} catch (error) {
		console.error("Failed to compact pending answer-audit rows", error)
	}
	return compacted
}
