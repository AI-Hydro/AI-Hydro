import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import sinon from "sinon"
import { parseAnswerAuditPayload } from "@/shared/aihydro/transcriptContracts"
import type { McpServer } from "@/shared/mcp"
import { createGateState } from "../answerAuditGate"
import {
	type AuditHub,
	formatFinalAnswerAudit,
	hasAuditableContent,
	runFinalAnswerAudit,
	toAnswerAuditPayload,
} from "../finalAnswerAudit"
import { AttemptCompletionHandler } from "../tools/handlers/AttemptCompletionHandler"

const AUDIT_TOOL = { name: "audit_interpretation" }
const STATUS_TOOL = { name: "aihydro_chat_status" }
const BOUND = { bound: true, study_id: "study-1" }

function server(overrides: Partial<McpServer> = {}): McpServer {
	return { name: "ai-hydro", status: "connected", config: "{}", tools: [AUDIT_TOOL, STATUS_TOOL], ...overrides } as McpServer
}

function textResponse(obj: unknown, isError = false) {
	return { isError, content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } as any
}

/**
 * `callTool` is the stub that answers audit_interpretation (so existing assertions on its calls hold);
 * aihydro_chat_status is answered by `status` (default: chat bound to study-1).
 */
function mockHub(
	servers: McpServer[],
	callTool: sinon.SinonStub = sinon.stub(),
	status: any = textResponse(BOUND),
): AuditHub & { callTool: sinon.SinonStub; statusCalls: any[][] } {
	const statusCalls: any[][] = []
	const router = (serverName: string, tool: string, ...rest: any[]) => {
		if (tool === "aihydro_chat_status") {
			statusCalls.push([serverName, tool, ...rest])
			return status instanceof Error ? Promise.reject(status) : Promise.resolve(status)
		}
		return callTool(serverName, tool, ...rest)
	}
	return { getServers: () => servers, callTool: router, statusCalls, auditStub: callTool } as any
}

const PASS = { session_id: "study-1", passed: true, violations: [], cited_numeric_count: 2, total_numeric_count: 2 }
const FAIL = {
	session_id: "study-1",
	passed: false,
	cited_numeric_count: 0,
	total_numeric_count: 1,
	violations: [
		{
			kind: "uncited_number",
			text_excerpt: "NSE was 0.71",
			message: "numeric literal 0.71 has no evidence marker",
			fix_hint: "Add [run:<id>#nse] or remove the number",
		},
	],
}

describe("final-answer audit", () => {
	describe("runFinalAnswerAudit", () => {
		it("calls audit_interpretation with the answer as prose and the ai-hydro context (incl. model_id_returned)", async () => {
			const callTool = sinon.stub().resolves(textResponse(PASS))
			const out = await runFinalAnswerAudit({
				hub: mockHub([server()], callTool),
				ulid: "chat-1",
				workspaceRoot: "/ws",
				answer: "NSE is 0.71 [run:r1#nse]",
				modelIdReturned: "claude-opus-5-5-x",
			})
			expect(out).to.deep.equal({ status: "passed", sessionId: "study-1", cited: 2, total: 2, schema: "legacy" })
			const [serverName, tool, args, ulid, meta] = callTool.firstCall.args
			expect(serverName).to.equal("ai-hydro")
			expect(tool).to.equal("audit_interpretation")
			expect(args.prose).to.equal("NSE is 0.71 [run:r1#nse]")
			expect(args.session_id).to.equal("study-1")
			expect(ulid).to.equal("chat-1")
			expect(meta["aihydro/context"]).to.include({ chat_id: "chat-1", model_id_returned: "claude-opus-5-5-x" })
		})

		it("reports violations with fix hints", async () => {
			const out = await runFinalAnswerAudit({
				hub: mockHub([server()], sinon.stub().resolves(textResponse(FAIL))),
				ulid: "c",
				workspaceRoot: undefined,
				answer: "NSE was 0.71",
			})
			expect(out.status).to.equal("violations")
			const text = formatFinalAnswerAudit(out) as string
			expect(text).to.include("found 1 issue")
			expect(text).to.include("ungraded")
			expect(text).to.include("study `study-1`")
			expect(text).to.include("uncited_number")
			expect(text).to.include("`Fix: Add [run:<id>#nse]")
			expect(text).to.include("answer above is unchanged")
		})

		it("is skipped (silent) when no AI-Hydro server is connected", async () => {
			const callTool = sinon.stub()
			for (const servers of [[], [server({ name: "other" })], [server({ status: "disconnected" })]]) {
				const out = await runFinalAnswerAudit({
					hub: mockHub(servers, callTool),
					ulid: "c",
					workspaceRoot: "/w",
					answer: "x 1",
				})
				expect(out).to.deep.equal({ status: "skipped", reason: "no-ai-hydro-server" })
				expect(formatFinalAnswerAudit(out)).to.equal(undefined)
			}
			expect(callTool.called).to.equal(false)
		})

		it("is skipped when the answer has no numbers or evidence markers", async () => {
			const callTool = sinon.stub()
			const out = await runFinalAnswerAudit({
				hub: mockHub([server()], callTool),
				ulid: "c",
				workspaceRoot: "/w",
				answer: "Done.",
			})
			expect(out).to.deep.equal({ status: "skipped", reason: "nothing-to-audit" })
			expect(callTool.called).to.equal(false)
			expect(hasAuditableContent("see [claim:abc]")).to.equal(true)
			expect(hasAuditableContent("0.71")).to.equal(true)
		})

		it("shows 'audit unavailable' when the call throws, times out, errors, or returns junk", async () => {
			const cases: Array<[string, sinon.SinonStub, number?]> = [
				["throws", sinon.stub().rejects(new Error("connection closed"))],
				["isError", sinon.stub().resolves(textResponse("boom", true))],
				["tool-level error", sinon.stub().resolves(textResponse({ error: "no session bound to this chat" }))],
				["not json", sinon.stub().resolves(textResponse("<html>"))],
				["unrecognised", sinon.stub().resolves(textResponse({ ok: 1 }))],
				["timeout", sinon.stub().returns(new Promise(() => {})), 20],
			]
			for (const [label, callTool, timeoutMs] of cases) {
				const out = await runFinalAnswerAudit({
					hub: mockHub([server()], callTool),
					ulid: "c",
					workspaceRoot: "/w",
					answer: "NSE 0.7",
					timeoutMs,
				})
				expect(out.status, label).to.equal("unavailable")
				const text = formatFinalAnswerAudit(out) as string
				expect(text, label).to.include("Answer audit unavailable")
				expect(text, label).to.include("NOT checked")
			}
		})

		it("skips (no unrelated-ledger fallback) when no research session is bound to this chat", async () => {
			const callTool = sinon.stub().resolves(textResponse(PASS))
			const hub = mockHub([server()], callTool, textResponse({ bound: false, study_id: null }))
			const out = await runFinalAnswerAudit({ hub, ulid: "chat-1", workspaceRoot: "/w", answer: "NSE 0.7" })
			expect(out).to.deep.equal({ status: "skipped", reason: "no-research-session" })
			expect(callTool.called).to.equal(false)
			expect(hub.statusCalls[0][2]).to.include({ chat_id: "chat-1" })
		})

		it("is unavailable (not a guess) when the binding cannot be determined", async () => {
			for (const status of [new Error("boom"), textResponse("nope"), textResponse({ ok: 1 }), textResponse("x", true)]) {
				const callTool = sinon.stub().resolves(textResponse(PASS))
				const out = await runFinalAnswerAudit({
					hub: mockHub([server()], callTool, status),
					ulid: "c",
					workspaceRoot: "/w",
					answer: "NSE 0.7",
				})
				expect(out.status).to.equal("unavailable")
				expect(callTool.called).to.equal(false)
			}
			const noStatusTool = mockHub([server({ tools: [AUDIT_TOOL] as any })])
			expect(
				(await runFinalAnswerAudit({ hub: noStatusTool, ulid: "c", workspaceRoot: "/w", answer: "NSE 0.7" })).status,
			).to.equal("unavailable")
		})

		it("is unavailable if the audit ran against a different session than the bound one", async () => {
			const out = await runFinalAnswerAudit({
				hub: mockHub([server()], sinon.stub().resolves(textResponse({ ...PASS, session_id: "other-study" }))),
				ulid: "c",
				workspaceRoot: "/w",
				answer: "NSE 0.7",
			})
			expect(out.status).to.equal("unavailable")
			expect((out as any).reason).to.include("other-study")
		})

		it("reports unavailable when the connected server has tools but not audit_interpretation", async () => {
			const out = await runFinalAnswerAudit({
				hub: mockHub([server({ tools: [{ name: "other" } as any, STATUS_TOOL] })]),
				ulid: "c",
				workspaceRoot: "/w",
				answer: "x 1",
			})
			expect(out.status).to.equal("unavailable")
		})
	})

	describe("graded schema, payload and no truncation", () => {
		const GRADED = {
			session_id: "study-1",
			passed: false,
			hard_count: 1,
			advisory_count: 1,
			exempt_by_reason: { year_like: 2 },
			cited_numeric_count: 3,
			total_numeric_count: 5,
			violations: [
				{
					kind: "uncited_number",
					severity: "hard",
					category: "quantity",
					text_excerpt: "NSE was 0.71",
					message: "no marker",
					suggested_marker: "[run:r1#nse]",
				},
				{ kind: "stale_claim", severity: "advisory", resolved_path: "runs/r1/nse", fix_hint: "re-run" },
			],
		}
		const audit = (body: unknown) =>
			runFinalAnswerAudit({
				hub: mockHub([server()], sinon.stub().resolves(textResponse(body))),
				ulid: "c",
				workspaceRoot: "/w",
				answer: "NSE was 0.71",
			})

		it("parses severities, counts, exemptions and extras", async () => {
			const out: any = await audit(GRADED)
			expect(out.status).to.equal("violations")
			expect(out.schema).to.equal("graded")
			expect(out.hardCount).to.equal(1)
			expect(out.advisoryCount).to.equal(1)
			expect(out.exemptByReason).to.deep.equal({ year_like: 2 })
			expect(out.violations.map((v: any) => v.severity)).to.deep.equal(["hard", "advisory"])
			expect(out.violations[0]).to.include({ category: "quantity", suggestedMarker: "[run:r1#nse]" })
			expect(out.violations[1].resolvedPath).to.equal("runs/r1/nse")
		})

		it("graded pass with only advisories is reported as findings, never as 'passed'", async () => {
			const out: any = await audit({ ...GRADED, passed: true, hard_count: 0, violations: [GRADED.violations[1]] })
			expect(out.status).to.equal("violations")
			expect(out.hardCount).to.equal(0)
			expect(out.advisoryCount).to.equal(1)
		})

		it("legacy responses (no hard_count) make every violation severity 'unknown', never hard", async () => {
			const out: any = await audit({ ...FAIL, violations: [{ ...FAIL.violations[0], severity: "hard" }] })
			expect(out.schema).to.equal("legacy")
			expect(out.violations[0].severity).to.equal("unknown")
			expect(out.hardCount).to.equal(0)
			const payload = toAnswerAuditPayload(out, { stage: "final", attempt: 0, answerTs: 5, answer: "NSE was 0.71" })
			expect(payload.schema).to.equal("legacy")
			expect(payload.violations[0].severity).to.equal("unknown")
		})

		it("keeps all 21 violations (no 10-item cap) in outcome and payload", async () => {
			const many = Array.from({ length: 21 }, (_, i) => ({ kind: "uncited_number", severity: "hard", message: `m${i}` }))
			const out: any = await audit({
				session_id: "study-1",
				passed: false,
				hard_count: 21,
				advisory_count: 0,
				violations: many,
			})
			expect(out.violations).to.have.length(21)
			expect(out.totalViolations).to.equal(21)
			const payload = toAnswerAuditPayload(out, { stage: "final", attempt: 0, answerTs: 5, answer: "x" })
			expect(payload.violations).to.have.length(21)
			expect(payload.hardCount).to.equal(21)
			expect(parseAnswerAuditPayload(JSON.stringify(payload))?.violations).to.have.length(21)
			// the plain-text fallback is a display surface and may cap
			expect(formatFinalAnswerAudit(out)).to.include("...and 11 more.")
		})

		it("builds a frozen-contract v1 payload that the tolerant reader accepts", async () => {
			const out = await audit(GRADED)
			const payload = toAnswerAuditPayload(out, { stage: "final", attempt: 0, answerTs: 1234, answer: "NSE was 0.71" })
			expect(payload).to.include({
				v: 1,
				stage: "final",
				status: "violations",
				schema: "graded",
				attempt: 0,
				answerTs: 1234,
				hardCount: 1,
				advisoryCount: 1,
				sessionId: "study-1",
				cited: 3,
				total: 5,
			})
			expect(payload.draftHash).to.match(/^[0-9a-f]{64}$/)
			expect(payload.violations[0].fixHint).to.equal(undefined)
			expect(payload.violations[0]).to.include({ suggestedMarker: "[run:r1#nse]", category: "quantity" })
			expect(payload.violations[1].resolvedPath).to.equal("runs/r1/nse")
			expect(payload.exemptByReason).to.deep.equal({ year_like: 2 })
			expect(parseAnswerAuditPayload(JSON.stringify(payload))).to.deep.equal(payload)
		})

		it("passed:false with no violations is unavailable (inconsistent), never 0 findings", async () => {
			for (const body of [
				{ session_id: "study-1", passed: false, violations: [] },
				{ session_id: "study-1", passed: false, hard_count: 0, advisory_count: 0, violations: [] },
			]) {
				const out: any = await audit(body)
				expect(out).to.deep.equal({ status: "unavailable", reason: "inconsistent audit response" })
			}
		})

		it("skipped payload has its own disclosure kind; unknown payload fields are ignored", () => {
			const payload = toAnswerAuditPayload(
				{ status: "skipped", reason: "no-research-session" },
				{ stage: "final", attempt: 0, answerTs: 9, answer: "x 1" },
			)
			expect(payload.disclosure).to.deep.equal({ kind: "audit_skipped", reason: "no-research-session" })
			const withExtra = JSON.stringify({
				...payload,
				futureField: 1,
				violations: [{ kind: "k", severity: "hard", zzz: 1 }],
			})
			const back = parseAnswerAuditPayload(withExtra) as any
			expect(back.futureField).to.equal(undefined)
			expect(back.violations[0]).to.deep.equal({ kind: "k", severity: "hard" })
		})

		it("unavailable payload carries status and reason, with no violations", () => {
			const payload = toAnswerAuditPayload(
				{ status: "unavailable", reason: "timed out after 15s" },
				{ stage: "final", attempt: 0, answerTs: 9, answer: "x 1" },
			)
			expect(payload.status).to.equal("unavailable")
			expect(payload.disclosure).to.deep.equal({ kind: "audit_unavailable", reason: "timed out after 15s" })
			expect(payload.violations).to.deep.equal([])
			expect(parseAnswerAuditPayload(JSON.stringify(payload))?.status).to.equal("unavailable")
		})
	})

	describe("AttemptCompletionHandler integration", () => {
		function makeConfig(opts: { hub: AuditHub; enabled?: boolean }) {
			const order: string[] = []
			const say = sinon.stub().callsFake(async (type: string, text?: string) => {
				order.push(`say:${type}:${(text ?? "").slice(0, 24)}`)
				return 1
			})
			const ask = sinon.stub().callsFake(async (type: string) => {
				order.push(`ask:${type}`)
				return { response: "messageResponse", text: "thanks" }
			})
			const config: any = {
				ulid: "chat-1",
				cwd: "/ws",
				taskState: { consecutiveMistakeCount: 0, lastResponseModelId: "m-returned", answerAuditGate: createGateState() },
				autoApprovalSettings: { enabled: false },
				focusChainSettings: { enabled: false },
				messageState: { getAiHydroMessages: () => [], updateAiHydroMessage: async () => {} },
				services: {
					mcpHub: opts.hub,
					// Only the display-only audit toggle is set here; the pre-completion gate (W2-C) is off.
					stateManager: {
						getGlobalSettingsKey: (k: string) => (k === "finalAnswerAuditEnabled" ? opts.enabled : undefined),
					},
				},
				callbacks: {
					say,
					ask,
					saveCheckpoint: async () => {},
					doesLatestTaskCompletionHaveNewChanges: async () => false,
					updateFCListFromToolResponse: async () => {},
				},
			}
			return { config, order, say }
		}
		const block: any = { name: "attempt_completion", params: { result: "NSE was 0.71" }, partial: false }

		it("renders violations before the completion ask, and does not change the answer", async () => {
			const callTool = sinon.stub().resolves(textResponse(FAIL))
			const { config, order, say } = makeConfig({ hub: mockHub([server()], callTool), enabled: true })
			await new AttemptCompletionHandler().execute(config, block)
			expect(order).to.deep.equal([
				"say:completion_result:NSE was 0.71",
				'say:answer_audit:{"v":1,"stage":"final","',
				"ask:completion_result",
				"say:user_feedback:thanks",
			])
			// the completion_result text is exactly the model's answer
			expect(say.firstCall.args).to.deep.equal(["completion_result", "NSE was 0.71", undefined, undefined, false])
			expect(callTool.firstCall.args[2].prose).to.equal("NSE was 0.71")
			const auditCall = say.getCalls().find((c: any) => c.args[0] === "answer_audit")
			const payload = parseAnswerAuditPayload(auditCall!.args[1])
			expect(payload).to.include({ status: "violations", stage: "final", schema: "legacy" })
			expect(payload!.violations[0].severity).to.equal("unknown")
		})

		it("emits a structured unavailable payload with the reason, never say:text", async () => {
			const callTool = sinon.stub().rejects(new Error("server crashed"))
			const { config, say } = makeConfig({ hub: mockHub([server()], callTool), enabled: true })
			await new AttemptCompletionHandler().execute(config, block)
			expect(say.getCalls().some((c: any) => c.args[0] === "text")).to.equal(false)
			const payload = parseAnswerAuditPayload(say.getCalls().find((c: any) => c.args[0] === "answer_audit")!.args[1])
			expect(payload?.status).to.equal("unavailable")
			expect(payload?.disclosure?.reason).to.include("server crashed")
		})

		it("does not emit a second row when the success-path say throws", async () => {
			const { config, say } = makeConfig({
				hub: mockHub([server()], sinon.stub().resolves(textResponse(PASS))),
				enabled: true,
			})
			say.callsFake(async (type: string) => {
				if (type === "answer_audit") {
					throw new Error("say failed")
				}
				return 1
			})
			await new AttemptCompletionHandler().execute(config, block)
			expect(say.getCalls().filter((c: any) => c.args[0] === "answer_audit")).to.have.length(1)
		})

		it("emits no row when the audit is skipped", async () => {
			const { config, order } = makeConfig({ hub: mockHub([]), enabled: true })
			await new AttemptCompletionHandler().execute(config, block)
			expect(order.some((o) => o.startsWith("say:answer_audit"))).to.equal(false)
		})

		it("no source path emits the audit as say:text (grep guard)", () => {
			const src = fs.readFileSync(path.join(__dirname, "../tools/handlers/AttemptCompletionHandler.ts"), "utf8")
			expect(src).to.not.match(/say\(\s*"text"/)
			expect(src).to.not.include("formatFinalAnswerAudit")
		})

		it("shows 'audit unavailable' and still completes when the MCP hub fails", async () => {
			const callTool = sinon.stub().rejects(new Error("server crashed"))
			const { config, order } = makeConfig({ hub: mockHub([server()], callTool), enabled: true })
			const result: any = await new AttemptCompletionHandler().execute(config, block)
			expect(order[1]).to.match(/^say:answer_audit:/)
			expect(order[2]).to.equal("ask:completion_result")
			expect(result[0].text).to.equal("[attempt_completion] Result:")
		})

		it("is default-on when the setting is unset, off only when explicitly false", async () => {
			const on = makeConfig({ hub: mockHub([server()], sinon.stub().resolves(textResponse(PASS))), enabled: undefined })
			await new AttemptCompletionHandler().execute(on.config, block)
			expect(on.order.some((o) => o.startsWith("say:answer_audit:"))).to.equal(true)
			expect(on.order.some((o) => o.startsWith("say:text:"))).to.equal(false)

			const callTool = sinon.stub().resolves(textResponse(PASS))
			const off = makeConfig({ hub: mockHub([server()], callTool), enabled: false })
			await new AttemptCompletionHandler().execute(off.config, block)
			expect(callTool.called).to.equal(false)
			expect(off.order).to.deep.equal([
				"say:completion_result:NSE was 0.71",
				"ask:completion_result",
				"say:user_feedback:thanks",
			])
		})
	})
})
