/**
 * Claude 5.x request construction from the registry (docs: platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5
 * and /build-with-claude/effort). Opus 5.5 and Fable 5.1 reject thinking disabled/enabled+budget with a 400, so the
 * request must carry only adaptive thinking and output_config.effort.
 */
import type { Anthropic } from "@anthropic-ai/sdk"
import { anthropicModels } from "@shared/api"
import "should"
import { getContextWindowInfo } from "@/core/context/context-management/context-window-utils"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { buildAnthropicStreamRequest } from "../anthropic-request"

const MSGS: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "hi" }]
const IDS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const

function req(id: (typeof IDS)[number], budget?: number, effort?: string): Record<string, any> {
	return buildAnthropicStreamRequest({
		modelId: id,
		info: (anthropicModels as Record<string, any>)[id],
		systemPrompt: "sys",
		messages: MSGS,
		thinkingBudgetTokens: budget,
		reasoningEffort: effort,
	}) as unknown as Record<string, any>
}

describe("Claude 5.x request construction", () => {
	for (const id of IDS) {
		describe(id, () => {
			it("sends the model id, a cache breakpoint on the system prompt, max_tokens >= 32000 and no temperature", () => {
				const r = req(id)
				r.model.should.equal(id)
				r.system[0].cache_control.should.eql({ type: "ephemeral" })
				r.max_tokens.should.be.aboveOrEqual(32_000)
				r.should.not.have.property("temperature")
			})
			it("never sends thinking.disabled or budget_tokens, even when the user budget is set", () => {
				for (const budget of [undefined, 0, 4096]) {
					const r = req(id, budget)
					JSON.stringify(r).should.not.containEql("budget_tokens")
					JSON.stringify(r).should.not.containEql('"disabled"')
					if (budget) {
						r.thinking.type.should.equal("adaptive")
					} else {
						r.should.not.have.property("thinking")
					}
				}
			})
			it("honours the user's effort setting, including xhigh and max", () => {
				for (const e of ["low", "medium", "high", "xhigh", "max"]) {
					req(id, 0, e).output_config.should.eql({ effort: e })
				}
				req(id, 0, "bogus").should.not.have.property("output_config")
				req(id).should.not.have.property("output_config")
			})
			it("condense threshold uses the real 1M window", () => {
				const { contextWindow, maxAllowedSize } = getContextWindowInfo({
					getModel: () => ({ id, info: (anthropicModels as Record<string, any>)[id] }),
				} as any)
				contextWindow.should.equal(1_000_000)
				maxAllowedSize.should.be.above(800_000)
				// input + a full 128K response must fit in the window
				;(maxAllowedSize + 128_000).should.be.belowOrEqual(1_000_000)
			})
		})
	}

	it("legacy and current condense triggers share getContextWindowInfo (1M window / 128K output)", () => {
		const info = { ...(anthropicModels as Record<string, any>)["claude-opus-5-5"] }
		getContextWindowInfo({ getModel: () => ({ id: "x", info }) } as any).maxAllowedSize.should.equal(1_000_000 - 128_000 - 20_000)
		// small-output models keep the fixed buffers
		getContextWindowInfo({ getModel: () => ({ id: "x", info: { contextWindow: 200_000, maxTokens: 8192 } }) } as any)
			.maxAllowedSize.should.equal(160_000)
	})

	it("cost uses the documented prices (Opus 5.5: 1M in, 100k out, 500k cache read)", () => {
		const info = (anthropicModels as Record<string, any>)["claude-opus-5-5"]
		// 1*4 + 0.1*20 + 0.5*0.2 = 6.1
		calculateApiCostAnthropic(info, 1_000_000, 100_000, 0, 500_000).should.be.approximately(6.1, 1e-9)
	})

	it("Haiku 5.5 switches to the over-100k-prompt tier, counting cache tokens toward prompt length", () => {
		const info = (anthropicModels as Record<string, any>)["claude-haiku-5-5"]
		// prompt = 50k + 60k cache read = 110k > 100k -> tier 2: 50k*0.5 + 60k*0.05 + 1k*2.5 per MTok
		const over = calculateApiCostAnthropic(info, 50_000, 1_000, 0, 60_000)
		over.should.be.approximately((50_000 * 0.5 + 60_000 * 0.05 + 1_000 * 2.5) / 1e6, 1e-12)
		const under = calculateApiCostAnthropic(info, 50_000, 1_000, 0, 10_000)
		under.should.be.approximately((50_000 * 0.1 + 10_000 * 0.01 + 1_000 * 0.5) / 1e6, 1e-12)
	})
})
