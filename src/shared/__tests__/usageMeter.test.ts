/**
 * Token/cost meter semantics. Fixture: the five api_req_started records of the owner's real DeepSeek task
 * (docs/vision-2040/findings/audit-agent-harness-2026-10-19.md §5A.1), expressed in the meter convention
 * (tokensIn = uncached input, cacheReads = hits, cacheWrites = 0 because DeepSeek has no write charge).
 */
import { expect } from "chai"
import "should"
import type { AiHydroMessage } from "../ExtensionMessage"
import {
	formatCompactTokens,
	formatUsageHeadline,
	getApiMetrics,
	getLastApiReqTotalTokens,
	summarizeTaskUsage,
} from "../getApiMetrics"

function req(tokensIn: number, cacheReads: number, tokensOut: number, cost: number, cacheWrites = 0): AiHydroMessage {
	return {
		ts: 1,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({ request: "x", tokensIn, tokensOut, cacheWrites, cacheReads, cost }),
	} as AiHydroMessage
}

const OWNER_TASK: AiHydroMessage[] = [
	req(62_241, 0, 336, 0.0835),
	req(1_115, 62_208, 1_575, 0.0104),
	req(1_354, 63_232, 264, 0.0056),
	req(1_094, 64_512, 316, 0.0055),
	req(1_543, 65_536, 199, 0.0057),
]

describe("task usage meter", () => {
	it("context-now is the last request's whole context, not cumulative and not just in+out", () => {
		getLastApiReqTotalTokens(OWNER_TASK).should.equal(67_278)
	})

	it("the two meters agree: the host helper includes cache tokens (it used to return ~199 here)", () => {
		getLastApiReqTotalTokens(OWNER_TASK).should.not.equal(199)
		getLastApiReqTotalTokens(OWNER_TASK).should.equal(1_543 + 65_536 + 199)
	})

	it("skips in-flight requests with no usage and malformed records", () => {
		const inflight = { ts: 2, type: "say", say: "api_req_started", text: JSON.stringify({ request: "x" }) } as AiHydroMessage
		const bad = { ts: 3, type: "say", say: "api_req_started", text: "{" } as AiHydroMessage
		getLastApiReqTotalTokens([...OWNER_TASK, inflight, bad]).should.equal(67_278)
		getLastApiReqTotalTokens([]).should.equal(0)
	})

	it("cumulative summary splits uncached input from cache hits and reports % cached", () => {
		const u = summarizeTaskUsage(OWNER_TASK)
		u.uncachedInputTokens.should.equal(67_347)
		u.cacheReadTokens.should.equal(255_488)
		u.cacheWriteTokens.should.equal(0)
		u.outputTokens.should.equal(2_690)
		u.totalInputTokens.should.equal(322_835)
		u.totalTokens.should.equal(325_525)
		u.cachedPercent!.should.equal(79)
		u.totalCost.should.be.approximately(0.1107, 1e-9)
	})

	it("headline reads like: Context now: 67k of 1.0M · This task: 325k tokens (79% cached) · $0.11", () => {
		const u = summarizeTaskUsage(OWNER_TASK)
		formatUsageHeadline({
			contextNow: u.contextNow,
			contextWindow: 1_000_000,
			totalTokens: u.totalTokens,
			cachedPercent: u.cachedPercent,
			totalCost: u.totalCost,
		}).should.equal("Context now: 67k of 1.0M · This task: 325k tokens (79% cached) · $0.11")
	})

	it("headline omits the cached share and cost when there is none", () => {
		formatUsageHeadline({ contextNow: 900, contextWindow: 200_000, totalTokens: 900, cachedPercent: 0 }).should.equal(
			"Context now: 900 of 200k · This task: 900 tokens",
		)
		formatCompactTokens(1_000_000).should.equal("1.0M")
	})

	it("Anthropic-style records (writes + reads + uncached) sum without double counting", () => {
		const m = [req(12, 40_000, 500, 0.05, 8_000)]
		const u = summarizeTaskUsage(m)
		u.totalInputTokens.should.equal(48_012)
		u.cachedPercent!.should.equal(83)
		u.contextNow.should.equal(48_512)
	})
})

describe("task totals include subagent children (AC8)", () => {
	const child = (tokensIn: number, tokensOut: number, cost?: number) => ({
		childId: "sa_1",
		label: "Explorer 1",
		profile: "explorer",
		promptHead: "x",
		status: "completed",
		toolCalls: 2,
		tokensIn,
		tokensOut,
		cacheWrites: 5,
		cacheReads: 7,
		...(cost !== undefined ? { cost } : {}),
		calls: [],
	})
	const status = (children: unknown[]): AiHydroMessage => ({
		ts: 3,
		type: "say",
		say: "subagent_status",
		text: JSON.stringify({ profile: "explorer", done: true, children }),
	})
	const apiReq: AiHydroMessage = {
		ts: 2,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify({ tokensIn: 100, tokensOut: 10, cost: 0.5 }),
	}

	it("adds each child's tokens, cache use and reported cost to the parent's", () => {
		const m = getApiMetrics([apiReq, status([child(10, 2, 0.25), child(20, 4)])])
		expect(m.totalTokensIn).to.equal(130)
		expect(m.totalTokensOut).to.equal(16)
		expect(m.totalCacheWrites).to.equal(10)
		expect(m.totalCacheReads).to.equal(14)
		expect(m.totalCost).to.be.closeTo(0.75, 1e-9)
	})

	it("leaves the context-now figure alone: children's requests are not the parent's context", () => {
		expect(getLastApiReqTotalTokens([apiReq, status([child(90_000, 2)])])).to.equal(110)
	})

	it("a malformed status row adds nothing and does not throw", () => {
		const bad: AiHydroMessage = { ts: 4, type: "say", say: "subagent_status", text: "{not json" }
		expect(getApiMetrics([apiReq, bad]).totalTokensIn).to.equal(100)
	})
})
