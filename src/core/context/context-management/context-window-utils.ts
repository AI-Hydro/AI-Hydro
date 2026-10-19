import { ApiHandler } from "@core/api"
import { OpenAiHandler } from "@core/api/providers/openai"

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
/** Slack for tokenizer drift and per-request overhead on top of the output reserve. */
export const CONTEXT_MARGIN_TOKENS = 20_000

/** Upper bound on the share of the window reserved for the response. */
export const MAX_OUTPUT_RESERVE_FRACTION = 0.2

export function getContextWindowInfo(api: ApiHandler) {
	const modelInfo = api.getModel().info
	let contextWindow = modelInfo.contextWindow || 128_000
	// FIXME: hack to get anyone using openai compatible with deepseek to have the proper context window instead of the default 128k. We need a way for the user to specify the context window for models they input through openai compatible

	// Handle special cases like DeepSeek
	if (api instanceof OpenAiHandler && api.getModel().id.toLowerCase().includes("deepseek")) {
		contextWindow = 128_000
	}

	let maxAllowedSize: number
	switch (contextWindow) {
		case 64_000: // deepseek models
			maxAllowedSize = contextWindow - 27_000
			break
		case 128_000: // most models
			maxAllowedSize = contextWindow - 30_000
			break
		case 200_000: // claude models
			maxAllowedSize = contextWindow - 40_000
			break
		default:
			maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
	}

	// Input plus the response must fit in the window. Models whose max output is large (Claude 5.x: 128K, and
	// thinking counts toward it) need headroom, or a prompt condensed "just under" the threshold can still overflow once
	// the answer is added. The reservation is clamped to 20% of the window: models whose maxTokens is nearly the whole
	// window (e.g. 129,024 of 131,072) would otherwise get a zero or negative budget and condense on every request.
	const maxOutput = modelInfo.maxTokens ?? 0
	if (maxOutput > 40_000) {
		const reserve = Math.min(maxOutput, MAX_OUTPUT_RESERVE_FRACTION * contextWindow)
		// A flat 20k margin would leave 64k windows under half usable, so it scales down on small windows.
		const margin = Math.min(CONTEXT_MARGIN_TOKENS, 0.05 * contextWindow)
		maxAllowedSize = Math.min(maxAllowedSize, contextWindow - reserve - margin)
	}

	return { contextWindow, maxAllowedSize }
}
