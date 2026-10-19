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
	// thinking counts toward it) need that much headroom, or a prompt condensed "just under" the threshold can still
	// overflow once the answer is added. Only applies when the model's max output is a real fraction of the window
	// (the 8k-32k defaults elsewhere are already covered by the fixed buffers above).
	const maxOutput = modelInfo.maxTokens ?? 0
	if (maxOutput > 40_000 && maxOutput < contextWindow) {
		maxAllowedSize = Math.min(maxAllowedSize, contextWindow - maxOutput - CONTEXT_MARGIN_TOKENS)
	}

	return { contextWindow, maxAllowedSize }
}
