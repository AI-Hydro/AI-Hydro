import { Anthropic } from "@anthropic-ai/sdk"
import { FireworksModelId, fireworksDefaultModelId, fireworksModels, ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { normalizeOpenAiStyleUsage, OpenAiStyleUsageInput } from "../transform/usage"
import { assertKnownModel, resolveRegistryModel } from "./model-resolution"

interface FireworksHandlerOptions extends CommonApiHandlerOptions {
	fireworksApiKey?: string
	fireworksModelId?: string
	fireworksModelMaxCompletionTokens?: number
	fireworksModelMaxTokens?: number
}

export class FireworksHandler implements ApiHandler {
	private options: FireworksHandlerOptions
	private client: OpenAI | undefined

	constructor(options: FireworksHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.fireworksApiKey) {
				throw new Error("Fireworks API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.fireworks.ai/inference/v1",
					apiKey: this.options.fireworksApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating Fireworks client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		assertKnownModel("Fireworks", this.options.fireworksModelId, fireworksModels)
		const client = this.ensureClient()
		const modelId = this.options.fireworksModelId ?? ""

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0,
		})

		let reasoning: string | null = null
		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (reasoning || delta?.content?.includes("<think>")) {
				reasoning = (reasoning || "") + (delta.content ?? "")
			}

			if (delta?.content && !reasoning) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (reasoning || ("reasoning_content" in delta && delta.reasoning_content)) {
				yield {
					type: "reasoning",
					reasoning: delta.content || ((delta as any).reasoning_content as string | undefined) || "",
				}
				if (reasoning?.includes("</think>")) {
					// Reset so the next chunk is regular content
					reasoning = null
				}
			}

			if (chunk.usage) {
				// prompt_tokens is the whole prompt; report it in the meter convention (uncached input / cache hits).
				const u = normalizeOpenAiStyleUsage(chunk.usage as OpenAiStyleUsageInput)
				yield {
					type: "usage",
					inputTokens: u.uncachedInputTokens,
					outputTokens: u.outputTokens,
					cacheReadTokens: u.cacheReadTokens,
					cacheWriteTokens: u.cacheWriteTokens,
				}
			}
		}
	}

	getModel(): { id: FireworksModelId; info: ModelInfo } {
		return resolveRegistryModel<FireworksModelId>({
			registry: fireworksModels,
			defaultId: fireworksDefaultModelId,
			requestedId: this.options.fireworksModelId,
		})
	}
}
