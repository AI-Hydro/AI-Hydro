/**
 * Usage normalisation on recorded provider usage objects. Shapes follow the provider SDK types
 * (openai CompletionUsage, DeepSeek's prompt_cache_hit/miss_tokens extension, Anthropic Usage). No API is called.
 */
import { deepSeekModels } from "@shared/api"
import "should"
import { AnthropicHandler } from "../anthropic"
import { DeepSeekHandler } from "../deepseek"
import { OpenAiNativeHandler } from "../openai-native"
import { normalizeOpenAiStyleUsage } from "../../transform/usage"

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
	const out: any[] = []
	for await (const c of gen) {
		out.push(c)
	}
	return out
}

describe("provider usage -> meter convention", () => {
	describe("DeepSeek (prompt_cache_hit_tokens / prompt_cache_miss_tokens)", () => {
		// Request 5 of the owner's deepseek-v4-pro task: 65,536 hit + 1,543 miss, 199 out, billed $0.0057.
		const usage = {
			prompt_tokens: 67_079,
			completion_tokens: 199,
			total_tokens: 67_278,
			prompt_cache_hit_tokens: 65_536,
			prompt_cache_miss_tokens: 1_543,
		}
		it("reports misses as uncached input (not cache writes) and hits as cache reads", async () => {
			const h: any = new DeepSeekHandler({ apiModelId: "deepseek-v4-pro" } as any)
			const [chunk] = await collect(h.yieldUsage(deepSeekModels["deepseek-v4-pro"], usage))
			chunk.inputTokens.should.equal(1_543)
			chunk.cacheReadTokens.should.equal(65_536)
			chunk.cacheWriteTokens.should.equal(0)
			chunk.outputTokens.should.equal(199)
			const wholePrompt = chunk.inputTokens + chunk.cacheReadTokens + chunk.cacheWriteTokens
			wholePrompt.should.equal(usage.prompt_tokens)
		})
		it("cost is unchanged by the relabel: ~$0.0057 for the recorded request", async () => {
			const h: any = new DeepSeekHandler({ apiModelId: "deepseek-v4-pro" } as any)
			const [chunk] = await collect(h.yieldUsage(deepSeekModels["deepseek-v4-pro"], usage))
			chunk.totalCost.should.be.approximately(0.0057, 0.00005)
		})
		it("handles a missing usage object", async () => {
			const h: any = new DeepSeekHandler({ apiModelId: "deepseek-v4-pro" } as any)
			const [chunk] = await collect(h.yieldUsage(deepSeekModels["deepseek-v4-pro"], undefined))
			chunk.inputTokens.should.equal(0)
			chunk.cacheReadTokens.should.equal(0)
		})
	})

	describe("OpenAI native (prompt_tokens_details.cached_tokens)", () => {
		it("input = uncached part of prompt_tokens; cached part = cache reads; no writes", async () => {
			const h: any = new OpenAiNativeHandler({ apiModelId: "gpt-4o" } as any)
			const [chunk] = await collect(
				h.yieldUsage(
					{ inputPrice: 2.5, outputPrice: 10, cacheReadsPrice: 1.25, supportsPromptCache: true },
					{
						prompt_tokens: 2_006,
						completion_tokens: 300,
						total_tokens: 2_306,
						prompt_tokens_details: { cached_tokens: 1_920 },
					},
				),
			)
			chunk.inputTokens.should.equal(86)
			chunk.cacheReadTokens.should.equal(1_920)
			chunk.cacheWriteTokens.should.equal(0)
		})
	})

	describe("normalizeOpenAiStyleUsage (generic OpenAI-compatible)", () => {
		it("no cache fields: everything is uncached input", () => {
			const u = normalizeOpenAiStyleUsage({ prompt_tokens: 500, completion_tokens: 20 })
			u.uncachedInputTokens.should.equal(500)
			u.cacheReadTokens.should.equal(0)
		})
		it("DeepSeek-style hit/miss without prompt_tokens falls back to their sum", () => {
			const u = normalizeOpenAiStyleUsage({ prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 5 })
			u.promptTokens.should.equal(15)
			u.uncachedInputTokens.should.equal(5)
		})
		it("cached_tokens larger than prompt_tokens never yields negative input", () => {
			normalizeOpenAiStyleUsage({
				prompt_tokens: 10,
				prompt_tokens_details: { cached_tokens: 12 },
			}).uncachedInputTokens.should.equal(0)
		})
	})

	describe("Anthropic message_start usage", () => {
		it("is already in the meter convention: input_tokens excludes cache reads and writes", async () => {
			// SDK type: Anthropic.Usage { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
			const usage = {
				input_tokens: 12,
				output_tokens: 1,
				cache_creation_input_tokens: 8_000,
				cache_read_input_tokens: 40_000,
			}
			const h: any = new AnthropicHandler({ apiKey: "k", apiModelId: "claude-opus-5-5" })
			h.client = {
				messages: {
					create: async () =>
						(async function* () {
							yield { type: "message_start", message: { model: "claude-opus-5-5", usage } }
						})(),
				},
			}
			const chunks = await collect(h.createMessage("s", [{ role: "user", content: "hi" }]))
			const u = chunks.find((c) => c.type === "usage")
			u.inputTokens.should.equal(12)
			u.cacheWriteTokens.should.equal(8_000)
			u.cacheReadTokens.should.equal(40_000)
		})
	})
})
