import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"
import { ClaudeModelInfo, VertexModelId, vertexDefaultModelId, vertexModels } from "@shared/api"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { buildAnthropicStreamRequest } from "../transform/anthropic-request"
import { ApiStream } from "../transform/stream"
import { GeminiHandler } from "./gemini"
import { assertKnownModel, resolveRegistryModel } from "./model-resolution"

interface VertexHandlerOptions extends CommonApiHandlerOptions {
	vertexProjectId?: string
	vertexRegion?: string
	apiModelId?: string
	thinkingBudgetTokens?: number
	reasoningEffort?: string
	geminiApiKey?: string
	geminiBaseUrl?: string
	ulid?: string
}

export class VertexHandler implements ApiHandler {
	private geminiHandler: GeminiHandler | undefined
	private clientAnthropic: AnthropicVertex | undefined
	private options: VertexHandlerOptions

	constructor(options: VertexHandlerOptions) {
		this.options = options
	}

	private ensureGeminiHandler(): GeminiHandler {
		if (!this.geminiHandler) {
			try {
				// Create a GeminiHandler with isVertex flag for Gemini models
				this.geminiHandler = new GeminiHandler({
					...this.options,
					isVertex: true,
				})
			} catch (error: any) {
				throw new Error(`Error creating Vertex AI Gemini handler: ${error.message}`)
			}
		}
		return this.geminiHandler
	}

	private ensureAnthropicClient(): AnthropicVertex {
		if (!this.clientAnthropic) {
			if (!this.options.vertexProjectId) {
				throw new Error("Vertex AI project ID is required")
			}
			if (!this.options.vertexRegion) {
				throw new Error("Vertex AI region is required")
			}
			try {
				// Initialize Anthropic client for Claude models
				this.clientAnthropic = new AnthropicVertex({
					projectId: this.options.vertexProjectId,
					// https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#regions
					region: this.options.vertexRegion,
				})
			} catch (error: any) {
				throw new Error(`Error creating Vertex AI Anthropic client: ${error.message}`)
			}
		}
		return this.clientAnthropic
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		assertKnownModel("Vertex AI", this.options.apiModelId, vertexModels)
		const model = this.getModel()
		const modelId = model.id

		// For Gemini models, use the GeminiHandler
		if (!modelId.includes("claude")) {
			const geminiHandler = this.ensureGeminiHandler()
			yield* geminiHandler.createMessage(systemPrompt, messages)
			return
		}

		const clientAnthropic = this.ensureAnthropicClient()

		// Claude implementation: request shape is driven by ModelInfo capability flags.
		const request = buildAnthropicStreamRequest({
			modelId,
			info: model.info,
			systemPrompt,
			messages,
			thinkingBudgetTokens: this.options.thinkingBudgetTokens,
			reasoningEffort: this.options.reasoningEffort,
		})
		const stream = await clientAnthropic.beta.messages.create(request as Anthropic.Beta.Messages.MessageCreateParamsStreaming)

		for await (const chunk of stream) {
			switch (chunk?.type) {
				case "message_start":
					if (chunk.message.model) {
						yield { type: "response_model", modelId: chunk.message.model }
					}
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
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage?.output_tokens || 0,
					}
					break
				case "message_stop":
					break
				case "content_block_start":
					switch (chunk.content_block.type) {
						case "thinking":
							yield {
								type: "reasoning",
								reasoning: chunk.content_block.thinking || "",
							}
							break
						case "redacted_thinking":
							// Handle redacted thinking blocks - we still mark it as reasoning
							// but note that the content is encrypted
							yield {
								type: "reasoning",
								reasoning: "[Redacted thinking block]",
							}
							break
						case "text":
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
							yield {
								type: "reasoning",
								reasoning: chunk.delta.thinking,
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

	getModel(): { id: VertexModelId; info: ClaudeModelInfo } {
		return resolveRegistryModel({
			registry: vertexModels,
			defaultId: vertexDefaultModelId,
			requestedId: this.options.apiModelId,
		})
	}
}
