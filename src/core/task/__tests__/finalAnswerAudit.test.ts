import { expect } from "chai"
import { describe, it } from "mocha"
import sinon from "sinon"
import type { McpServer } from "@/shared/mcp"
import { type AuditHub, formatFinalAnswerAudit, hasAuditableContent, runFinalAnswerAudit } from "../finalAnswerAudit"
import { AttemptCompletionHandler } from "../tools/handlers/AttemptCompletionHandler"

const AUDIT_TOOL = { name: "audit_interpretation" }

function server(overrides: Partial<McpServer> = {}): McpServer {
	return { name: "ai-hydro", status: "connected", config: "{}", tools: [AUDIT_TOOL], ...overrides } as McpServer
}

function textResponse(obj: unknown, isError = false) {
	return { isError, content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } as any
}

function mockHub(servers: McpServer[], callTool: sinon.SinonStub = sinon.stub()): AuditHub & { callTool: sinon.SinonStub } {
	return { getServers: () => servers, callTool } as any
}

const PASS = { passed: true, violations: [], cited_numeric_count: 2, total_numeric_count: 2 }
const FAIL = {
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
			expect(out).to.deep.equal({ status: "passed", cited: 2, total: 2 })
			const [serverName, tool, args, ulid, meta] = callTool.firstCall.args
			expect(serverName).to.equal("ai-hydro")
			expect(tool).to.equal("audit_interpretation")
			expect(args.prose).to.equal("NSE is 0.71 [run:r1#nse]")
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
			expect(text).to.include("uncited_number")
			expect(text).to.include("Fix: Add [run:<id>#nse]")
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

		it("reports unavailable when the connected server has tools but not audit_interpretation", async () => {
			const out = await runFinalAnswerAudit({
				hub: mockHub([server({ tools: [{ name: "other" } as any] })]),
				ulid: "c",
				workspaceRoot: "/w",
				answer: "x 1",
			})
			expect(out.status).to.equal("unavailable")
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
				taskState: { consecutiveMistakeCount: 0, lastResponseModelId: "m-returned" },
				autoApprovalSettings: { enabled: false },
				focusChainSettings: { enabled: false },
				messageState: { getAiHydroMessages: () => [], updateAiHydroMessage: async () => {} },
				services: {
					mcpHub: opts.hub,
					stateManager: { getGlobalSettingsKey: () => opts.enabled },
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
				"say:text:**Answer audit found 1 i",
				"ask:completion_result",
				"say:user_feedback:thanks",
			])
			// the completion_result text is exactly the model's answer
			expect(say.firstCall.args).to.deep.equal(["completion_result", "NSE was 0.71", undefined, undefined, false])
			expect(callTool.firstCall.args[2].prose).to.equal("NSE was 0.71")
		})

		it("shows 'audit unavailable' and still completes when the MCP hub fails", async () => {
			const callTool = sinon.stub().rejects(new Error("server crashed"))
			const { config, order } = makeConfig({ hub: mockHub([server()], callTool), enabled: true })
			const result: any = await new AttemptCompletionHandler().execute(config, block)
			expect(order[1]).to.match(/^say:text:\*\*Answer audit unavail/)
			expect(order[2]).to.equal("ask:completion_result")
			expect(result[0].text).to.equal("[attempt_completion] Result:")
		})

		it("is default-on when the setting is unset, off only when explicitly false", async () => {
			const on = makeConfig({ hub: mockHub([server()], sinon.stub().resolves(textResponse(PASS))), enabled: undefined })
			await new AttemptCompletionHandler().execute(on.config, block)
			expect(on.order.some((o) => o.startsWith("say:text:**Answer audit passed"))).to.equal(true)

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
