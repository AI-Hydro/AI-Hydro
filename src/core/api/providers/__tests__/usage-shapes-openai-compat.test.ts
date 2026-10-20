/**
 * Usage shapes for the OpenAI-compatible providers that report DeepSeek-style hit/miss or Anthropic-style
 * creation/read usage. Each provider is driven through createMessage with a fake client streaming a recorded-shape
 * usage chunk; the emitted usage must satisfy in + reads + writes = whole prompt (no double counting).
 */
import { internationalQwenModels, mainlandQwenModels } from "@shared/api"
import "should"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { DoubaoHandler } from "../doubao"
import { FireworksHandler } from "../fireworks"
import { LiteLlmHandler } from "../litellm"
import { OcaHandler } from "../oca"
import { QwenHandler } from "../qwen"
import { XAIHandler } from "../xai"

function fakeClient(usage: Record<string, unknown>) {
	return {
		baseURL: "http://localhost",
		chat: {
			completions: {
				create: async () =>
					(async function* () {
						yield { choices: [{ delta: { content: "hi" } }] }
						yield { choices: [{ delta: {} }], usage }
					})(),
			},
		},
	}
}

async function usageOf(handler: any, usage: Record<string, unknown>): Promise<any> {
	handler.client = fakeClient(usage)
	handler.calculateCost = async () => 0
	handler.fetchModelsInfo = async () => {}
	for await (const chunk of handler.createMessage("sys", [{ role: "user", content: "q" }])) {
		if (chunk.type === "usage") {
			return chunk
		}
	}
	throw new Error("no usage chunk")
}

const whole = (u: any) => u.inputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0)

// DeepSeek-style: 1,000-token prompt = 900 hits + 100 misses.
const HIT_MISS = { prompt_tokens: 1_000, completion_tokens: 50, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 }

describe("OpenAI-compatible providers report the meter convention", () => {
	const hitMissCases: [string, () => any][] = [
		[
			"fireworks",
			() =>
				new FireworksHandler({
					fireworksApiKey: "k",
					fireworksModelId: "accounts/fireworks/models/kimi-k2-instruct-0905",
				} as any),
		],
		["doubao", () => new DoubaoHandler({ doubaoApiKey: "k", apiModelId: "doubao-1-5-pro-256k-250115" } as any)],
		["qwen", () => new QwenHandler({ qwenApiKey: "k", apiModelId: "deepseek-v3", qwenApiLine: "international" } as any)],
		["litellm", () => new LiteLlmHandler({ liteLlmApiKey: "k", liteLlmModelId: "deepseek-chat" } as any)],
		["oca", () => new OcaHandler({ ocaModelId: "deepseek-chat" } as any)],
	]
	for (const [name, make] of hitMissCases) {
		it(`${name}: DeepSeek-style hit/miss -> misses are uncached input, hits are reads, no writes`, async () => {
			const u = await usageOf(make(), HIT_MISS)
			u.inputTokens.should.equal(100)
			u.cacheReadTokens.should.equal(900)
			;(u.cacheWriteTokens ?? 0).should.equal(0)
			u.outputTokens.should.equal(50)
			whole(u).should.equal(1_000)
		})
	}

	it("xai: OpenAI-style prompt_tokens_details.cached_tokens", async () => {
		const h: any = new XAIHandler({ xaiApiKey: "k", apiModelId: "grok-4-fast-reasoning" } as any)
		const u = await usageOf(h, {
			prompt_tokens: 2_006,
			completion_tokens: 300,
			prompt_tokens_details: { cached_tokens: 1_920 },
		})
		u.inputTokens.should.equal(86)
		u.cacheReadTokens.should.equal(1_920)
		;(u.cacheWriteTokens ?? 0).should.equal(0)
		whole(u).should.equal(2_006)
	})

	for (const [name, make] of [
		["litellm", () => new LiteLlmHandler({ liteLlmApiKey: "k", liteLlmModelId: "claude-opus-5-5" } as any)],
		["oca", () => new OcaHandler({ ocaModelId: "claude-opus-5-5" } as any)],
	] as [string, () => any][]) {
		it(`${name}: Anthropic-style via proxy (prompt_tokens = whole prompt) keeps real writes`, async () => {
			const u = await usageOf(make(), {
				prompt_tokens: 48_012,
				completion_tokens: 500,
				cache_creation_input_tokens: 8_000,
				cache_read_input_tokens: 40_000,
			})
			u.inputTokens.should.equal(12)
			u.cacheWriteTokens.should.equal(8_000)
			u.cacheReadTokens.should.equal(40_000)
			whole(u).should.equal(48_012)
		})
		it(`${name}: Anthropic raw usage forwarded (prompt_tokens excludes cache) is not double counted`, async () => {
			const u = await usageOf(make(), {
				prompt_tokens: 12,
				completion_tokens: 500,
				cache_creation_input_tokens: 8_000,
				cache_read_input_tokens: 40_000,
			})
			u.inputTokens.should.equal(12)
			whole(u).should.equal(48_012)
		})
	}

	it("qwen deepseek registry prices a miss as input, so the normalized usage costs correctly", () => {
		for (const reg of [internationalQwenModels, mainlandQwenModels]) {
			const info = reg["deepseek-v3"]
			// 100 miss + 900 hit + 50 out: 100*0.14 + 900*0.014 + 50*0.28 per million
			calculateApiCostAnthropic(info, 100, 50, 0, 900).should.be.approximately(
				(100 * 0.14 + 900 * 0.014 + 50 * 0.28) / 1e6,
				1e-12,
			)
		}
	})
})
