import { Anthropic } from "@anthropic-ai/sdk"
import { DeepSeekModelId, deepSeekDefaultModelId, deepSeekModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import { normalizeOpenAiStyleUsage } from "../transform/usage"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream } from "../transform/stream"
import { assertKnownModel, resolveRegistryModel } from "./model-resolution"

interface DeepSeekHandlerOptions extends CommonApiHandlerOptions {
	deepSeekApiKey?: string
	apiModelId?: string
}

export class DeepSeekHandler implements ApiHandler {
	private options: DeepSeekHandlerOptions
	private client: OpenAI | undefined

	constructor(options: DeepSeekHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.deepSeekApiKey) {
				throw new Error("DeepSeek API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.deepseek.com/v1",
					apiKey: this.options.deepSeekApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating DeepSeek client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		// DeepSeek's prompt_tokens is the sum of cache hits and misses (context caching:
		// https://api-docs.deepseek.com/guides/kv_cache). A miss is plain uncached input, not a cache write,
		// so it is reported as input tokens; only hits are reported as cache reads.
		const u = normalizeOpenAiStyleUsage(usage)
		const totalCost = calculateApiCostOpenAI(info, u.promptTokens, u.outputTokens, 0, u.cacheReadTokens)
		yield {
			type: "usage",
			inputTokens: u.uncachedInputTokens,
			outputTokens: u.outputTokens,
			cacheWriteTokens: 0,
			cacheReadTokens: u.cacheReadTokens,
			totalCost: totalCost,
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		assertKnownModel("DeepSeek", this.options.apiModelId, deepSeekModels)
		const client = this.ensureClient()
		const model = this.getModel()

		const isDeepseekReasoner = model.id.includes("deepseek-reasoner")

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		if (isDeepseekReasoner) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const stream = await client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			// Only set temperature for non-reasoner models
			...(model.id === "deepseek-reasoner" ? {} : { temperature: 0 }),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (chunk.usage) {
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	getModel(): { id: DeepSeekModelId; info: ModelInfo } {
		return resolveRegistryModel<DeepSeekModelId>({
			registry: deepSeekModels,
			defaultId: deepSeekDefaultModelId,
			requestedId: this.options.apiModelId,
		})
	}
}
