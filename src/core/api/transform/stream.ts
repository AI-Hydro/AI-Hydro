export type ApiStream = AsyncGenerator<ApiStreamChunk>
export type ApiStreamChunk =
	| ApiStreamTextChunk
	| ApiStreamReasoningChunk
	| ApiStreamReasoningDetailsChunk
	| ApiStreamAnthropicThinkingChunk
	| ApiStreamAnthropicRedactedThinkingChunk
	| ApiStreamUsageChunk
	| ApiStreamResponseModelChunk

export interface ApiStreamTextChunk {
	type: "text"
	text: string
}

export interface ApiStreamReasoningChunk {
	type: "reasoning"
	reasoning: string
}

export interface ApiStreamReasoningDetailsChunk {
	type: "reasoning_details"
	reasoning_details: any // openrouter has various properties that we can pass back unmodified in api requests to preserve reasoning traces
}

export interface ApiStreamAnthropicThinkingChunk {
	type: "ant_thinking"
	thinking: string
	signature: string
}

export interface ApiStreamAnthropicRedactedThinkingChunk {
	type: "ant_redacted_thinking"
	data: string
}

export interface ApiStreamUsageChunk {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
	thoughtsTokenCount?: number // openrouter
	totalCost?: number // openrouter
}

/** The model id the provider reports it actually served (e.g. Anthropic message_start.message.model). */
export interface ApiStreamResponseModelChunk {
	type: "response_model"
	modelId: string
}
