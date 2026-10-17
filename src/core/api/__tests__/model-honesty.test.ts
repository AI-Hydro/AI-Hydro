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
import { buildAnthropicStreamRequest, planAnthropicReasoning } from "../transform/anthropic-request"

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

	describe("new Claude models are registered", () => {
		for (const id of ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]) {
			it(`${id} in Anthropic and Bedrock registries with adaptive thinking`, () => {
				;(anthropicModels as Record<string, any>)[id].supportsAdaptiveThinking.should.equal(true)
				;(bedrockModels as Record<string, any>)[`anthropic.${id}`].supportsAdaptiveThinking.should.equal(true)
			})
		}
		it("Vertex has only the IDs documented for Vertex (opus/sonnet 5.5)", () => {
			Object.keys(vertexModels).should.containEql("claude-opus-5-5")
			Object.keys(vertexModels).should.containEql("claude-sonnet-5-5")
			Object.keys(vertexModels).should.not.containEql("claude-fable-5-1")
		})
		it("AnthropicHandler resolves claude-opus-5-5 verbatim (no silent default)", () => {
			new AnthropicHandler({ apiModelId: "claude-opus-5-5" }).getModel().id.should.equal("claude-opus-5-5")
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

		it("5.x: adaptive thinking, never budget_tokens, never temperature", () => {
			const b = body("claude-opus-5-5", { budget: 4096 })
			b.thinking.should.eql({ type: "adaptive", display: "summarized" })
			JSON.stringify(b).should.not.containEql("budget_tokens")
			b.should.not.have.property("temperature")
		})

		it("5.x with thinking toggled off omits the thinking param (cannot be disabled)", () => {
			const b = body("claude-sonnet-5-5", { budget: 0 })
			b.should.not.have.property("thinking")
			b.should.not.have.property("temperature")
		})

		it("effort goes in output_config; xhigh is clamped on models without it", () => {
			body("claude-opus-5-5", { effort: "xhigh" }).output_config.should.eql({ effort: "xhigh" })
			body("claude-opus-4-6", { effort: "xhigh" }).output_config.should.eql({ effort: "high" })
			body("claude-opus-5-5", { effort: "bogus" }).should.not.have.property("output_config")
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
