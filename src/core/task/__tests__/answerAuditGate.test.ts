import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { formatResponse } from "@/core/prompts/responses"
import * as notifications from "@/integrations/notifications"
import {
	collectAuditProse,
	diffDroppedEvidence,
	droppedEvidenceLines,
	extractQuantities,
	isAuditProgressText,
} from "@/shared/aihydro/answerAuditGate"
import { setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import { MAX_AUDIT_REVISIONS, MAX_DRAFT_TEXT_CHARS, parseAnswerAuditPayload } from "@/shared/aihydro/transcriptContracts"
import type { McpServer } from "@/shared/mcp"
import {
	type AnswerAuditGateState,
	computeGateEligibility,
	createGateState,
	evaluateDraft,
	findUnrevealedRevision,
	type GateContext,
	interruptedFromRevision,
	interruptedPayload,
	noteSessionStarted,
	resetGateCycle,
	sweepAuditProgress,
} from "../answerAuditGate"
import type { FinalAnswerAuditOutcome } from "../finalAnswerAudit"
import { ToolExecutor } from "../ToolExecutor"
import { AttemptCompletionHandler } from "../tools/handlers/AttemptCompletionHandler"

const LAUNCHER = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
const GRADED_DESC = "Decimals need a marker; method parameters are advisory."
const LEGACY_DESC = "Verify that every numeric literal in synthesis prose is bound to a run-log entry."

function server(over: Partial<McpServer> = {}, desc: string = GRADED_DESC): McpServer {
	return {
		name: "ai-hydro",
		status: "connected",
		config: JSON.stringify({ type: "stdio", command: LAUNCHER.command, args: [] }),
		tools: [{ name: "audit_interpretation", description: desc }, { name: "aihydro_chat_status" }],
		...over,
	} as McpServer
}

function bound(): AnswerAuditGateState {
	const s = createGateState()
	noteSessionStarted(s)
	return s
}

const eligibleInput = (over: Record<string, unknown> = {}) => ({
	toolName: "attempt_completion",
	mode: "act",
	gateSetting: true,
	auditEnabled: true,
	servers: [server()],
	state: bound(),
	...over,
})

describe("answer-audit gate (W2-C)", () => {
	beforeEach(() => setRecordedFirstPartyLauncher(LAUNCHER as any))
	afterEach(() => {
		setRecordedFirstPartyLauncher(undefined)
		sinon.restore()
	})

	describe("eligibility matrix (cached state only)", () => {
		it("is eligible only when everything lines up", () => {
			expect(computeGateEligibility(eligibleInput() as any)).to.include({ eligible: true })
		})

		const cases: Array<[string, Record<string, unknown>, string]> = [
			["setting off", { gateSetting: false }, "gate-setting-off"],
			["setting unset (default off)", { gateSetting: undefined }, "gate-setting-off"],
			["audit disabled implies gate off", { auditEnabled: false }, "audit-disabled"],
			["plan mode", { mode: "plan" }, "plan-mode"],
			["plan_mode_respond is never gated", { toolName: "plan_mode_respond" }, "not-attempt-completion"],
			["server absent", { servers: [] }, "no-trusted-server"],
			["server disconnected", { servers: [server({ status: "disconnected" })] }, "no-trusted-server"],
			["server disabled", { servers: [server({ disabled: true })] }, "no-trusted-server"],
			[
				"server untrusted (not the recorded launcher)",
				{ servers: [server({ config: JSON.stringify({ type: "stdio", command: "/tmp/evil", args: [] }) })] },
				"no-trusted-server",
			],
			["look-alike server name", { servers: [server({ name: "aihydro-evil" })] }, "no-trusted-server"],
			["no audit tool", { servers: [server({ tools: [{ name: "aihydro_chat_status" }] })] }, "no-audit-tool"],
			["legacy tools (no graded advert, none observed)", { servers: [server({}, LEGACY_DESC)] }, "graded-schema-unknown"],
			["study not known to be bound", { state: createGateState() }, "study-not-bound"],
		]
		for (const [name, over, reason] of cases) {
			it(`not eligible: ${name}`, () => {
				expect(computeGateEligibility(eligibleInput(over) as any)).to.deep.include({ eligible: false, reason })
			})
		}

		it("a graded outcome observed earlier in the task makes up for a description without the advert", () => {
			const state = bound()
			state.gradedObserved = true
			expect(computeGateEligibility(eligibleInput({ servers: [server({}, LEGACY_DESC)], state }) as any).eligible).to.equal(
				true,
			)
		})

		it("a cached bound study counts as bound; start_session refreshes it", () => {
			const state = createGateState()
			state.boundStudyId = "s1"
			expect(computeGateEligibility(eligibleInput({ state }) as any).eligible).to.equal(true)
			noteSessionStarted(state)
			expect(state.boundStudyId).to.equal(undefined)
			expect(state.sessionStarted).to.equal(true)
		})

		it("the gate is off by default in state defaults", () => {
			const src = fs.readFileSync(path.join(__dirname, "../../storage/utils/state-helpers.ts"), "utf8")
			expect(src).to.match(/finalAnswerAuditGate: finalAnswerAuditGate \?\? false/)
		})
	})

	// ── evaluateDraft ───────────────────────────────────────────────────────────────────────────────────────────

	const hard = (kind = "untraced_number", excerpt = "runoff ratio is 0.42") => ({
		kind,
		severity: "hard" as const,
		excerpt,
		message: "no run supports this value",
		fixHint: "cite the run",
		suggestedMarker: "[run:ID#key_outputs.runoff_ratio]",
	})
	const violated = (hardN: number, advN = 0, schema: "graded" | "legacy" = "graded"): FinalAnswerAuditOutcome => ({
		status: "violations",
		sessionId: "study-1",
		violations: [
			...Array.from({ length: hardN }, () => hard()),
			...Array.from({ length: advN }, () => ({ ...hard("method_parameter"), severity: "advisory" as const })),
		],
		totalViolations: hardN + advN,
		hardCount: hardN,
		advisoryCount: advN,
		schema,
		cited: 0,
		total: 1,
	})
	const passed: FinalAnswerAuditOutcome = { status: "passed", sessionId: "study-1", cited: 1, total: 1, schema: "graded" }

	function ctx(over: Partial<GateContext> & { outcomes?: FinalAnswerAuditOutcome[] } = {}) {
		const emitted: any[] = []
		const progress: Array<string | undefined> = []
		const outcomes = over.outcomes ?? [passed]
		const runAudit = sinon.stub().callsFake(async () => outcomes.shift() ?? passed)
		const c: GateContext = {
			state: createGateState(),
			hub: { getServers: () => [], callTool: sinon.stub() as any },
			ulid: "chat-1",
			workspaceRoot: "/ws",
			result: "The runoff ratio is 0.42.",
			rows: () => [],
			emit: async (p) => {
				emitted.push(p)
			},
			setProgress: async (t) => {
				progress.push(t)
			},
			takeUserMessage: () => undefined,
			isAborted: () => false,
			runAudit: runAudit as any,
			...over,
		}
		return { c, emitted, progress, runAudit }
	}

	describe("evaluateDraft", () => {
		it("passes straight through when there are no findings", async () => {
			const { c, emitted } = ctx({ outcomes: [passed] })
			const d = await evaluateDraft(c)
			expect(d.kind).to.equal("accept")
			expect(emitted).to.have.length(0)
			expect(c.state.revisions).to.equal(0)
		})

		it("graded hard findings: persists a revision payload and asks for a revision", async () => {
			const { c, emitted } = ctx({ outcomes: [violated(1)] })
			const d = await evaluateDraft(c)
			expect(d.kind).to.equal("revise")
			expect(c.state.revisions).to.equal(1)
			expect(emitted).to.have.length(1)
			const p = emitted[0]
			expect(p).to.include({ stage: "revision", attempt: 0, status: "violations", schema: "graded", hardCount: 1 })
			expect(p.draftText).to.equal("The runoff ratio is 0.42.")
			expect(p.draftHash).to.match(/^[0-9a-f]{64}$/)
			expect(p.violations[0].suggestedMarker).to.equal("[run:ID#key_outputs.runoff_ratio]")
			expect(parseAnswerAuditPayload(JSON.stringify(p))).to.not.equal(undefined)
			expect(c.state.hidden?.inHistory).to.equal(true)
		})

		it("revision 1 -> pass: accepted with the history and removed values disclosed", async () => {
			const { c, emitted } = ctx({ outcomes: [violated(1), passed], result: "The runoff ratio is 0.42 and NSE is 0.71." })
			expect((await evaluateDraft(c)).kind).to.equal("revise")
			const second = await evaluateDraft({ ...c, result: "The runoff ratio is 0.42 [run:r1#key_outputs.rr]." })
			expect(second.kind).to.equal("accept")
			if (second.kind !== "accept") {
				return
			}
			expect(second.attempt).to.equal(1)
			expect(second.history).to.have.length(1)
			expect(second.dropped?.droppedQuantities).to.deep.equal(["0.71"])
			expect(second.disclosure).to.equal(undefined)
			expect(emitted).to.have.length(1) // only the revision row; the final row is the handler's
		})

		it("2 revisions, still failing: accepted with the findings_remain disclosure", async () => {
			const { c } = ctx({ outcomes: [violated(2), violated(2), violated(2)] })
			expect((await evaluateDraft(c)).kind).to.equal("revise")
			expect((await evaluateDraft(c)).kind).to.equal("revise")
			const third = await evaluateDraft(c)
			expect(third.kind).to.equal("accept")
			if (third.kind === "accept") {
				expect(third.attempt).to.equal(MAX_AUDIT_REVISIONS)
				expect(third.disclosure).to.deep.equal({
					kind: "findings_remain",
					reason: "Shown with 2 unresolved hard audit findings after 2 revisions.",
				})
				expect(third.history).to.have.length(2)
			}
		})

		const neverGated: Array<[string, FinalAnswerAuditOutcome]> = [
			["legacy findings", violated(3, 0, "legacy")],
			["graded advisory only", violated(0, 2)],
			["unavailable", { status: "unavailable", reason: "server crashed" }],
			["skipped", { status: "skipped", reason: "no-research-session" }],
		]
		for (const [name, outcome] of neverGated) {
			it(`never gates on ${name}`, async () => {
				const { c, emitted } = ctx({ outcomes: [outcome] })
				const d = await evaluateDraft(c)
				expect(d.kind).to.equal("accept")
				expect(emitted).to.have.length(0)
				expect(c.state.revisions).to.equal(0)
			})
		}

		it("deadline: an audit that never returns is shown as unavailable (timed out)", async () => {
			const { c } = ctx({ deadlineMs: 30 })
			c.runAudit = (() => new Promise(() => {})) as any
			const d = await evaluateDraft(c)
			expect(d.kind).to.equal("accept")
			if (d.kind === "accept") {
				expect(d.outcome).to.deep.include({ status: "unavailable" })
				expect((d.outcome as any).reason).to.match(/timed out/)
			}
		})

		it("a thrown audit is unavailable, never swallowed as a pass", async () => {
			const { c } = ctx()
			c.runAudit = (async () => {
				throw new Error("boom")
			}) as any
			const d = await evaluateDraft(c)
			expect(d.kind === "accept" && d.outcome.status === "unavailable").to.equal(true)
		})

		it("caches the bound study so revision rounds skip the status call", async () => {
			const { c, runAudit } = ctx({ outcomes: [violated(1), passed] })
			await evaluateDraft(c)
			await evaluateDraft(c)
			expect(runAudit.firstCall.args[0].boundStudy).to.equal(undefined)
			expect(runAudit.secondCall.args[0].boundStudy).to.equal("study-1")
			expect(c.state.gradedObserved).to.equal(true)
		})

		it("audits narration text since the last user message plus the result (not only result)", async () => {
			const rows = [
				{ type: "say", say: "text", text: "Old turn: 9.9 m3/s" },
				{ type: "say", say: "user_feedback", text: "go on" },
				{ type: "say", say: "text", text: "Peak flow was 123 m3/s." },
				{ type: "say", say: "text", text: "   " },
				{ type: "say", say: "text", text: "streaming", partial: true },
			]
			const { c, runAudit } = ctx({ rows: () => rows })
			await evaluateDraft(c)
			expect(runAudit.firstCall.args[0].answer).to.equal("Peak flow was 123 m3/s.\n\nThe runoff ratio is 0.42.")
			expect(collectAuditProse([], "x")).to.equal("x")
		})

		it("caps a stored draft per the contract and marks the cut", async () => {
			const long = "7 ".repeat(MAX_DRAFT_TEXT_CHARS)
			const { c, emitted } = ctx({ outcomes: [violated(1)], result: long })
			await evaluateDraft(c)
			expect(emitted[0].draftText).to.have.length(MAX_DRAFT_TEXT_CHARS)
			expect(emitted[0].draftTruncated).to.equal(true)
			expect(emitted[0].draftHash).to.match(/^[0-9a-f]{64}$/)
		})

		it("a message typed while the gate runs is feedback, before and after the audit", async () => {
			const before = ctx()
			let n = 0
			before.c.takeUserMessage = () => (n++ === 0 ? { text: "stop that" } : undefined)
			const d1 = await evaluateDraft(before.c)
			expect(d1).to.deep.include({ kind: "user_feedback", text: "stop that" })
			expect(before.runAudit.called).to.equal(false)

			const after = ctx()
			let m = 0
			after.c.takeUserMessage = () => (m++ === 1 ? { text: "wait" } : undefined)
			expect((await evaluateDraft(after.c)).kind).to.equal("user_feedback")
		})

		it("an abort while auditing returns aborted and emits nothing", async () => {
			const { c, emitted } = ctx({ outcomes: [violated(1)] })
			c.isAborted = () => true
			expect((await evaluateDraft(c)).kind).to.equal("aborted")
			expect(emitted).to.have.length(0)
		})
	})

	// ── dropped-value disclosure (M4) ──────────────────────────────────────────────────────────────────────────

	describe("dropped evidence (approximate, extension-side)", () => {
		it("finds numbers with units and markers removed by a revision", () => {
			const d = diffDroppedEvidence(
				"Mean flow 12.5 m3/s [run:a#key_outputs.q], NSE 0.71 [claim:C-1], 7,305 daily observations.",
				"Mean flow 12.5 m3/s [run:a#key_outputs.q].",
			)
			expect(d.droppedQuantities).to.deep.equal(["0.71", "7,305"])
			expect(d.droppedClaimMarkers).to.deep.equal(["[claim:C-1]"])
			expect(d.quantitiesRemaining).to.equal(1)
		})

		it("does not call a re-formatted value or a kept value dropped; ignores years and marker ids", () => {
			expect(diffDroppedEvidence("NSE 0.70 in 2020", "NSE 0.7 in 2021").droppedQuantities).to.deep.equal([])
			expect(extractQuantities("Run [run:xhyd.20260610.sign.a3f1#key_outputs.rr] gave 4 %")).to.deep.equal(["4 %"])
		})

		it("a revision with zero quantities after hard findings says the values are no longer reported", () => {
			const lines = droppedEvidenceLines({
				attempt: 1,
				droppedQuantities: ["0.42", "0.71"],
				quantitiesRemaining: 0,
				draftHadHard: true,
			})
			expect(lines[0]).to.equal("Revision removed 2 quantities from the draft: 0.42, 0.71")
			expect(lines).to.include("The requested values are no longer reported in this answer")
			expect(droppedEvidenceLines({ attempt: 0, droppedQuantities: ["1"], draftHadHard: true })).to.deep.equal([])
		})
	})

	// ── feedback formatter ──────────────────────────────────────────────────────────────────────────────────────

	describe("revision request formatter", () => {
		const msg = formatResponse.answerAuditRevisionRequest({
			hard: [hard(), { ...hard("value_mismatch", "NSE 0.9"), message: "stored 0.71" }],
			attempt: 1,
			maxRevisions: 2,
		})

		it("is not a tool error: cannot feed recentToolErrors, a failed execOutcome or the decompose nudge", () => {
			expect(ToolExecutor.isToolErrorResult(msg)).to.equal(false)
			expect(ToolExecutor.isToolErrorResult(`[attempt_completion] Result:\n${msg}`)).to.equal(false)
		})

		it("lists hard findings with fix hints and markers, names the grammar, forbids inventing, offers no [unverified]", () => {
			expect(msg).to.include("untraced_number").and.include("value_mismatch")
			expect(msg).to.include("Suggested marker: [run:ID#key_outputs.runoff_ratio]")
			expect(msg).to.include("[run:<run_id>#key_outputs.<field>]")
			expect(msg).to.match(/Never invent/)
			expect(msg).to.include("call attempt_completion again")
			expect(msg).to.not.include("[unverified]")
			expect(msg).to.not.match(/teaching_error|Audit FAILED/)
		})
	})

	// ── interrupted exits ───────────────────────────────────────────────────────────────────────────────────────

	describe("interrupted reveal", () => {
		async function heldRevision() {
			const { c } = ctx({ outcomes: [violated(1)] })
			await evaluateDraft(c)
			return c.state
		}

		it("reveals the held draft with the reason and its last findings, for every exit reason", async () => {
			for (const reason of [
				"stopped by user",
				"the model request failed after retries",
				"mistake limit reached",
				"auto-approval request limit reached",
				"switched to Plan mode",
			]) {
				const p = interruptedPayload(await heldRevision(), reason)!
				expect(p.stage).to.equal("interrupted")
				expect(p.disclosure).to.deep.equal({ kind: "interrupted", reason })
				expect(p.draftText).to.equal("The runoff ratio is 0.42.")
				expect(p.hardCount).to.equal(1)
				expect(parseAnswerAuditPayload(JSON.stringify(p))?.stage).to.equal("interrupted")
			}
		})

		it("a draft whose audit never finished is revealed as unchecked, with no findings", () => {
			const state = createGateState()
			state.hidden = { text: "draft 0.5", hash: "h", attempt: 0, ts: 1 }
			const p = interruptedPayload(state, "stopped by user")!
			expect(p).to.include({ stage: "interrupted", status: "unavailable", draftText: "draft 0.5" })
			expect(p.violations).to.deep.equal([])
		})

		it("nothing held means nothing to reveal", () => {
			expect(interruptedPayload(createGateState(), "stopped by user")).to.equal(undefined)
		})

		it("resume: a trailing revision row with no final is revealed; a final or completion_result clears it", async () => {
			const st = await heldRevision()
			void st
			const { c, emitted } = ctx({ outcomes: [violated(1)] })
			await evaluateDraft(c)
			const rev = emitted[0]
			const row = (p: any) => ({ type: "say", say: "answer_audit", text: JSON.stringify(p) })
			expect(findUnrevealedRevision([row(rev)])?.draftText).to.equal(rev.draftText)
			expect(findUnrevealedRevision([row(rev), { type: "say", say: "completion_result", text: "x" }])).to.equal(undefined)
			expect(findUnrevealedRevision([row(rev), row({ ...rev, stage: "final" })])).to.equal(undefined)
			expect(findUnrevealedRevision([row(rev), row({ ...rev, stage: "interrupted" })])).to.equal(undefined)
			expect(interruptedFromRevision(rev, "VS Code reloaded").stage).to.equal("interrupted")
		})

		it("Task.revealHiddenAnswerDraft says one interrupted row, ends the cycle, and is a no-op when nothing is held", async () => {
			const { Task } = await import("../index")
			const state = await heldRevision()
			const say = sinon.stub().resolves(1)
			const fake: any = {
				taskState: { answerAuditGate: state },
				say,
				messageStateHandler: {
					getAiHydroMessages: () => [],
					setAiHydroMessages: () => {},
					saveAiHydroMessagesAndUpdateHistory: async () => {},
				},
			}
			await Task.prototype.revealHiddenAnswerDraft.call(fake, "stopped by user")
			expect(say.calledOnce).to.equal(true)
			const p = parseAnswerAuditPayload(say.firstCall.args[1])!
			expect(p).to.deep.include({ stage: "interrupted" })
			expect(p.disclosure?.reason).to.equal("stopped by user")
			expect(state.revisions).to.equal(0)
			await Task.prototype.revealHiddenAnswerDraft.call(fake, "stopped by user")
			expect(say.calledOnce).to.equal(true)
		})

		it("progress rows are swept and nothing else", async () => {
			let rows: any[] = [
				{ type: "say", say: "answer_audit", text: "Drafting answer…", partial: true },
				{ type: "say", say: "answer_audit", text: '{"v":1}' },
				{ type: "say", say: "text", text: "Checking answer against evidence…" },
			]
			const store = {
				getAiHydroMessages: () => rows,
				setAiHydroMessages: (m: any[]) => (rows = m),
				saveAiHydroMessagesAndUpdateHistory: async () => {},
			}
			expect(await sweepAuditProgress(store)).to.equal(true)
			expect(rows).to.have.length(2)
			expect(isAuditProgressText("Drafting answer…")).to.equal(true)
		})

		it("every non-success exit site in the Task reveals the draft (source guard)", () => {
			const src = fs.readFileSync(path.join(__dirname, "../index.ts"), "utf8")
			for (const reason of [
				"mistake limit reached",
				"auto-approval request limit reached",
				"the model request failed after retries",
			]) {
				expect(src).to.include(`revealHiddenAnswerDraft("${reason}")`)
			}
			expect(src.match(/revealHiddenAnswerDraft\("the model request failed after retries"\)/g)).to.have.length(2)
			// stop/cancel/mode switch: abortTask reveals BEFORE setting abort (say() refuses afterwards)
			expect(src.indexOf("revealHiddenAnswerDraft(this.taskState.answerAuditGate.interruptReason")).to.be.greaterThan(0)
			expect(src.indexOf("revealHiddenAnswerDraft(this.taskState.answerAuditGate.interruptReason")).to.be.lessThan(
				src.indexOf("this.taskState.abort = true // will stop"),
			)
			// resume
			expect(src).to.include("findUnrevealedRevision(")
			const controller = fs.readFileSync(path.join(__dirname, "../../controller/index.ts"), "utf8")
			expect(controller).to.include('interruptReason = "switched to Plan mode"')
		})

		it("user feedback ends the cycle (counter reset)", () => {
			const s = createGateState()
			s.revisions = 2
			s.history = [{} as any]
			resetGateCycle(s)
			expect(s.revisions).to.equal(0)
			expect(s.history).to.deep.equal([])
			const src = fs.readFileSync(path.join(__dirname, "../index.ts"), "utf8")
			expect(src).to.match(/type === "user_feedback"\) \{[^}]*resetGateCycle/s)
		})
	})

	// ── AttemptCompletionHandler integration ────────────────────────────────────────────────────────────────────

	describe("AttemptCompletionHandler ordering and streaming", () => {
		const block = (result: string, partial = false): any => ({ name: "attempt_completion", params: { result }, partial })

		function build(opts: { gate: boolean; audit?: any[]; state?: AnswerAuditGateState; servers?: McpServer[] }) {
			const rows: any[] = []
			const order: string[] = []
			const audits = [...(opts.audit ?? [])]
			const say = sinon.stub().callsFake(async (type: string, text?: string, _i?: any, _f?: any, partial?: boolean) => {
				order.push(`say:${type}${partial ? ":partial" : ""}`)
				const last = rows.at(-1)
				if (partial && last?.partial && last.say === type) {
					last.text = text
					return undefined
				}
				rows.push({ ts: rows.length + 1, type: "say", say: type, text, ...(partial ? { partial: true } : {}) })
				return rows.length
			})
			const saveCheckpoint = sinon.stub().callsFake(async () => {
				order.push("checkpoint")
			})
			const ask = sinon.stub().callsFake(async () => {
				order.push("ask:completion_result")
				return { response: "messageResponse", text: "thanks" }
			})
			const hub = {
				getServers: () => opts.servers ?? [server()],
				callTool: sinon.stub().callsFake(async (_s: string, tool: string) => {
					if (tool === "aihydro_chat_status") {
						return { content: [{ type: "text", text: JSON.stringify({ bound: true, study_id: "study-1" }) }] }
					}
					const a = audits.shift()
					const body = a ?? { session_id: "study-1", passed: true, violations: [], hard_count: 0, advisory_count: 0 }
					return { content: [{ type: "text", text: JSON.stringify(body) }] }
				}),
			}
			const state = opts.state ?? bound()
			const config: any = {
				ulid: "chat-1",
				cwd: "/ws",
				taskState: {
					consecutiveMistakeCount: 2,
					recentToolErrors: [],
					lastResponseModelId: "m",
					answerAuditGate: state,
				},
				autoApprovalSettings: { enabled: true, enableNotifications: true },
				focusChainSettings: { enabled: false },
				messageState: {
					getAiHydroMessages: () => rows,
					setAiHydroMessages: (m: any[]) => {
						rows.splice(0, rows.length, ...m)
					},
					saveAiHydroMessagesAndUpdateHistory: async () => {},
					updateAiHydroMessage: async () => {},
				},
				services: {
					mcpHub: hub,
					stateManager: {
						getGlobalSettingsKey: (k: string) =>
							({ mode: "act", finalAnswerAuditGate: opts.gate, finalAnswerAuditEnabled: true })[k],
					},
				},
				callbacks: {
					say,
					ask,
					saveCheckpoint,
					doesLatestTaskCompletionHaveNewChanges: async () => false,
					updateFCListFromToolResponse: async () => {},
					removeLastPartialMessageIfExistsWithType: async () => {},
				},
			}
			const notify = sinon.stub(notifications, "showSystemNotification")
			return { config, order, rows, say, notify, hub }
		}

		const hardAudit = (n = 1) => ({
			session_id: "study-1",
			passed: false,
			hard_count: n,
			advisory_count: 0,
			cited_numeric_count: 0,
			total_numeric_count: 1,
			violations: Array.from({ length: n }, () => ({
				kind: "uncited_number",
				severity: "hard",
				text_excerpt: "0.42",
				message: "no run supports this value",
				fix_hint: "cite the run",
			})),
		})
		const sayTypes = (rows: any[]) => rows.map((r) => r.say)

		it("not eligible: streams completion_result as today and runs the old display-only path (zero change)", async () => {
			const t = build({ gate: false, audit: [hardAudit()] })
			const h = new AttemptCompletionHandler()
			await h.handlePartialBlock(block("The ratio is 0.4", true), {
				getConfig: () => t.config,
				say: t.config.callbacks.say,
				removeClosingTag: (_b: any, _t: any, x: any) => x,
			} as any)
			expect(t.order).to.deep.equal(["say:completion_result:partial"])
			expect(t.config.taskState.answerAuditGate.eligibleForBlock).to.equal(false)
			await h.execute(t.config, block("The ratio is 0.42"))
			expect(t.order.slice(1)).to.deep.equal([
				"say:completion_result",
				"checkpoint",
				"say:answer_audit",
				"ask:completion_result",
				"say:user_feedback",
			])
			expect(t.notify.calledOnce).to.equal(true)
		})

		it("eligible: no completion_result streaming, one updating activity line", async () => {
			const t = build({ gate: true })
			const h = new AttemptCompletionHandler()
			const ui: any = {
				getConfig: () => t.config,
				say: t.config.callbacks.say,
				removeClosingTag: (_b: any, _t: any, x: any) => x,
			}
			await h.handlePartialBlock(block("The ratio", true), ui)
			await h.handlePartialBlock(block("The ratio is 0.4", true), ui)
			expect(sayTypes(t.rows)).to.deep.equal(["answer_audit"])
			expect(t.rows[0]).to.include({ text: "Drafting answer…", partial: true })
			expect(t.order.every((o) => o === "say:answer_audit:partial")).to.equal(true)
		})

		it("revision: gate runs first; no notification, completion say, checkpoint, telemetry or ask; counters untouched", async () => {
			const t = build({ gate: true, audit: [hardAudit()] })
			const out = await new AttemptCompletionHandler().execute(t.config, block("The ratio is 0.42"))
			expect(typeof out).to.equal("string")
			expect(ToolExecutor.isToolErrorResult(out as string)).to.equal(false)
			expect(t.notify.called).to.equal(false)
			expect(t.order).to.not.include("checkpoint")
			expect(t.order).to.not.include("ask:completion_result")
			expect(sayTypes(t.rows)).to.deep.equal(["answer_audit"]) // progress swept; one revision row
			const p = parseAnswerAuditPayload(t.rows[0].text)!
			expect(p).to.include({ stage: "revision", attempt: 0 })
			expect(t.config.taskState.consecutiveMistakeCount).to.equal(2) // not reset, not incremented
			expect(t.config.taskState.recentToolErrors).to.deep.equal([])
			expect(t.config.taskState.answerAuditGate.revisions).to.equal(1)
			expect(t.config.taskState.answerAuditGate.hidden?.text).to.equal("The ratio is 0.42")
		})

		it("revision -> pass: shows the revised answer, resets the mistake count only now, final row carries the history", async () => {
			const t = build({ gate: true, audit: [hardAudit()] })
			const h = new AttemptCompletionHandler()
			await h.execute(t.config, block("The ratio is 0.42 and NSE is 0.71"))
			await h.execute(t.config, block("The ratio is 0.42 [run:r1#key_outputs.rr]"))
			expect(sayTypes(t.rows)).to.deep.equal(["answer_audit", "completion_result", "answer_audit", "user_feedback"])
			expect(t.config.taskState.consecutiveMistakeCount).to.equal(0)
			const final = parseAnswerAuditPayload(t.rows[2].text)!
			expect(final).to.include({ stage: "final", attempt: 1, status: "passed" })
			expect(final.history).to.have.length(1)
			expect(final.history![0].draftText).to.equal("The ratio is 0.42 and NSE is 0.71")
			expect(final.droppedQuantities).to.deep.equal(["0.71"])
			expect(t.config.taskState.answerAuditGate.revisions).to.equal(0) // cycle ended
			expect(t.config.taskState.answerAuditGate.hidden).to.equal(undefined)
			expect(t.notify.calledOnce).to.equal(true)
		})

		it("telemetry (an async proxy that cannot be observed here) is ordered after the gate in the source", () => {
			const src = fs.readFileSync(path.join(__dirname, "../tools/handlers/AttemptCompletionHandler.ts"), "utf8")
			const gate = src.indexOf("await evaluateDraft(")
			for (const later of [
				"showSystemNotification({",
				'say("completion_result"',
				"saveCheckpoint(true",
				"captureTaskCompleted(",
				'"command"',
			]) {
				expect(src.indexOf(later, src.indexOf("private async executeBlock")), later).to.be.greaterThan(gate)
			}
		})

		it("2 revisions then still failing: the answer is shown with the unresolved-findings disclosure", async () => {
			const t = build({ gate: true, audit: [hardAudit(), hardAudit(), hardAudit()] })
			const h = new AttemptCompletionHandler()
			await h.execute(t.config, block("a 0.42"))
			await h.execute(t.config, block("b 0.42"))
			await h.execute(t.config, block("c 0.42"))
			expect(sayTypes(t.rows)).to.include("completion_result")
			const final = parseAnswerAuditPayload(t.rows.filter((r) => r.say === "answer_audit").at(-1)!.text)!
			expect(final.stage).to.equal("final")
			expect(final.disclosure).to.deep.equal({
				kind: "findings_remain",
				reason: "Shown with 1 unresolved hard audit findings after 2 revisions.",
			})
			expect(final.attempt).to.equal(2)
			expect(final.history).to.have.length(2)
		})

		it("a message typed while the gate runs reveals the draft, resets the counter and is consumed as feedback", async () => {
			const t = build({ gate: true })
			t.config.taskState.askResponse = "messageResponse"
			t.config.taskState.askResponseText = "actually use 2015"
			const out = (await new AttemptCompletionHandler().execute(t.config, block("The ratio is 0.42"))) as any[]
			expect(JSON.stringify(out)).to.include("actually use 2015")
			const kinds = t.rows.map((r) => (r.say === "answer_audit" ? parseAnswerAuditPayload(r.text)?.stage : r.say))
			expect(kinds).to.deep.equal(["interrupted", "user_feedback"])
			expect(t.config.taskState.askResponse).to.equal(undefined)
			expect(t.config.taskState.answerAuditGate.revisions).to.equal(0)
			expect(t.order).to.not.include("ask:completion_result")
		})

		it("an unavailable audit under the gate shows the answer with the unavailable record", async () => {
			const t = build({ gate: true })
			t.hub.callTool.callsFake(async () => {
				throw new Error("server crashed")
			})
			await new AttemptCompletionHandler().execute(t.config, block("The ratio is 0.42"))
			expect(sayTypes(t.rows)).to.deep.equal(["completion_result", "answer_audit", "user_feedback"])
			expect(parseAnswerAuditPayload(t.rows[1].text)).to.deep.include({ status: "unavailable", stage: "final" })
		})

		it("plan_mode_respond is not gated (source guard) and the gate does not run for a non-eligible task", () => {
			const src = fs.readFileSync(path.join(__dirname, "../tools/handlers/PlanModeRespondHandler.ts"), "utf8")
			expect(src).to.not.match(/answerAuditGate|evaluateDraft/)
		})
	})
})
