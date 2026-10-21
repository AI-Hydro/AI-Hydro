/**
 * Synthetic chat transcripts for the Wave 2 redesign screens (invented; no model produced these). Each reproduces a
 * message-stream pattern the transcript presenter must handle: the owner's "turn machinery" screenshot, lifted
 * failures, long tool runs, pending approvals, and the lifecycle rows (truncation, condense, cancel, resume, rewind,
 * checked-out checkpoint). Message shapes follow what the host writes today; the `info` rows use the legacy
 * plain-string form (the truncation row uses the structured `{class, severity}` form from W2-0h).
 */
import type { AnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { apiReq, completion, mcpCall, mcpResult, step, t0, task, text } from "./chat"

/** Sequential timestamps so every row is unique and ordered. */
const clock = () => {
	let n = 0
	return () => t0 + ++n * step
}

const say = (ts: number, kind: NonNullable<AiHydroMessage["say"]>, body?: string, extra: Partial<AiHydroMessage> = {}) =>
	({ ts, type: "say", say: kind, text: body, ...extra }) as AiHydroMessage
const ask = (ts: number, kind: NonNullable<AiHydroMessage["ask"]>, body?: string, extra: Partial<AiHydroMessage> = {}) =>
	({ ts, type: "ask", ask: kind, text: body, ...extra }) as AiHydroMessage

/**
 * Evidence marker text built at runtime: a literal bracketed marker in source makes the production CSS scanner emit a
 * rule for it (the harness bundle guard then flags the fixture id), so no marker may appear as a source literal.
 */
const marker = (kind: string, id: string) => "[" + kind + ":" + id + "]"

const reasoning = (ts: number, body: string) => say(ts, "reasoning", body)
const checkpoint = (ts: number, extra: Partial<AiHydroMessage> = {}) =>
	say(ts, "checkpoint_created", undefined, { lastCheckpointHash: `fx${ts.toString(16)}`, ...extra })
const apiReqInfo = (ts: number, info: Record<string, unknown>) =>
	say(ts, "api_req_started", JSON.stringify({ request: "fixture request", tokensIn: 12_400, tokensOut: 640, ...info }))
const toolJson = (o: Record<string, unknown>) => JSON.stringify(o)

/** The owner's screenshot pattern: per-request cost rows, Thinking rows, checkpoints, a retry notice, science calls. */
export const turnMachineryTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Characterise the synthetic basin and summarise its signatures. Layout fixture, not a hydrology result."),
		apiReq(c(), 0.0214),
		reasoning(c(), "I should delineate the basin first, then compute signatures from the recorded run."),
		checkpoint(c()),
		say(c(), "info", 'malformed tool call; retried\n\n<tool_calls>[{"name":"delineate_basin"</tool_calls>'),
		apiReq(c(), 0.0198),
		reasoning(c(), "The retry parsed. Delineation next."),
		mcpCall(c(), "delineate_basin", { gauge_id: "SYN-00000001" }),
		mcpResult(c(), { _run_id: "fx-run-0101", area_km2: "synthetic" }),
		checkpoint(c()),
		apiReq(c(), 0.0242),
		mcpCall(c(), "compute_signatures", { gauge_id: "SYN-00000001" }),
		mcpResult(c(), { _run_id: "fx-run-0102", signatures: { note: "synthetic" } }),
		checkpoint(c()),
		apiReq(c(), 0.0261),
		text(c(), "Both runs completed. Fixture prose only: no value here is a result."),
		completion(
			c(),
			`Delineation is recorded in ${marker("run", "fx-run-0101")} and signatures in ${marker("run", "fx-run-0102")}. Fixture answer, not a result.`,
		),
	]
})()

/** A failed call, an error row, a refusal and a malformed-call notice: every one must stay visible. */
export const failureLiftedTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Fetch streamflow, then compare with the model. Layout fixture."),
		apiReq(c()),
		mcpCall(c(), "data_fetch", { gauge_id: "SYN-00000404" }),
		mcpResult(c(), "Error:\nTool 'data_fetch' failed: upstream service returned 503 (synthetic)"),
		apiReq(c()),
		say(c(), "info", "Skipped: 'fetch_flow' is not a tool on 'ai-hydro'. Asked the model to retry."),
		apiReq(c()),
		say(c(), "diff_error", "The SEARCH block did not match the file content (synthetic)."),
		say(c(), "error", "Could not read /workspace/missing.csv: no such file (synthetic)."),
		apiReq(c()),
		text(c(), "I could not fetch the data. Fixture prose: which gauge should I use instead?"),
	]
})()

/** Eight science calls in one turn: the long-run case a group must summarise honestly. */
export const run8ToolsTask: AiHydroMessage[] = (() => {
	const c = clock()
	const tools = [
		"data_fetch",
		"delineate_basin",
		"compute_signatures",
		"extract_hydrologic_signatures",
		"get_forcing",
		"baseflow_separation",
		"flow_duration_curve",
		"trend_analysis",
	]
	const rows: AiHydroMessage[] = [task("Run the full synthetic workup for SYN-00000001. Layout fixture."), apiReq(c())]
	tools.forEach((name, i) => {
		rows.push(mcpCall(c(), name, { gauge_id: "SYN-00000001" }))
		rows.push(mcpResult(c(), { _run_id: `fx-run-02${i}`, note: "synthetic" }))
		rows.push(apiReq(c(), 0.011 + i / 1000))
	})
	rows.push(completion(c(), "Eight recorded runs are listed above. Fixture answer, not a result."))
	return rows
})()

const MCP_ARGS = { gauge_id: "SYN-00000001", period: "1990-2020" }

/** Pending approval of an MCP call (tail ask). */
export const approvalMcpTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Download the synthetic forcing data. Layout fixture."),
		apiReq(c()),
		text(c(), "I will call the forcing tool next."),
		ask(
			c(),
			"use_mcp_server",
			toolJson({
				serverName: "ai-hydro",
				type: "use_mcp_tool",
				toolName: "get_forcing",
				arguments: JSON.stringify(MCP_ARGS, null, 2),
			}),
		),
	]
})()

/** Pending approval of a shell command (tail ask). */
export const approvalCommandTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Run the synthetic test suite. Layout fixture."),
		apiReq(c()),
		text(c(), "I will run the tests."),
		ask(c(), "command", "pytest tests/ -x -q"),
	]
})()

/** Pending approval of a file edit with a diff (tail ask). */
export const approvalEditTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Fix the unit label in the synthetic config. Layout fixture."),
		apiReq(c()),
		text(c(), "The label is wrong; I will edit it."),
		ask(
			c(),
			"tool",
			toolJson({
				tool: "editedExistingFile",
				path: "config/units.yaml",
				operationIsLocatedInWorkspace: true,
				diff: "------- SEARCH\ndischarge: ft3/s\n=======\ndischarge: m3/s\n+++++++ REPLACE",
			}),
		),
	]
})()

/** Approval of an edit outside the workspace: a security-marked ask (answered ones stay lifted). */
export const protectedPathApprovalTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Update the shared hosts file. Layout fixture."),
		apiReq(c()),
		text(c(), "This needs a file outside the workspace."),
		ask(
			c(),
			"tool",
			toolJson({
				tool: "editedExistingFile",
				path: "/etc/hosts",
				operationIsLocatedInWorkspace: false,
				diff: "+++++++ REPLACE\n127.0.0.1 fixture.test",
			}),
			{ isOperationOutsideWorkspace: true },
		),
	]
})()

/** The same approval after the user answered Run and the edit completed: security-marked, so it stays lifted. */
export const protectedPathApprovedTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Update the shared hosts file. Layout fixture."),
		apiReq(c()),
		text(c(), "This needs a file outside the workspace."),
		ask(
			c(),
			"tool",
			toolJson({
				tool: "editedExistingFile",
				path: "/etc/hosts",
				operationIsLocatedInWorkspace: false,
				diff: "+++++++ REPLACE\n127.0.0.1 fixture.test",
			}),
			{ isOperationOutsideWorkspace: true, askOutcome: "approved", execOutcome: "completed" },
		),
		apiReq(c()),
		text(c(), "The hosts entry is in place. Fixture prose only."),
	]
})()

/** Completed answer with claim and run chips (claims come from the screen's ledger). */
export const finishedClaimsTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Summarise the synthetic basin with evidence. Layout fixture."),
		apiReq(c()),
		mcpCall(c(), "compute_signatures", { gauge_id: "SYN-00000001" }),
		mcpResult(c(), { _run_id: "fx-run-0003", signatures: { note: "synthetic" } }),
		apiReq(c()),
		completion(
			c(),
			`Baseflow index ${marker("run", "fx-run-0003#signatures.bfi")}; status of ${marker("claim", "fx-claim-supported")} and ${marker("claim", "fx-claim-contested")}.\n\nFixture answer: no value here is a result.`,
		),
	]
})()

/** Today's text-form audit: a say:text row after the completion (legacy, display-only). */
export const answerAuditViolationsLegacyTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Summarise the synthetic basin. Layout fixture."),
		apiReq(c()),
		completion(c(), "The synthetic runoff ratio is 0.42 and the baseflow index is 0.61. Fixture answer, not a result."),
		text(
			c(),
			[
				"**Answer audit (study `fx-session-0001`) found 2 issues** (0/2 numbers cited). Display only: the answer above is unchanged.",
				'1. `untraced_number` - "runoff ratio is 0.42" - no run supports this value `Fix: cite the run, e.g. ' +
					marker("run", "ID#path") +
					"`",
				'2. `untraced_number` - "baseflow index is 0.61" - no run supports this value',
			].join("\n"),
		),
	]
})()

const FIXTURE_DRAFT_HASH = "0".repeat(64)

/** Structured audit (W2-B-host): graded schema, hard and advisory findings, every finding kept. */
export const answerAuditGradedTask: AiHydroMessage[] = (() => {
	const c = clock()
	const messages = [
		task("Summarise the synthetic basin. Layout fixture."),
		apiReq(c()),
		completion(c(), "The synthetic runoff ratio is 0.42 and the baseflow index is 0.61. Fixture answer, not a result."),
	]
	const payload: AnswerAuditPayload = {
		v: 1,
		stage: "final",
		status: "violations",
		sessionId: "fx-session-0001",
		cited: 0,
		total: 2,
		hardCount: 1,
		advisoryCount: 1,
		schema: "graded",
		attempt: 0,
		answerTs: messages[2].ts,
		draftHash: FIXTURE_DRAFT_HASH,
		violations: [
			{
				kind: "untraced_number",
				severity: "hard",
				excerpt: "runoff ratio is 0.42",
				message: "no run supports this value",
				fixHint: "cite the run, e.g. " + marker("run", "ID#path"),
			},
			{
				kind: "stale_claim",
				severity: "advisory",
				excerpt: "baseflow index is 0.61",
				message: "claim predates the latest run",
			},
		],
	}
	return [...messages, say(c(), "answer_audit", JSON.stringify(payload))]
})()

const gateHardFinding = {
	kind: "untraced_number",
	severity: "hard" as const,
	excerpt: "runoff ratio is 0.42",
	message: "no run supports this value",
	fixHint: "cite the run, e.g. " + marker("run", "ID#path"),
}

/** W2-C: a draft was held back and revised once; the shown answer reports fewer values and says so. */
export const answerRevisedTask: AiHydroMessage[] = (() => {
	const c = clock()
	const base = [task("Summarise the synthetic basin. Layout fixture."), apiReq(c())]
	const revision: AnswerAuditPayload = {
		v: 1,
		stage: "revision",
		status: "violations",
		sessionId: "fx-session-0001",
		cited: 0,
		total: 2,
		hardCount: 1,
		advisoryCount: 0,
		schema: "graded",
		attempt: 0,
		answerTs: 3,
		draftHash: FIXTURE_DRAFT_HASH,
		draftText: "The synthetic runoff ratio is 0.42 and the baseflow index is 0.61.",
		violations: [gateHardFinding],
	}
	const rows = [...base, say(c(), "answer_audit", JSON.stringify(revision)), apiReq(c())]
	const shown = completion(c(), "The synthetic baseflow index is 0.61 (recorded run). Fixture answer, not a result.")
	const final: AnswerAuditPayload = {
		v: 1,
		stage: "final",
		status: "passed",
		sessionId: "fx-session-0001",
		cited: 1,
		total: 1,
		hardCount: 0,
		advisoryCount: 0,
		schema: "graded",
		attempt: 1,
		answerTs: shown.ts,
		draftHash: FIXTURE_DRAFT_HASH,
		droppedQuantities: ["0.42"],
		quantitiesRemaining: 1,
		violations: [],
		history: [
			{
				attempt: 0,
				ts: 3,
				hardCount: 1,
				advisoryCount: 0,
				violations: [gateHardFinding],
				draftHash: FIXTURE_DRAFT_HASH,
				draftText: revision.draftText,
			},
		],
	}
	return [...rows, shown, say(c(), "answer_audit", JSON.stringify(final))]
})()

/**
 * W2-C: a hidden `pending` row holds the unchecked draft in the middle of a run of calls. It must render as nothing,
 * not count as a revision and not split the group; the `final` audit attaches to the answer.
 */
export const answerPendingHiddenTask: AiHydroMessage[] = (() => {
	const c = clock()
	const pending: AnswerAuditPayload = {
		v: 1,
		stage: "pending",
		status: "unavailable",
		sessionId: "fx-session-0001",
		cited: 0,
		total: 0,
		hardCount: 0,
		advisoryCount: 0,
		schema: "graded",
		attempt: 0,
		answerTs: 0,
		draftHash: FIXTURE_DRAFT_HASH,
		draftText: "UNCHECKED DRAFT MUST NOT SHOW",
		violations: [],
	} as AnswerAuditPayload
	return [
		task("Fetch and summarise. Layout fixture."),
		apiReq(c()),
		mcpCall(c(), "delineate_basin", { gauge_id: "SYN-00000001" }),
		mcpResult(c(), { _run_id: "fx-run-0301", note: "synthetic" }),
		say(c(), "answer_audit", JSON.stringify(pending)),
		apiReq(c()),
		mcpCall(c(), "compute_signatures", { gauge_id: "SYN-00000001" }),
		mcpResult(c(), { _run_id: "fx-run-0302", note: "synthetic" }),
		completion(c(), "Two recorded runs, nothing hidden. Fixture answer, not a result."),
	]
})()

/** W2-C: findings remain after 2 revisions; the answer is shown with that stated. */
export const answerDisclosureTask: AiHydroMessage[] = (() => {
	const c = clock()
	const messages = [
		task("Summarise the synthetic basin. Layout fixture."),
		apiReq(c()),
		completion(c(), "The synthetic runoff ratio is 0.42. Fixture answer, not a result."),
	]
	const payload: AnswerAuditPayload = {
		v: 1,
		stage: "final",
		status: "violations",
		sessionId: "fx-session-0001",
		cited: 0,
		total: 1,
		hardCount: 1,
		advisoryCount: 0,
		schema: "graded",
		attempt: 2,
		answerTs: messages[2].ts,
		draftHash: FIXTURE_DRAFT_HASH,
		violations: [gateHardFinding],
		disclosure: { kind: "findings_remain", reason: "Shown with 1 unresolved hard audit findings after 2 revisions." },
	}
	return [...messages, say(c(), "answer_audit", JSON.stringify(payload))]
})()

/** W2-C: the run stopped while a draft was held back; the draft is revealed as unchecked. */
export const answerInterruptedTask: AiHydroMessage[] = (() => {
	const c = clock()
	const messages = [task("Summarise the synthetic basin. Layout fixture."), apiReq(c())]
	const payload: AnswerAuditPayload = {
		v: 1,
		stage: "interrupted",
		status: "unavailable",
		hardCount: 0,
		advisoryCount: 0,
		schema: "legacy",
		attempt: 0,
		answerTs: 3,
		draftHash: FIXTURE_DRAFT_HASH,
		draftText: "The synthetic runoff ratio is 0.42. Fixture draft, not a result.",
		violations: [],
		disclosure: { kind: "interrupted", reason: "stopped by user" },
	}
	return [...messages, say(c(), "answer_audit", JSON.stringify(payload))]
})()

/** Audit that could not run: structured status and reason, never presented as a pass. */
export const answerAuditUnavailableTask: AiHydroMessage[] = (() => {
	const c = clock()
	const messages = [
		task("Summarise the synthetic basin. Layout fixture."),
		apiReq(c()),
		completion(c(), "The synthetic runoff ratio is 0.42. Fixture answer, not a result."),
	]
	const payload: AnswerAuditPayload = {
		v: 1,
		stage: "final",
		status: "unavailable",
		hardCount: 0,
		advisoryCount: 0,
		violations: [],
		schema: "legacy",
		attempt: 0,
		answerTs: messages[2].ts,
		draftHash: FIXTURE_DRAFT_HASH,
		disclosure: { kind: "audit_unavailable", reason: "timed out after 15s" },
	}
	return [...messages, say(c(), "answer_audit", JSON.stringify(payload))]
})()

/** Context truncated to fit the window: the host now says so (structured warning notice) and the range is on the request row. */
export const contextTruncationTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Keep working through the synthetic backlog. Layout fixture."),
		apiReq(c()),
		text(c(), "Continuing with the next item."),
		apiReq(c()),
		say(
			c(),
			"info",
			"Context window exceeded: dropped 8 earlier messages from the model's context (4 of 12 kept) and retried.",
			{
				infoNotice: {
					class: "context_truncated",
					severity: "warning",
					detail: { deletedRange: [2, 9], newlyDropped: 8, totalDropped: 8, historyLength: 12 },
				},
			},
		),
		{ ...apiReqInfo(c(), { cost: 0.031 }), conversationHistoryDeletedRange: [2, 9], conversationHistoryIndex: 12 },
		text(c(), "I have the context I need. Fixture prose only."),
	]
})()

/** Summarize/condense tool call followed by more work. */
export const condenseTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Long synthetic session that gets condensed. Layout fixture."),
		apiReq(c()),
		text(c(), "The conversation is long; condensing."),
		say(
			c(),
			"tool",
			toolJson({
				tool: "summarizeTask",
				content: "Summary (synthetic): the user asked for a workup; two runs completed; next step is the comparison.",
			}),
		),
		apiReq(c()),
		text(c(), "Continuing from the summary. Fixture prose only."),
	]
})()

/** An approved command that exited non-zero. */
export const commandNonZeroExitTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Run the synthetic build. Layout fixture."),
		apiReq(c()),
		say(c(), "command", "make build\nOutput:\nmake: *** [build] Error 2\nexit code: 2", {
			commandCompleted: true,
			askOutcome: "approved",
			exitCode: 2,
			execOutcome: "failed",
		}),
		apiReq(c()),
		text(c(), "The build failed with exit code 2. Fixture prose only."),
	]
})()

/** The user pressed Cancel mid-request. */
export const userCancelTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Start a long synthetic computation. Layout fixture."),
		apiReq(c()),
		text(c(), "Starting the computation."),
		apiReqInfo(c(), { cancelReason: "user_cancelled" }),
		text(c(), "Partial output before the cancel"),
		ask(c(), "resume_task"),
	]
})()

/** A task reopened from history, waiting on the resume ask. */
export const resumeTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Continue the synthetic study. Layout fixture."),
		apiReq(c()),
		text(c(), "I finished the first run earlier."),
		ask(c(), "resume_task"),
	]
})()

/** Rewind: checkpoint restored, the removed requests are aggregated into deleted_api_reqs. */
export const rewindTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Try two approaches to the synthetic fit. Layout fixture."),
		apiReq(c()),
		checkpoint(c()),
		text(c(), "Approach one is done."),
		say(c(), "deleted_api_reqs", JSON.stringify({ tokensIn: 24_800, tokensOut: 1_280, cost: 0.0246 })),
		apiReq(c()),
		text(c(), "Starting approach two after the rewind. Fixture prose only."),
	]
})()

/** A checkpoint the user has checked out (workspace files restored; history unchanged). */
export const checkpointCheckedOutTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Edit the synthetic config and compare. Layout fixture."),
		apiReq(c()),
		checkpoint(c(), { isCheckpointCheckedOut: true }),
		text(c(), "Edited the config. Fixture prose only."),
		apiReq(c()),
		checkpoint(c()),
	]
})()

/** A task saved before the host recorded askOutcome/execOutcome: outcomes must come from evidence rows only. */
export const oldTaskNoOutcomesTask: AiHydroMessage[] = (() => {
	const c = clock()
	return [
		task("Old synthetic task from before outcome fields. Layout fixture."),
		apiReq(c()),
		ask(c(), "command", "ls data/\nOutput:\nflow.csv\nforcing.csv", { commandCompleted: true }),
		apiReq(c()),
		ask(
			c(),
			"use_mcp_server",
			toolJson({
				serverName: "ai-hydro",
				type: "use_mcp_tool",
				toolName: "get_forcing",
				arguments: JSON.stringify(MCP_ARGS),
			}),
		),
		say(c(), "mcp_server_request_started"),
		mcpResult(c(), { _run_id: "fx-run-0900", note: "synthetic" }),
		apiReq(c()),
		text(c(), "Both steps ran. Fixture prose only."),
	]
})()
