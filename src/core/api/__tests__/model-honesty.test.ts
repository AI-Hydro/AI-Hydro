import { Anthropic } from "@anthropic-ai/sdk"
import { anthropicModels, bedrockModels, vertexModels } from "@shared/api"
import { describe, it } from "mocha"
import "should"
import { AnthropicHandler } from "../providers/anthropic"
import { AwsBedrockHandler } from "../providers/bedrock"
import { DeepSeekHandler } from "../providers/deepseek"
import { UnknownModelError } from "../providers/model-resolution"
import { OpenAiNativeHandler } from "../providers/openai-native"
import { VertexHandler } from "../providers/vertex"
import { GroqHandler } from "../providers/groq"
import { HuggingFaceHandler } from "../providers/huggingface"
import { OpenRouterHandler } from "../providers/openrouter"
import { RequestyHandler } from "../providers/requesty"
import { buildAnthropicStreamRequest, planAnthropicReasoning } from "../transform/anthropic-request"
import { assessApiCost } from "@/utils/cost"

const MSGS: Anthropic.Messages.MessageParam[] = [
	{ role: "user", content: "first" },
	{ role: "assistant", content: "ok" },
	{ role: "user", content: [{ type: "text", text: "second" }] },
]

function body(modelId: string, extra: { budget?: number; effort?: string } = {}): Record<string, any> {
	const info = (anthropicModels as Record<string, any>)[modelId]
	return buildAnthropicStreamRequest({
		modelId,
		info,
		systemPrompt: "sys",
		messages: MSGS,
		thinkingBudgetTokens: extra.budget,
		reasoningEffort: extra.effort,
	}) as unknown as Record<string, any>
}

async function drain(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
	const out: unknown[] = []
	for await (const c of gen) {
		out.push(c)
	}
	return out
}

describe("model layer honesty", () => {
	describe("unknown model ids fail loudly", () => {
		it("Anthropic: error names the id and how to fix it; nothing is sent", async () => {
			let sent = false
			const h = new AnthropicHandler({ apiKey: "k", apiModelId: "claude-does-not-exist-9" })
			;(h as any).client = {
				messages: {
					create: () => {
						sent = true
					},
				},
			}
			let err: any
			try {
				await drain(h.createMessage("s", MSGS))
			} catch (e) {
				err = e
			}
			err.should.be.instanceOf(UnknownModelError)
			err.message.should.containEql("claude-does-not-exist-9")
			err.message.should.containEql("src/shared/api.ts")
			err.message.should.containEql("Settings")
			sent.should.equal(false)
		})

		it("getModel() never reports a different model's id for an unknown id", () => {
			new AnthropicHandler({ apiModelId: "claude-nope" }).getModel().id.should.equal("claude-nope")
			new VertexHandler({ apiModelId: "claude-nope" }).getModel().id.should.equal("claude-nope")
			new AwsBedrockHandler({ apiModelId: "anthropic.nope" }).getModel().id.should.equal("anthropic.nope")
		})

		it("no model selected still resolves to the default (nothing was requested)", () => {
			new AnthropicHandler({}).getModel().id.should.equal("claude-sonnet-4-6")
		})

		for (const [name, make] of [
			["Vertex", () => new VertexHandler({ vertexProjectId: "p", vertexRegion: "r", apiModelId: "claude-nope" })],
			["Bedrock", () => new AwsBedrockHandler({ apiModelId: "anthropic.nope" })],
			["OpenAI native", () => new OpenAiNativeHandler({ openAiNativeApiKey: "k", apiModelId: "gpt-nope" } as any)],
			["DeepSeek", () => new DeepSeekHandler({ deepSeekApiKey: "k", apiModelId: "ds-nope" } as any)],
		] as const) {
			it(`${name}: refuses an unknown model id`, async () => {
				let err: any
				try {
					await drain((make() as any).createMessage("s", MSGS))
				} catch (e) {
					err = e
				}
				err.should.be.instanceOf(UnknownModelError)
			})
		}

		it("Bedrock custom ARN / inference-profile ids are not rejected by the registry check", async () => {
			const h = new AwsBedrockHandler({
				apiModelId: "arn:aws:bedrock:us-east-1:1:inference-profile/custom",
				awsBedrockCustomSelected: true,
				awsBedrockCustomModelBaseId: "anthropic.claude-sonnet-4-6",
			})
			h.getModel().id.should.equal("arn:aws:bedrock:us-east-1:1:inference-profile/custom")
		})
	})

	describe("new Claude models are registered, without invented facts", () => {
		for (const id of ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
			it(`${id}: Claude API entry carries the documented limits, flags and prices`, () => {
				const info = (anthropicModels as Record<string, any>)[id]
				info.contextWindow.should.equal(1_000_000)
				info.maxTokens.should.equal(128_000)
				info.supportsAdaptiveThinking.should.equal(true)
				info.supportsEffort.should.equal(true)
				info.supportsXhighEffort.should.equal(true)
				;(info.supportsThinkingBudget === undefined).should.equal(true)
				info.supportsTemperature.should.equal(false)
				;(info.pricingUnverified === undefined).should.equal(true)
				for (const k of ["inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice"]) {
					info[k].should.be.a.Number()
				}
			})
			it(`${id}: Bedrock entry shares limits/flags but keeps platform pricing unverified`, () => {
				const info = (bedrockModels as Record<string, any>)[`anthropic.${id}`]
				info.pricingUnverified.should.equal(true)
				info.contextWindow.should.equal(1_000_000)
				info.supportsAdaptiveThinking.should.equal(true)
				for (const k of ["inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice"]) {
					;(info[k] === undefined).should.equal(true, k)
				}
			})
		}
		it("Vertex has only opus/sonnet 5.5", () => {
			Object.keys(vertexModels).should.containEql("claude-opus-5-5")
			Object.keys(vertexModels).should.containEql("claude-sonnet-5-5")
			Object.keys(vertexModels).should.not.containEql("claude-fable-5-1")
		})
		it("AnthropicHandler resolves claude-opus-5-5 verbatim (no silent default)", () => {
			new AnthropicHandler({ apiModelId: "claude-opus-5-5" }).getModel().id.should.equal("claude-opus-5-5")
		})
		it("prototype property names are not treated as registry models", async () => {
			let err: any
			try {
				await drain(new AnthropicHandler({ apiKey: "k", apiModelId: "constructor" }).createMessage("s", MSGS))
			} catch (e) {
				err = e
			}
			err.should.be.instanceOf(UnknownModelError)
		})
	})

	describe("cost honesty", () => {
		it("unverified-pricing models report cost unavailable, not $0", () => {
			assessApiCost((bedrockModels as Record<string, any>)["anthropic.claude-opus-5-5"], 10, 10).should.equal("unavailable")
		})
		it("caching models with an undefined cache price report a lower bound", () => {
			assessApiCost({ supportsPromptCache: true, inputPrice: 1, outputPrice: 2 }, 100, 0).should.equal("lower-bound")
			assessApiCost({ supportsPromptCache: true, inputPrice: 1, outputPrice: 2, cacheWritesPrice: 1 }, 100, 5).should.equal(
				"lower-bound",
			)
			assessApiCost({ supportsPromptCache: true, inputPrice: 1, outputPrice: 2 }, 0, 0).should.equal("ok")
			assessApiCost((anthropicModels as Record<string, any>)["claude-sonnet-4-6"], 100, 100).should.equal("ok")
		})
	})

	describe("dynamic-list providers keep the user's model id", () => {
		it("OpenRouter / Requesty / Groq / HuggingFace pass an unlisted id through, flagged", () => {
			const or = new OpenRouterHandler({ openRouterModelId: "vendor/new-model" } as any).getModel()
			or.id.should.equal("vendor/new-model")
			;(or.info as any).pricingUnverified.should.equal(true)
			new RequestyHandler({ requestyModelId: "x/y" } as any).getModel().id.should.equal("x/y")
			new GroqHandler({ groqModelId: "not-listed" } as any).getModel().id.should.equal("not-listed")
			new HuggingFaceHandler({ huggingFaceModelId: "org/not-listed" } as any).getModel().id.should.equal("org/not-listed")
		})
	})

	describe("Bedrock inference config", () => {
		it("omits temperature for models that reject it, even with thinking on", () => {
			const h: any = new AwsBedrockHandler({ apiModelId: "anthropic.claude-opus-5-5", thinkingBudgetTokens: 4096 })
			const cfg = h.getInferenceConfig(h.getModel().info, "anthropic")
			cfg.should.not.have.property("temperature")
		})
		it("still sends temperature 0 for models that accept it, and 1 with budget thinking", () => {
			const plain: any = new AwsBedrockHandler({ apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0" })
			plain.getInferenceConfig(plain.getModel().info, "anthropic").temperature.should.equal(0)
			const thinking: any = new AwsBedrockHandler({
				apiModelId: "anthropic.claude-sonnet-4-20250514-v1:0",
				thinkingBudgetTokens: 2048,
			})
			thinking.getInferenceConfig(thinking.getModel().info, "anthropic").temperature.should.equal(1)
		})
	})

	describe("request construction is driven by ModelInfo flags", () => {
		it("claude-opus-5-5 is sent verbatim and carries cache_control", () => {
			const b = body("claude-opus-5-5")
			b.model.should.equal("claude-opus-5-5")
			JSON.stringify(b).should.containEql("cache_control")
			b.system[0].cache_control.should.eql({ type: "ephemeral" })
			// last user message is a cache breakpoint
			b.messages[2].content[0].cache_control.should.eql({ type: "ephemeral" })
		})

		it("the default model claude-sonnet-4-6 now gets caching (was uncached)", () => {
			JSON.stringify(body("claude-sonnet-4-6")).should.containEql("cache_control")
		})

		it("every registry model flagged supportsPromptCache gets cache_control", () => {
			for (const [id, info] of Object.entries(anthropicModels)) {
				if (id.endsWith(":1m")) {
					continue
				}
				const b = buildAnthropicStreamRequest({ modelId: id, info, systemPrompt: "s", messages: MSGS })
				JSON.stringify(b).includes("cache_control").should.equal(info.supportsPromptCache, id)
			}
		})

		it("5.x: adaptive thinking and effort are sent from the documented flags, never budget_tokens or temperature", () => {
			const b = body("claude-opus-5-5", { budget: 4096, effort: "xhigh" })
			b.should.not.have.property("temperature")
			b.thinking.should.eql({ type: "adaptive", display: "summarized" })
			b.output_config.should.eql({ effort: "xhigh" })
			JSON.stringify(b).should.not.containEql("budget_tokens")
		})

		it("4.7: adaptive thinking, effort in output_config, xhigh clamped (xhigh support is not claimed)", () => {
			const b = body("claude-opus-4-7", { budget: 4096, effort: "xhigh" })
			b.thinking.should.eql({ type: "adaptive", display: "summarized" })
			b.output_config.should.eql({ effort: "high" })
			b.should.not.have.property("temperature")
		})

		it("effort goes in output_config; unknown values and non-effort models are ignored", () => {
			body("claude-opus-4-6", { effort: "xhigh" }).output_config.should.eql({ effort: "high" })
			body("claude-opus-4-7", { effort: "bogus" }).should.not.have.property("output_config")
			body("claude-sonnet-4-5-20250929", { effort: "high" }).should.not.have.property("output_config")
		})

		it("4.6 uses adaptive (not budget_tokens) and drops temperature only when thinking is on", () => {
			const on = body("claude-sonnet-4-6", { budget: 2048 })
			on.thinking.type.should.equal("adaptive")
			on.should.not.have.property("temperature")
			const off = body("claude-sonnet-4-6", { budget: 0 })
			off.should.not.have.property("thinking")
			off.temperature.should.equal(0)
		})

		it("4.7 rejects explicit temperature, so none is sent even without thinking", () => {
			body("claude-opus-4-7", { budget: 0 }).should.not.have.property("temperature")
		})

		it("models that require budget_tokens keep it, and drop temperature while thinking", () => {
			const on = body("claude-sonnet-4-5-20250929", { budget: 2048 })
			on.thinking.should.eql({ type: "enabled", budget_tokens: 2048 })
			on.should.not.have.property("temperature")
			body("claude-sonnet-4-5-20250929", { budget: 0 }).temperature.should.equal(0)
		})

		it("legacy models with no thinking support never get a thinking param", () => {
			const plan = planAnthropicReasoning((anthropicModels as Record<string, any>)["claude-3-5-sonnet-20241022"], 4096)
			plan.thinkingRequested.should.equal(false)
		})
	})

	describe("provider-returned model id", () => {
		it("Anthropic surfaces message_start.message.model as a response_model chunk", async () => {
			const h = new AnthropicHandler({ apiKey: "k", apiModelId: "claude-opus-5-5" })
			let seen: any
			;(h as any).client = {
				messages: {
					create: async (req: any) => {
						seen = req
						return (async function* () {
							yield {
								type: "message_start",
								message: { model: "claude-opus-5-5-20261001", usage: { input_tokens: 1, output_tokens: 0 } },
							}
						})()
					},
				},
			}
			const chunks: any[] = (await drain(h.createMessage("s", MSGS))) as any[]
			seen.model.should.equal("claude-opus-5-5")
			chunks[0].should.eql({ type: "response_model", modelId: "claude-opus-5-5-20261001" })
			chunks[1].type.should.equal("usage")
		})
	})
})
