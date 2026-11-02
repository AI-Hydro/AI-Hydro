import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { capFor } from "../agentDefinition"
import { isTransientStreamError, MAX_STREAM_RETRIES, SubagentRunner } from "../SubagentRunner"
import { CostTally, emptyRequestUsage, isModelPriced, priceRequest } from "../subagentCost"
import { agentCountRefusal, resolveMaxAgentsPerTask, TaskAgentLedger } from "../taskLedger"
import { makeParent, PARENT_CAPS, type ParentHarness, PROFILE, scriptedApi, tool } from "./subagentHarness"

/** An Anthropic-style price table (per million tokens), as the model catalogue carries it. */
const ANTHROPIC_INFO = {
	inputPrice: 3,
	outputPrice: 15,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	supportsPromptCache: true,
	contextWindow: 10_000_000,
}

const READ = tool("read_file", { path: "README.md" })
const REPORT = tool("report_findings", { summary: "done" })

function runnerFor(h: ParentHarness, api: any, extra: Record<string, unknown> = {}) {
	return new SubagentRunner({
		...h.runnerBase,
		childId: "sa_cost1",
		ordinal: 1,
		label: "Explorer 1",
		profile: "explorer",
		caps: capFor(PARENT_CAPS, PROFILE)!,
		prompt: "What is in the README?",
		api,
		retryBaseMs: 0,
		...extra,
	} as any)
}

describe("subagent cost", () => {
	let h: ParentHarness
	beforeEach(() => {
		h = makeParent()
	})
	afterEach(() => h.cleanup())

	describe("child cost matches the parent's computation", () => {
		it("on the Anthropic fixture a child reports calculateApiCostAnthropic over its tokens, and stops at its cap", async () => {
			const usage = { inputTokens: 500_000, outputTokens: 1_000, cacheWriteTokens: 50_000, cacheReadTokens: 100_000 }
			const perRequest = calculateApiCostAnthropic(ANTHROPIC_INFO as any, 500_000, 1_000, 50_000, 100_000)
			// one request is under the $2 cap; two are over it
			expect(perRequest).to.be.lessThan(PROFILE.budget.maxCostUsd)
			expect(perRequest * 2).to.be.greaterThan(PROFILE.budget.maxCostUsd)

			const api = scriptedApi([{ text: READ, usage }], { modelInfo: ANTHROPIC_INFO, contextWindow: 10_000_000 })
			const result = await runnerFor(h, api).run()

			expect(result.status).to.equal("partial")
			expect(result.budgetStop).to.equal("cost")
			expect(api.requests).to.equal(2)
			expect(result.usage.cost).to.be.closeTo(perRequest * 2, 1e-9)
			expect(result.usage.costStatus).to.equal(undefined) // exact
			expect(h.records[0].usage.cost).to.be.closeTo(perRequest * 2, 1e-9)
		})

		it("uses the provider's own figure when a usage chunk carries one, as the parent does", async () => {
			const api = scriptedApi([{ text: REPORT, usage: { inputTokens: 10, outputTokens: 5, totalCost: 0.0123 } }], {
				modelInfo: ANTHROPIC_INFO,
			})
			const result = await runnerFor(h, api).run()
			expect(result.status).to.equal("completed")
			expect(result.usage.cost).to.equal(0.0123)
		})

		it("a model with no price table has an unknown cost: no number, status unavailable, no cost cap", async () => {
			// 3 requests of 1M input tokens each would be $9 on a priced model; here the cap cannot fire, and says so.
			const api = scriptedApi(
				[
					{ text: READ, usage: { inputTokens: 1_000_000, outputTokens: 10 } },
					{ text: READ, usage: { inputTokens: 1_000_000, outputTokens: 10 } },
					{ text: REPORT, usage: { inputTokens: 1_000_000, outputTokens: 10 } },
				],
				{ contextWindow: 100_000_000 },
			)
			const result = await runnerFor(h, api).run()
			expect(result.status).to.equal("completed")
			expect(result.usage.cost).to.equal(undefined)
			expect(result.usage.costStatus).to.equal("unavailable")
		})

		it("a model whose price is unverified has an unknown cost even when the provider reports one", async () => {
			const api = scriptedApi([{ text: REPORT, usage: { inputTokens: 10, outputTokens: 5, totalCost: 9 } }], {
				modelInfo: { ...ANTHROPIC_INFO, pricingUnverified: true },
			})
			const result = await runnerFor(h, api).run()
			expect(result.status).to.equal("completed")
			expect(result.usage.cost).to.equal(undefined)
			expect(result.usage.costStatus).to.equal("unavailable")
		})

		it("a missing cache price makes the cost a lower bound, never exact", async () => {
			const info = { ...ANTHROPIC_INFO, cacheReadsPrice: undefined }
			const api = scriptedApi([{ text: REPORT, usage: { inputTokens: 1_000, outputTokens: 10, cacheReadTokens: 5_000 } }], {
				modelInfo: info,
			})
			const result = await runnerFor(h, api).run()
			expect(result.usage.cost).to.be.greaterThan(0)
			expect(result.usage.costStatus).to.equal("lower-bound")
		})
	})

	describe("priceRequest and CostTally", () => {
		const usage = (over: Partial<ReturnType<typeof emptyRequestUsage>> = {}) => ({
			...emptyRequestUsage(),
			received: true,
			inputTokens: 1_000,
			outputTokens: 100,
			...over,
		})

		it("prices from tokens the way calculateApiCostAnthropic does", () => {
			const priced = priceRequest(ANTHROPIC_INFO as any, usage({ cacheWriteTokens: 10, cacheReadTokens: 20 }))
			expect(priced.cost).to.equal(calculateApiCostAnthropic(ANTHROPIC_INFO as any, 1_000, 100, 10, 20))
			expect(priced.status).to.equal(undefined)
		})

		it("a stream with no usage chunk is unknown, not zero", () => {
			expect(priceRequest(ANTHROPIC_INFO as any, emptyRequestUsage())).to.deep.equal({ status: "unavailable" })
		})

		it("isModelPriced is false for unverified or unpriced models", () => {
			expect(isModelPriced(ANTHROPIC_INFO as any)).to.equal(true)
			expect(isModelPriced({ contextWindow: 1 } as any)).to.equal(false)
			expect(isModelPriced({ ...ANTHROPIC_INFO, pricingUnverified: true } as any)).to.equal(false)
		})

		it("a tally with an unknown request among priced ones is a lower bound; with none priced it is unknown", () => {
			const lower = new CostTally()
			lower.add({ cost: 0.5 })
			lower.add({ status: "unavailable" })
			expect(lower.cost).to.equal(0.5)
			expect(lower.status).to.equal("lower-bound")

			const unknown = new CostTally()
			unknown.add({ status: "unavailable" })
			expect(unknown.cost).to.equal(undefined)
			expect(unknown.status).to.equal("unavailable")

			const exact = new CostTally()
			exact.add({ cost: 0.25 })
			exact.add({ cost: 0.25 })
			expect(exact.cost).to.equal(0.5)
			expect(exact.status).to.equal(undefined)
		})
	})

	describe("task-level ledger", () => {
		it("a shared ledger stops a child that crosses the task cap, and later children before they ask the model", async () => {
			const ledger = new TaskAgentLedger(0.5)
			const costly = { text: READ, usage: { inputTokens: 100_000, outputTokens: 100 } } // $0.3015 per request
			const first = runnerFor(h, scriptedApi([costly], { modelInfo: ANTHROPIC_INFO }), { ledger, childId: "sa_a" })
			const result = await first.run()
			expect(result.status).to.equal("partial")
			expect(result.budgetStop).to.equal("task_cost")
			expect(ledger.spentUsd).to.be.closeTo(result.usage.cost!, 1e-12)
			expect(ledger.exceeded()).to.equal(true)

			const api = scriptedApi([costly], { modelInfo: ANTHROPIC_INFO })
			const second = await runnerFor(h, api, { ledger, childId: "sa_b" }).run()
			expect(second.budgetStop).to.equal("task_cost")
			expect(api.requests).to.equal(0)
		})

		it("a child with an unknown cost adds nothing and is counted as unpriced", async () => {
			const ledger = new TaskAgentLedger(1)
			await runnerFor(h, scriptedApi([{ text: REPORT }]), { ledger }).run()
			expect(ledger.spentUsd).to.equal(0)
			expect(ledger.unpricedChildren).to.equal(1)
			expect(ledger.exceeded()).to.equal(false)
		})

		it("is rebuilt from the status rows earlier spawns left (a resumed task keeps its total)", () => {
			const row = (children: object[]) => ({
				type: "say",
				say: "subagent_status",
				text: JSON.stringify({ profile: "explorer", done: true, children }),
			})
			const ledger = TaskAgentLedger.fromMessages(
				[
					{ type: "say", say: "text", text: "unrelated" },
					row([
						{ cost: 0.5, tokensIn: 1, tokensOut: 1 },
						{ cost: 0.25, tokensIn: 1, tokensOut: 1 },
					]),
					row([{ tokensIn: 5, tokensOut: 5, costStatus: "unavailable" }]),
				],
				5,
			)
			expect(ledger.spentUsd).to.equal(0.75)
			expect(ledger.unpricedChildren).to.equal(1)
			expect(ledger.remainingUsd).to.equal(4.25)
			expect(ledger.exceeded()).to.equal(false)
			expect(new TaskAgentLedger(0).exceeded()).to.equal(true)
			// and the same rows give the child and launch counts, which need no price
			expect(ledger.agentsStarted).to.equal(3)
			expect(ledger.launchesApproved).to.equal(2)
		})

		it("counts started children against maxAgentsPerTask, with no price needed", () => {
			const row = (n: number) => ({
				type: "say",
				say: "subagent_status",
				text: JSON.stringify({
					profile: "explorer",
					done: true,
					children: Array.from({ length: n }, () => ({ tokensIn: 0, tokensOut: 0 })),
				}),
			})
			const ledger = TaskAgentLedger.fromMessages([row(4), row(4)], 5, 10)
			expect(ledger.maxAgents).to.equal(10)
			expect(ledger.agentsRemaining).to.equal(2)
			expect(ledger.allowsAgents(2)).to.equal(true)
			expect(ledger.allowsAgents(3)).to.equal(false)
			expect(agentCountRefusal(ledger, 3)).to.include("only 2 more")
			const full = TaskAgentLedger.fromMessages([row(4), row(4), row(4)], 5, 10)
			expect(full.agentsRemaining).to.equal(0)
			expect(agentCountRefusal(full, 1)).to.include("already started 12 subagents")
			expect(TaskAgentLedger.fromMessages([], 5).maxAgents).to.equal(12)
		})

		it("maxAgentsPerTask takes a whole number of 0 or more, else the default", () => {
			expect(resolveMaxAgentsPerTask(4)).to.equal(4)
			expect(resolveMaxAgentsPerTask(0)).to.equal(0)
			for (const bad of [undefined, null, -1, 2.5, Number.NaN, "3", Number.POSITIVE_INFINITY]) {
				expect(resolveMaxAgentsPerTask(bad), String(bad)).to.equal(12)
			}
		})
	})

	describe("bounded retry on a transient stream error", () => {
		const failing = (status: number | undefined, message: string) => {
			const error: any = new Error(message)
			if (status !== undefined) {
				error.status = status
			}
			return error
		}
		/** A model whose first `failures` requests throw, then plays the script. */
		function flakyApi(failures: number, error: Error, script = [{ text: REPORT }] as any[]) {
			const inner = scriptedApi(script)
			let calls = 0
			const api: any = {
				getModel: inner.getModel,
				get requests() {
					return calls
				},
				createMessage(system: string, history: any[]) {
					calls++
					if (calls <= failures) {
						return (async function* () {
							throw error
						})()
					}
					return inner.createMessage(system, history)
				},
			}
			return api
		}

		it("retries a 529, a 429 and a 503 and finishes", async () => {
			for (const status of [529, 429, 503]) {
				const api = flakyApi(MAX_STREAM_RETRIES, failing(status, "Overloaded"))
				const result = await runnerFor(h, api).run()
				expect(result.status, String(status)).to.equal("completed")
				expect(api.requests, String(status)).to.equal(MAX_STREAM_RETRIES + 1)
			}
		})

		it("gives up after the bound and fails with the provider's message", async () => {
			const api = flakyApi(99, failing(503, "service unavailable"))
			const result = await runnerFor(h, api).run()
			expect(result.status).to.equal("failed")
			expect(result.error).to.include("service unavailable")
			expect(api.requests).to.equal(MAX_STREAM_RETRIES + 1)
		})

		it("does not retry an error that will not change (bad key, bad request)", async () => {
			for (const status of [400, 401, 403, 404]) {
				const api = flakyApi(99, failing(status, "nope"))
				const result = await runnerFor(h, api).run()
				expect(result.status, String(status)).to.equal("failed")
				expect(api.requests, String(status)).to.equal(1)
			}
		})

		it("a retry is one turn", async () => {
			const api = flakyApi(1, failing(undefined, "socket hang up"))
			const result = await runnerFor(h, api).run()
			expect(result.status).to.equal("completed")
			expect(result.usage.turns).to.equal(1)
		})

		it("classifies by status first, then by message", () => {
			expect(isTransientStreamError(failing(500, "x"))).to.equal(true)
			expect(isTransientStreamError(failing(401, "rate limit"))).to.equal(false)
			expect(isTransientStreamError(new Error("read ECONNRESET"))).to.equal(true)
			expect(isTransientStreamError(new Error("429 Too Many Requests"))).to.equal(true)
			expect(isTransientStreamError(new Error("provider exploded"))).to.equal(false)
			expect(isTransientStreamError("weird")).to.equal(false)
		})

		it("a cancel during the wait ends the child as cancelled, not failed", async () => {
			const api = flakyApi(99, failing(503, "unavailable"))
			const runner = runnerFor(h, api, { retryBaseMs: 60_000 })
			const done = runner.run()
			await new Promise((resolve) => setTimeout(resolve, 50))
			runner.cancel()
			const result = await done
			expect(result.status).to.equal("cancelled")
			expect(api.requests).to.equal(1)
		})
	})
})
