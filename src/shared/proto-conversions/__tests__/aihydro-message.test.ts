import type { AiHydroAsk, AiHydroMessage, AiHydroSay } from "@shared/ExtensionMessage"
import { ClineAsk, ClineSay } from "@shared/proto/cline/ui"
import { expect } from "chai"
import { describe, it } from "mocha"
import { convertAiHydroMessageToProto, convertProtoToAiHydroMessage } from "../aihydro-message"

// Record<..., true> makes these lists exhaustive at compile time: adding a kind to the union without listing it
// here fails check-types, so a new kind can never silently miss the round-trip test.
const SAY_KINDS: Record<AiHydroSay, true> = {
	task: true,
	error: true,
	error_retry: true,
	api_req_started: true,
	api_req_finished: true,
	text: true,
	reasoning: true,
	completion_result: true,
	user_feedback: true,
	user_feedback_diff: true,
	api_req_retried: true,
	command: true,
	command_output: true,
	tool: true,
	shell_integration_warning: true,
	shell_integration_warning_with_suggestion: true,
	browser_action_launch: true,
	browser_action: true,
	browser_action_result: true,
	mcp_server_request_started: true,
	mcp_server_response: true,
	mcp_notification: true,
	use_mcp_server: true,
	diff_error: true,
	deleted_api_reqs: true,
	aihydroignore_error: true,
	checkpoint_created: true,
	load_mcp_documentation: true,
	html_preview: true,
	info: true,
	task_progress: true,
	answer_audit: true,
}
const ASK_KINDS: Record<AiHydroAsk, true> = {
	followup: true,
	plan_mode_respond: true,
	command: true,
	command_output: true,
	completion_result: true,
	tool: true,
	api_req_failed: true,
	resume_task: true,
	resume_completed_task: true,
	mistake_limit_reached: true,
	auto_approval_max_req_reached: true,
	browser_action_launch: true,
	use_mcp_server: true,
	new_task: true,
	condense: true,
	summarize_task: true,
	report_bug: true,
	install_dependencies: true,
	workspace_env_setup: true,
}

const roundTrip = (m: AiHydroMessage) => convertProtoToAiHydroMessage(convertAiHydroMessageToProto(m))

describe("aihydro-message proto round trip (W2-0 M2)", () => {
	for (const say of Object.keys(SAY_KINDS) as AiHydroSay[]) {
		it(`say:${say} keeps its kind and outcome fields`, () => {
			const m: AiHydroMessage = {
				ts: 1700000000000,
				type: "say",
				say,
				text: "body",
				execOutcome: "failed",
				commandCompleted: true,
			}
			expect(roundTrip(m)).to.deep.equal(m)
		})
	}

	for (const ask of Object.keys(ASK_KINDS) as AiHydroAsk[]) {
		for (const askOutcome of ["approved", "denied"] as const) {
			it(`ask:${ask} keeps its kind and askOutcome=${askOutcome}`, () => {
				const m: AiHydroMessage = {
					ts: 1700000000001,
					type: "ask",
					ask,
					text: "body",
					askOutcome,
					execOutcome: "completed",
				}
				expect(roundTrip(m)).to.deep.equal(m)
			})
		}
	}

	it("every proto enum value maps back to a kind (no silent drop of an AI-Hydro-only value)", () => {
		for (const [name, value] of Object.entries(ClineSay)) {
			if (typeof value !== "number" || value < 0) {
				continue
			}
			const m = convertProtoToAiHydroMessage({
				...convertAiHydroMessageToProto({ ts: 1, type: "say", say: "text" }),
				say: value,
			})
			expect(m.say, `ClineSay.${name}`).to.be.a("string")
		}
		for (const [name, value] of Object.entries(ClineAsk)) {
			if (typeof value !== "number" || value < 0) {
				continue
			}
			const m = convertProtoToAiHydroMessage({
				...convertAiHydroMessageToProto({ ts: 1, type: "ask", ask: "followup" }),
				ask: value,
			})
			expect(m.ask, `ClineAsk.${name}`).to.be.a("string")
		}
	})

	it("AI-Hydro-only kinds use enum numbers of 1000 or more", () => {
		for (const v of [
			ClineSay.HTML_PREVIEW,
			ClineSay.ANSWER_AUDIT,
			ClineSay.SHELL_INTEGRATION_WARNING_WITH_SUGGESTION,
			ClineAsk.INSTALL_DEPENDENCIES,
			ClineAsk.WORKSPACE_ENV_SETUP,
		]) {
			expect(v).to.be.at.least(1000)
		}
		expect(ClineSay.ANSWER_AUDIT).to.equal(1001)
	})

	it("an old message without outcome fields round-trips without gaining any", () => {
		const m: AiHydroMessage = { ts: 5, type: "ask", ask: "command", text: "ls" }
		const back = roundTrip(m)
		expect(back).to.deep.equal(m)
		expect(back).to.not.have.property("askOutcome")
		expect(back).to.not.have.property("execOutcome")
		expect(back).to.not.have.property("commandCompleted")
	})

	it("ignores an unrecognised outcome string rather than inventing evidence", () => {
		const proto = {
			...convertAiHydroMessageToProto({ ts: 6, type: "ask", ask: "tool" }),
			askOutcome: "maybe",
			execOutcome: "??",
		}
		const back = convertProtoToAiHydroMessage(proto)
		expect(back).to.not.have.property("askOutcome")
		expect(back).to.not.have.property("execOutcome")
	})
})
