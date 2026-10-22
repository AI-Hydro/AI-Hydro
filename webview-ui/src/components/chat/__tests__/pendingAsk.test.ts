import { APPROVAL_ASKS } from "@shared/aihydro/askOutcome"
import { badgeForAsk, isInlineApprovalAsk } from "@shared/aihydro/pendingAsk"
import type { AiHydroAsk, AiHydroMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"

/** Every AiHydroAsk, typed as a Record so adding an ask kind without deciding here is a compile error. */
const BADGED: Record<AiHydroAsk, boolean> = {
	tool: true,
	command: true,
	use_mcp_server: true,
	browser_action_launch: true,
	followup: true,
	plan_mode_respond: true,
	api_req_failed: true,
	mistake_limit_reached: true,
	auto_approval_max_req_reached: true,
	install_dependencies: true,
	workspace_env_setup: true,
	new_task: true,
	condense: true,
	report_bug: true,
	completion_result: false,
	resume_task: false,
	resume_completed_task: false,
	command_output: false,
	summarize_task: false,
}

describe("badgeForAsk", () => {
	for (const [ask, badged] of Object.entries(BADGED) as [AiHydroAsk, boolean][]) {
		it(`${ask} ${badged ? "is badged with a tooltip" : "is not badged"}`, () => {
			const tip = badgeForAsk(ask)
			if (badged) {
				expect(typeof tip).toBe("string")
				expect(tip?.length).toBeGreaterThan(0)
			} else {
				expect(tip).toBeUndefined()
			}
		})
	}
})

describe("isInlineApprovalAsk", () => {
	const ask = (a: AiHydroAsk, extra: Partial<AiHydroMessage> = {}): AiHydroMessage => ({ ts: 1, type: "ask", ask: a, ...extra })

	it("is true exactly for the complete approval asks", () => {
		for (const a of Object.keys(BADGED) as AiHydroAsk[]) {
			expect(isInlineApprovalAsk(ask(a))).toBe(APPROVAL_ASKS.includes(a))
		}
	})

	it("is false while streaming, for says and for nothing", () => {
		expect(isInlineApprovalAsk(ask("command", { partial: true }))).toBe(false)
		expect(isInlineApprovalAsk({ ts: 1, type: "say", say: "command" })).toBe(false)
		expect(isInlineApprovalAsk(undefined)).toBe(false)
	})

	it("an ask kind it does not know is not inline, so the footer keeps its fail-safe Run/Deny", () => {
		expect(isInlineApprovalAsk({ ts: 1, type: "ask", ask: "some_future_ask" as AiHydroAsk })).toBe(false)
	})
})
