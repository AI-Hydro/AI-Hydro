import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { formatResponse } from "@/core/prompts/responses"
import * as notifications from "@/integrations/notifications"
import {
	collectAuditProse,
	cumulativeDropped,
	diffDroppedEvidence,
	droppedEvidenceLines,
	extractQuantities,
	isAuditProgressText,
	isOlderNarrationOnly,
	splitAuditProse,
} from "@/shared/aihydro/answerAuditGate"
import { setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import { MAX_AUDIT_REVISIONS, MAX_DRAFT_TEXT_CHARS, parseAnswerAuditPayload } from "@/shared/aihydro/transcriptContracts"
import type { McpServer } from "@/shared/mcp"
import {
	type AnswerAuditGateState,
	compactPendingRows,
	computeGateEligibility,
	createGateState,
	evaluateDraft,
	finalPayload,
	findUnrevealedRevision,
	type GateContext,
	interruptedFromRevision,
	interruptedPayload,
	noteBindingChanged,
	noteBindingProbed,
	noteSessionStarted,
	resetGateCycle,
	sweepAuditProgress,
} from "../answerAuditGate"
import { type FinalAnswerAuditOutcome, runFinalAnswerAudit } from "../finalAnswerAudit"
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

		it("a probed binding (resumed task) makes the gate eligible without supplying any study id", () => {
			const state = createGateState()
			expect(computeGateEligibility(eligibleInput({ state }) as any)).to.deep.include({ reason: "study-not-bound" })
			noteBindingProbed(state)
			expect(computeGateEligibility(eligibleInput({ state }) as any).eligible).to.equal(true)
			expect(state.boundStudyId).to.equal(undefined)
		})

		it("a rebind clears the cached study", () => {
			const state = createGateState()
			state.boundStudyId = "s1"
			noteBindingChanged(state)
			expect(state.boundStudyId).to.equal(undefined)
		})

		it("the gate is on by default in state defaults (A2/B-web); eligibility still needs a trusted graded server", () => {
			const src = fs.readFileSync(path.join(__dirname, "../../storage/utils/state-helpers.ts"), "utf8")
			expect(src).to.match(/finalAnswerAuditGate: finalAnswerAuditGate \?\? true/)
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
		const pendings: any[] = []
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
				// a `pending` row (the draft persisted before its audit) is checked separately
				;(p.stage === "pending" ? pendings : emitted).push(p)
			},
			setProgress: async (t) => {
				progress.push(t)
			},
			takeUserMessage: () => undefined,
			isAborted: () => false,
			runAudit: runAudit as any,
			...over,
		}
		return { c, emitted, pendings, progress, runAudit }
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

		const priorTurnRows = [
			{ type: "say", say: "user_feedback", text: "go" },
			{ type: "say", say: "api_req_started", text: "{}" },
			{ type: "say", say: "text", text: "Peak flow was 123 m3/s." },
			{ type: "say", say: "api_req_started", text: "{}" },
		]
		const onlyIn = (excerpt: string) =>
			({ ...violated(1), violations: [hard("uncited_number", excerpt)] }) as FinalAnswerAuditOutcome

		it("B1: a number narrated in a prior tool turn IS audited, is disclosed, and does not trigger a revision", async () => {
			const { c, runAudit, emitted } = ctx({ outcomes: [onlyIn("Peak flow was 123 m3/s.")], result: "Done." })
			c.rows = () => priorTurnRows
			const d = await evaluateDraft(c)
			expect(runAudit.firstCall.args[0].answer).to.include("Peak flow was 123 m3/s.")
			expect(d.kind).to.equal("accept")
			expect(emitted).to.have.length(0)
			expect(c.state.revisions).to.equal(0)
			if (d.kind === "accept") {
				expect(d.unrevisable).to.have.length(1)
				const p = finalPayload(d, 1, false)
				expect(p.unrevisableFindings?.[0].excerpt).to.equal("Peak flow was 123 m3/s.")
				expect(p.hardCount).to.equal(1) // still counted honestly in the payload
				expect(parseAnswerAuditPayload(JSON.stringify(p))?.unrevisableFindings).to.have.length(1)
			}
		})

		it("B1: with a revisable finding too, only that one is sent to the model", async () => {
			const out = {
				...violated(2),
				violations: [hard("uncited_number", "Peak flow was 123 m3/s."), hard("uncited_number", "The ratio is 0.42.")],
			} as FinalAnswerAuditOutcome
			const { c, emitted } = ctx({ outcomes: [out], result: "The ratio is 0.42." })
			c.rows = () => priorTurnRows
			const d = await evaluateDraft(c)
			expect(d.kind).to.equal("revise")
			if (d.kind === "revise") {
				expect(d.feedback).to.include("The ratio is 0.42.").and.not.include("123 m3/s")
			}
			expect(emitted[0].unrevisableFindings).to.have.length(1)
		})

		it("F3: the draft is persisted as a hidden pending row BEFORE the audit runs", async () => {
			const order: string[] = []
			const { c } = ctx({ outcomes: [passed] })
			const origEmit = c.emit
			c.emit = async (p) => {
				order.push(`emit:${p.stage}`)
				await origEmit(p)
			}
			c.runAudit = (async () => {
				order.push("audit")
				return passed
			}) as any
			await evaluateDraft(c)
			expect(order).to.deep.equal(["emit:pending", "audit"])
		})

		it("F2: the audit runs on the eligible server and requires trust", async () => {
			const { c, runAudit } = ctx()
			c.serverName = "ai-hydro"
			await evaluateDraft(c)
			expect(runAudit.firstCall.args[0]).to.include({ serverName: "ai-hydro", requireTrusted: true })
		})

		it("F5: the shown answer's removed values are cumulative across revisions", async () => {
			const { c } = ctx({ outcomes: [violated(1), violated(1), passed] })
			c.result = "Flow 5 m3/s and NSE 0.71 and bias 3 %."
			await evaluateDraft(c) // draft 0
			c.result = "Flow 5 m3/s and NSE 0.71 and runoff 0.4." // drops bias 3 %, adds 0.4
			await evaluateDraft(c) // draft 1
			c.result = "Flow 5 m3/s."
			const last = await evaluateDraft(c)
			expect(last.kind).to.equal("accept")
			if (last.kind === "accept") {
				expect(last.dropped?.droppedQuantities).to.have.members(["0.71", "3 %", "0.4"])
			}
		})

		it("an abort while auditing returns aborted and emits nothing", async () => {
			const { c, emitted } = ctx({ outcomes: [violated(1)] })
			c.isAborted = () => true
			expect((await evaluateDraft(c)).kind).to.equal("aborted")
			expect(emitted).to.have.length(0)
		})
	})

	describe("F2 server selection (runFinalAnswerAudit)", () => {
		const evil = server({ name: "aihydro", config: JSON.stringify({ type: "stdio", command: "/tmp/evil", args: [] }) })
		const good = server({ name: "ai-hydro" })
		const mk = (servers: McpServer[]) => {
			const seen: string[] = []
			const hub: any = {
				getServers: () => servers,
				callTool: async (s: string, tool: string) => {
					seen.push(s)
					const body =
						tool === "aihydro_chat_status"
							? { bound: true, study_id: "study-1" }
							: { session_id: "study-1", passed: true, violations: [], hard_count: 0, advisory_count: 0 }
					return { content: [{ type: "text", text: JSON.stringify(body) }] }
				},
			}
			return { hub, seen }
		}
		const args = { ulid: "u", workspaceRoot: "/ws", answer: "NSE 0.71" }

		it("display-only audit prefers the trusted server even when an untrusted alias is listed first", async () => {
			const { hub, seen } = mk([evil, good])
			await runFinalAnswerAudit({ ...args, hub })
			expect(new Set(seen)).to.deep.equal(new Set(["ai-hydro"]))
		})

		it("with only an untrusted alias: display-only still audits (unchanged), the gate (requireTrusted) does not", async () => {
			const a = mk([evil])
			expect((await runFinalAnswerAudit({ ...args, hub: a.hub })).status).to.equal("passed")
			const b = mk([evil])
			const lost = await runFinalAnswerAudit({ ...args, hub: b.hub, requireTrusted: true })
			// N1: under the gate a missing trusted server is an audit that did not run, never a silent skip
			expect(lost).to.deep.equal({ status: "unavailable", reason: "trusted audit server no longer connected" })
			expect(b.seen).to.deep.equal([])
		})

		it("an explicit serverName pins the audit to that server", async () => {
			const other = server({ name: "ai-hydro" })
			const { hub, seen } = mk([evil, other])
			await runFinalAnswerAudit({ ...args, hub, serverName: "aihydro" })
			expect(new Set(seen)).to.deep.equal(new Set(["aihydro"]))
		})
	})

	// ── dropped-value disclosure (M4) ──────────────────────────────────────────────────────────────────────────

	describe("dropped evidence (approximate, extension-side)", () => {
		it("F4: a sign flip is a drop; superscripts normalise; .7 and scientific notation are quantities", () => {
			expect(diffDroppedEvidence("bias -0.3 m", "bias 0.3 m").droppedQuantities).to.deep.equal(["-0.3 m"])
			expect(diffDroppedEvidence("bias −0.3 m", "bias 0.3 m").droppedQuantities).to.deep.equal(["−0.3 m"])
			expect(diffDroppedEvidence("area 12 km²", "area 12 km2").droppedQuantities).to.deep.equal([])
			expect(diffDroppedEvidence("flow 9 m³/s", "flow 9 m3/s").droppedQuantities).to.deep.equal([])
			expect(extractQuantities("share .7 of flow")).to.deep.equal([".7"])
			expect(diffDroppedEvidence("share .7", "share 0.7").droppedQuantities).to.deep.equal([])
			expect(extractQuantities("k = 1.5e-3 m")).to.deep.equal(["1.5e-3 m"])
			expect(extractQuantities("range 0.35-0.50")).to.deep.equal(["0.35", "0.50"])
		})

		it("F5: cumulativeDropped keeps a value an intermediate revision removed", () => {
			const d = cumulativeDropped("a 1 m", "a 1 m", { quantities: ["7 m"], markers: ["[claim:C1]"] })
			expect(d.droppedQuantities).to.deep.equal(["7 m"])
			expect(d.droppedClaimMarkers).to.deep.equal(["[claim:C1]"])
			// ... but not one that is back in the shown answer
			expect(cumulativeDropped("a", "a 7 m", { quantities: ["7 m"], markers: [] }).droppedQuantities).to.deep.equal([])
		})

		it("B1: narration since the last user message is audited; older-turn text is split from this turn's", () => {
			const rows = [
				{ type: "say", say: "text", text: "before the user message 8.8 m3/s" },
				{ type: "say", say: "user_feedback", text: "go" },
				{ type: "say", say: "api_req_started", text: "{}" },
				{ type: "say", say: "text", text: "turn 1 narration 9.9 m3/s" },
				{ type: "say", say: "api_req_started", text: "{}" },
				{ type: "say", say: "text", text: "this turn 4.2 m3/s" },
			]
			const sp = splitAuditProse(rows, "result 1 m")
			expect(sp.full).to.equal("turn 1 narration 9.9 m3/s\n\nthis turn 4.2 m3/s\n\nresult 1 m")
			expect(sp.older).to.equal("turn 1 narration 9.9 m3/s")
			expect(sp.current).to.equal("this turn 4.2 m3/s\n\nresult 1 m")
			expect(isOlderNarrationOnly("turn 1 narration 9.9 m3/s", sp.older, sp.current)).to.equal(true)
			expect(isOlderNarrationOnly("…this turn 4.2…", sp.older, sp.current)).to.equal(false)
			expect(isOlderNarrationOnly(undefined, sp.older, sp.current)).to.equal(false) // unlocatable: revisable
		})

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

		it("F3: reload during the first audit reveals the pending draft as an unchecked draft", async () => {
			const { c, pendings } = ctx()
			c.runAudit = (() => new Promise(() => {})) as any
			c.deadlineMs = 10
			await evaluateDraft(c) // times out, but the pending row was already persisted
			const pending = pendings[0]
			expect(pending.stage).to.equal("pending")
			expect(pending.draftText).to.equal("The runoff ratio is 0.42.")
			const row = { type: "say", say: "answer_audit", text: JSON.stringify(pending) }
			const found = findUnrevealedRevision([row])
			expect(found?.draftText).to.equal(pending.draftText)
			const revealed = interruptedFromRevision(found!, "VS Code reloaded or the task was resumed")
			expect(revealed).to.deep.include({ stage: "interrupted", status: "unavailable" })
			expect(revealed.disclosure).to.deep.equal({ kind: "interrupted", reason: "VS Code reloaded or the task was resumed" })
			expect(findUnrevealedRevision([row, { type: "say", say: "completion_result", text: "x" }])).to.equal(undefined)
		})

		it("F9: a later user message means the draft was already dealt with (no duplicate reveal)", async () => {
			const { c, emitted } = ctx({ outcomes: [violated(1)] })
			await evaluateDraft(c)
			const row = { type: "say", say: "answer_audit", text: JSON.stringify(emitted[0]) }
			expect(findUnrevealedRevision([row])).to.not.equal(undefined)
			expect(findUnrevealedRevision([row, { type: "say", say: "user_feedback", text: "hm" }])).to.equal(undefined)
		})

		it("N2: compacting drops draft text from pending rows only, keeping the hash", async () => {
			const { c, pendings, emitted } = ctx({ outcomes: [violated(1)] })
			await evaluateDraft(c)
			let rows: any[] = [
				{ type: "say", say: "answer_audit", text: JSON.stringify(pendings[0]) },
				{ type: "say", say: "answer_audit", text: JSON.stringify(emitted[0]) },
			]
			const store: any = {
				getAiHydroMessages: () => rows,
				updateAiHydroMessage: async (i: number, u: any) => {
					rows[i] = { ...rows[i], ...u }
				},
			}
			expect(await compactPendingRows(store)).to.equal(1)
			const pending = JSON.parse(rows[0].text)
			expect(pending.draftText).to.equal(undefined)
			expect(pending.draftHash).to.equal(pendings[0].draftHash)
			expect(JSON.parse(rows[1].text).draftText).to.equal(emitted[0].draftText) // the revision row keeps its draft
			expect(await compactPendingRows(store)).to.equal(0)
			rows = []
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
					updateAiHydroMessage: async (i: number, u: any) => {
						rows[i] = { ...rows[i], ...u }
					},
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
		const vis = (t: { rows: any[] }): any[] =>
			t.rows.filter((r) => !(r.say === "answer_audit" && parseAnswerAuditPayload(r.text)?.stage === "pending"))
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

		it("honest exit: outcome partial is recorded on the answer row, and is not a mistake", async () => {
			const t = build({ gate: false })
			t.config.taskState.consecutiveMistakeCount = 3
			const b = block("Streamflow fetched; no observed record for 2010-2015.")
			b.params.outcome = "partial"
			b.params.unmet = "- no observed streamflow for 2010-2015"
			await new AttemptCompletionHandler().execute(t.config, b)
			const completion = t.say.getCalls().find((c) => c.args[0] === "completion_result")!
			expect(completion.args[5]).to.deep.equal({
				completionOutcome: { outcome: "partial", unmet: ["no observed streamflow for 2010-2015"] },
			})
			expect(t.config.taskState.consecutiveMistakeCount).to.equal(0)
		})

		it("the declared outcome is sent to an audit tool that declares it, and not to one that does not", async () => {
			const declaring = server({
				tools: [
					{
						name: "audit_interpretation",
						description: GRADED_DESC,
						inputSchema: { type: "object", properties: { prose: {}, session_id: {}, outcome: {}, unmet: {} } },
					} as any,
					{ name: "aihydro_chat_status" } as any,
				],
			})
			const t = build({ gate: false, servers: [declaring] })
			const b = block("The ratio is 0.42 for part of it.")
			b.params.outcome = "partial"
			b.params.unmet = "- no record"
			await new AttemptCompletionHandler().execute(t.config, b)
			const call = t.hub.callTool.getCalls().find((c: any) => c.args[1] === "audit_interpretation")!
			expect(call.args[2]).to.include({ outcome: "partial" })
			expect(call.args[2].unmet).to.deep.equal(["no record"])
		})

		it("an audit tool without those parameters is not sent them", async () => {
			const t = build({ gate: false })
			const b = block("The ratio is 0.42 for part of it.")
			b.params.outcome = "partial"
			await new AttemptCompletionHandler().execute(t.config, b)
			const call = t.hub.callTool.getCalls().find((c: any) => c.args[1] === "audit_interpretation")!
			expect(call.args[2]).to.not.have.property("outcome")
		})

		it("a normal completion records no outcome (done, absent or unrecognised)", async () => {
			for (const outcome of [undefined, "done", "finished-ish"]) {
				sinon.restore() // build() stubs the notification module each time
				setRecordedFirstPartyLauncher(LAUNCHER as any)
				const t = build({ gate: false })
				const b = block("The ratio is 0.42")
				if (outcome) {
					b.params.outcome = outcome
				}
				await new AttemptCompletionHandler().execute(t.config, b)
				const completion = t.say.getCalls().find((c) => c.args[0] === "completion_result")!
				expect(completion.args[5], String(outcome)).to.equal(undefined)
			}
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
			expect(sayTypes(vis(t))).to.deep.equal(["answer_audit"])
			expect(vis(t)[0]).to.include({ text: "Drafting answer…", partial: true })
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
			expect(sayTypes(vis(t))).to.deep.equal(["answer_audit"]) // progress swept; one revision row
			const p = parseAnswerAuditPayload(vis(t)[0].text)!
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
			expect(sayTypes(vis(t))).to.deep.equal(["answer_audit", "completion_result", "answer_audit", "user_feedback"])
			expect(t.config.taskState.consecutiveMistakeCount).to.equal(0)
			const final = parseAnswerAuditPayload(vis(t)[2].text)!
			expect(final).to.include({ stage: "final", attempt: 1, status: "passed" })
			expect(final.history).to.have.length(1)
			expect(final.history![0].draftText).to.equal("The ratio is 0.42 and NSE is 0.71")
			expect(final.droppedQuantities).to.deep.equal(["0.71"])
			// N2: once the final row exists no pending row still carries a draft (stored once, in the final payload)
			const pendingRows = t.rows
				.filter((r) => r.say === "answer_audit")
				.map((r) => JSON.parse(r.text))
				.filter((p) => p.stage === "pending")
			expect(pendingRows.length).to.be.greaterThan(0)
			expect(pendingRows.every((p) => p.draftText === undefined && /^[0-9a-f]{64}$/.test(p.draftHash))).to.equal(true)
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
			expect(sayTypes(vis(t))).to.include("completion_result")
			const final = parseAnswerAuditPayload(
				vis(t)
					.filter((r) => r.say === "answer_audit")
					.at(-1)!.text,
			)!
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
			const kinds = vis(t).map((r) => (r.say === "answer_audit" ? parseAnswerAuditPayload(r.text)?.stage : r.say))
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
			expect(sayTypes(vis(t))).to.deep.equal(["completion_result", "answer_audit", "user_feedback"])
			expect(parseAnswerAuditPayload(vis(t)[1].text)).to.deep.include({ status: "unavailable", stage: "final" })
		})

		it("F1: a denied completion command still emits the revised answer's final record and ends the cycle", async () => {
			const t = build({ gate: true, audit: [hardAudit()] })
			t.config.callbacks.ask.callsFake(async (type: string) => {
				t.order.push(`ask:${type}`)
				return { response: "noButtonClicked" }
			})
			const h = new AttemptCompletionHandler()
			await h.execute(t.config, block("The ratio is 0.42 and NSE is 0.71"))
			const cmd: any = block("The ratio is 0.42 [run:r1#key_outputs.rr]")
			cmd.params.command = "echo hi"
			const out = await h.execute(t.config, cmd)
			expect(String(out)).to.match(/denied|rejected/i)
			const finals = vis(t)
				.filter((r) => r.say === "answer_audit")
				.map((r) => parseAnswerAuditPayload(r.text)!)
				.filter((p) => p.stage === "final")
			expect(finals).to.have.length(1)
			expect(finals[0].attempt).to.equal(1)
			expect(finals[0].droppedQuantities).to.deep.equal(["0.71"])
			// before the command ask, so the ask's buttons are not hidden
			const order = vis(t).map((r) => r.say)
			expect(order.indexOf("answer_audit", order.indexOf("completion_result"))).to.be.greaterThan(
				order.indexOf("completion_result"),
			)
			expect(t.order.indexOf("ask:command")).to.be.greaterThan(t.order.lastIndexOf("say:answer_audit"))
			expect(t.config.taskState.answerAuditGate.revisions).to.equal(0)
		})

		it("F2: two alias servers, the untrusted one listed first: the gate audits on the trusted one", async () => {
			const evil = server({
				name: "ai-hydro-2",
				config: JSON.stringify({ type: "stdio", command: "/tmp/evil", args: [] }),
			})
			const good = server({ name: "ai-hydro" })
			const t = build({ gate: true, audit: [hardAudit()], servers: [evil, good] })
			const calls: string[] = []
			const orig = t.hub.callTool
			t.hub.callTool = sinon.stub().callsFake(async (s: string, ...rest: any[]) => {
				calls.push(s)
				return orig(s, ...rest)
			}) as any
			await new AttemptCompletionHandler().execute(t.config, block("The ratio is 0.42"))
			expect(calls.length).to.be.greaterThan(0)
			expect(new Set(calls)).to.deep.equal(new Set(["ai-hydro"]))
		})

		it("plan_mode_respond is not gated (source guard) and the gate does not run for a non-eligible task", () => {
			const src = fs.readFileSync(path.join(__dirname, "../tools/handlers/PlanModeRespondHandler.ts"), "utf8")
			expect(src).to.not.match(/answerAuditGate|evaluateDraft/)
		})
	})
})
