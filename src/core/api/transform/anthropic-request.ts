import type { Anthropic } from "@anthropic-ai/sdk"
import type { ClaudeModelInfo } from "@shared/api"

/**
 * Capability-driven request construction for Claude models (direct Anthropic API and Vertex).
 *
 * Replaces hard-coded per-model-id switches. Behaviour comes from ModelInfo flags:
 *  - supportsPromptCache        -> cache_control breakpoints (system + last two user turns)
 *  - supportsAdaptiveThinking   -> thinking: { type: "adaptive" } (budget_tokens is deprecated/rejected there)
 *  - supportsThinkingBudget     -> legacy thinking: { type: "enabled", budget_tokens }
 *  - supportsEffort             -> output_config.effort
 *  - supportsTemperature=false  -> no temperature at all
 *
 * The pinned @anthropic-ai/sdk (0.37) predates `thinking.type: "adaptive"`, `thinking.display` and
 * `output_config`. The SDK serialises the params object verbatim as the JSON body, so those fields
 * are carried in a separate `extraBody` bag that is spread into the params. This is the only place
 * the type system is stepped around, and it is covered by unit tests on the produced body.
 */

export const ANTHROPIC_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const
export type AnthropicEffort = (typeof ANTHROPIC_EFFORT_LEVELS)[number]

export function parseAnthropicEffort(value: unknown): AnthropicEffort | undefined {
	return typeof value === "string" && (ANTHROPIC_EFFORT_LEVELS as readonly string[]).includes(value)
		? (value as AnthropicEffort)
		: undefined
}

export interface AnthropicReasoningPlan {
	/** Fields not present in the pinned SDK types (thinking adaptive/display, output_config). */
	extraBody: { thinking?: Record<string, unknown>; output_config?: { effort: AnthropicEffort } }
	/** Legacy SDK-typed thinking config (budget_tokens), only for models that require/accept it. */
	budgetThinking?: { type: "enabled"; budget_tokens: number }
	/** True when any thinking is requested; callers must then omit temperature. */
	thinkingRequested: boolean
	/** False when the model rejects an explicit temperature, or thinking is on. */
	sendTemperature: boolean
}

export function planAnthropicReasoning(
	info: ClaudeModelInfo,
	thinkingBudgetTokens: number | undefined,
	effort?: string,
): AnthropicReasoningPlan {
	const userWantsThinking = (thinkingBudgetTokens || 0) !== 0
	const plan: AnthropicReasoningPlan = { extraBody: {}, thinkingRequested: false, sendTemperature: true }

	if (info.supportsAdaptiveThinking) {
		// Adaptive models: the budget slider is only an on/off signal. Never send budget_tokens
		// (deprecated on 4.6, a 400 on later models). Models whose thinking cannot be disabled
		// simply run adaptive when the param is omitted.
		if (userWantsThinking) {
			plan.extraBody.thinking = { type: "adaptive", display: "summarized" }
			plan.thinkingRequested = true
		}
	} else if (info.supportsThinkingBudget && userWantsThinking) {
		plan.budgetThinking = { type: "enabled", budget_tokens: thinkingBudgetTokens as number }
		plan.thinkingRequested = true
	}

	const parsedEffort = parseAnthropicEffort(effort)
	if (info.supportsEffort && parsedEffort) {
		const clamped = parsedEffort === "xhigh" && !info.supportsXhighEffort ? "high" : parsedEffort
		plan.extraBody.output_config = { effort: clamped }
	}

	// "Thinking isn't compatible with temperature, top_p, or top_k modifications" and the newest
	// models reject any explicit temperature outright.
	plan.sendTemperature = info.supportsTemperature !== false && !plan.thinkingRequested
	return plan
}

/** Mark the system prompt and the last two user turns as cache breakpoints. */
export function applyAnthropicCacheControl(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
	const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])
	const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
	const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1
	return messages.map((message, index) => {
		if (index !== lastUserMsgIndex && index !== secondLastMsgUserIndex) {
			return message
		}
		return {
			...message,
			content:
				typeof message.content === "string"
					? [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }]
					: message.content.map((content, contentIndex) =>
							contentIndex === message.content.length - 1
								? { ...content, cache_control: { type: "ephemeral" } }
								: content,
						),
		} as Anthropic.Messages.MessageParam
	})
}

export function buildAnthropicStreamRequest(args: {
	modelId: string
	info: ClaudeModelInfo
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	thinkingBudgetTokens?: number
	reasoningEffort?: string
}): Anthropic.Messages.MessageCreateParamsStreaming {
	const { modelId, info, systemPrompt, messages } = args
	const plan = planAnthropicReasoning(info, args.thinkingBudgetTokens, args.reasoningEffort)
	const cache = !!info.supportsPromptCache

	const params: Anthropic.Messages.MessageCreateParamsStreaming = {
		model: modelId,
		max_tokens: info.maxTokens || 8192,
		...(plan.budgetThinking ? { thinking: plan.budgetThinking } : {}),
		...(plan.sendTemperature ? { temperature: 0 } : {}),
		system: [{ text: systemPrompt, type: "text", ...(cache ? { cache_control: { type: "ephemeral" as const } } : {}) }],
		messages: cache ? applyAnthropicCacheControl(messages) : messages,
		stream: true,
	}
	// extraBody carries fields newer than the pinned SDK's types; it is serialised verbatim.
	return Object.assign(params, plan.extraBody)
}
