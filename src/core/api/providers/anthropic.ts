import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { AnthropicModelId, anthropicDefaultModelId, anthropicModels, CLAUDE_SONNET_1M_SUFFIX, ClaudeModelInfo } from "@shared/api"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { buildAnthropicStreamRequest } from "../transform/anthropic-request"
import { ApiStream } from "../transform/stream"
import { assertKnownModel, resolveRegistryModel } from "./model-resolution"

interface AnthropicHandlerOptions extends CommonApiHandlerOptions {
	apiKey?: string
	anthropicBaseUrl?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
	reasoningEffort?: string
}

export class AnthropicHandler implements ApiHandler {
	private options: AnthropicHandlerOptions
	private client: Anthropic | undefined

	constructor(options: AnthropicHandlerOptions) {
		this.options = options
	}

	private ensureClient(): Anthropic {
		if (!this.client) {
			if (!this.options.apiKey) {
				throw new Error("Anthropic API key is required")
			}
			try {
				this.client = new Anthropic({
					apiKey: this.options.apiKey,
					baseURL: this.options.anthropicBaseUrl || undefined,
				})
			} catch (error) {
				throw new Error(`Error creating Anthropic client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		assertKnownModel("Anthropic", this.options.apiModelId, anthropicModels)

		const model = this.getModel()
		let stream: AnthropicStream<Anthropic.RawMessageStreamEvent>

		const modelId = model.id.endsWith(CLAUDE_SONNET_1M_SUFFIX) ? model.id.slice(0, -CLAUDE_SONNET_1M_SUFFIX.length) : model.id
		const enable1mContextWindow = model.id.endsWith(CLAUDE_SONNET_1M_SUFFIX)

		const request = buildAnthropicStreamRequest({
			modelId,
			info: model.info,
			systemPrompt,
			messages,
			thinkingBudgetTokens: this.options.thinkingBudgetTokens,
			reasoningEffort: this.options.reasoningEffort,
		})
		// 1m context window beta header
		stream = await client.messages.create(
			request,
			enable1mContextWindow ? { headers: { "anthropic-beta": "context-1m-2025-08-07" } } : undefined,
		)

		let thinkingDeltaAccumulator = ""

		for await (const chunk of stream) {
			switch (chunk?.type) {
				case "message_start":
					// The provider-reported model id (may differ from the requested alias); surfaced so it can be recorded in provenance.
					if (chunk.message.model) {
						yield { type: "response_model", modelId: chunk.message.model }
					}
					// tells us cache reads/writes/input/output
					const usage = chunk.message.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
						cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
						cacheReadTokens: usage.cache_read_input_tokens || undefined,
					}
					break
				case "message_delta":
					// tells us stop_reason, stop_sequence, and output tokens along the way and at the end of the message

					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break
				case "message_stop":
					// no usage data, just an indicator that the message is done
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "thinking":
							yield {
								type: "reasoning",
								reasoning: chunk.content_block.thinking || "",
							}
							const thinking = chunk.content_block.thinking
							const signature = chunk.content_block.signature
							if (thinking && signature) {
								yield {
									type: "ant_thinking",
									thinking,
									signature,
								}
							}
							break
						case "redacted_thinking":
							// Content is encrypted, and we don't to pass placeholder text back to the API
							yield {
								type: "reasoning",
								reasoning: "[Redacted thinking block]",
							}
							yield {
								type: "ant_redacted_thinking",
								data: chunk.content_block.data,
							}
							break
						case "text":
							// we may receive multiple text blocks, in which case just insert a line break between them
							if (chunk.index > 0) {
								yield {
									type: "text",
									text: "\n",
								}
							}
							yield {
								type: "text",
								text: chunk.content_block.text,
							}
							break
					}
					break
				case "content_block_delta":
					switch (chunk.delta.type) {
						case "thinking_delta":
							// 'reasoning' type just displays in the UI, but ant_thinking will be used to send the thinking traces back to the API
							yield {
								type: "reasoning",
								reasoning: chunk.delta.thinking,
							}
							thinkingDeltaAccumulator += chunk.delta.thinking
							break
						case "signature_delta":
							// It's used when sending the thinking block back to the API
							// API expects this in completed form, not as array of deltas
							if (thinkingDeltaAccumulator && chunk.delta.signature) {
								yield {
									type: "ant_thinking",
									thinking: thinkingDeltaAccumulator,
									signature: chunk.delta.signature,
								}
							}
							break
						case "text_delta":
							yield {
								type: "text",
								text: chunk.delta.text,
							}
							break
					}
					break
				case "content_block_stop":
					break
			}
		}
	}

	getModel(): { id: AnthropicModelId; info: ClaudeModelInfo } {
		return resolveRegistryModel({
			registry: anthropicModels,
			defaultId: anthropicDefaultModelId,
			requestedId: this.options.apiModelId,
		})
	}
}
