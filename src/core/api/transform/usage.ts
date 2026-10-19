/**
 * Provider usage normalisation.
 *
 * The task meter (api_req_started: tokensIn / cacheReads / cacheWrites) uses Anthropic's convention:
 *   tokensIn    = input tokens that were NOT served from, or written to, the cache
 *   cacheReads  = cache hits
 *   cacheWrites = tokens written to the cache (only providers that bill a write: Anthropic, Bedrock, Vertex)
 * so that in + cacheReads + cacheWrites is the whole prompt and nothing is counted twice.
 *
 * OpenAI-style APIs report `prompt_tokens` as the whole prompt, with the cached part in
 * `prompt_tokens_details.cached_tokens` (OpenAI) or `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
 * (DeepSeek). A "miss" there is ordinary uncached input; none of these APIs has a cache-write charge.
 */
export interface OpenAiStyleUsageInput {
	prompt_tokens?: number | null
	completion_tokens?: number | null
	prompt_tokens_details?: { cached_tokens?: number | null } | null
	/** DeepSeek-style. */
	prompt_cache_hit_tokens?: number | null
	prompt_cache_miss_tokens?: number | null
	/** Anthropic-style, as passed through by LiteLLM / OCA proxies. */
	cache_creation_input_tokens?: number | null
	cache_read_input_tokens?: number | null
}

export interface NormalizedUsage {
	/** The whole prompt (uncached + reads + writes). */
	promptTokens: number
	/** Prompt tokens that were neither cache hits nor cache writes. */
	uncachedInputTokens: number
	cacheReadTokens: number
	/** Only the Anthropic-style `cache_creation_input_tokens`; OpenAI/DeepSeek-style APIs have no write charge. */
	cacheWriteTokens: number
	outputTokens: number
}

const positive = (n: number | null | undefined): number => (typeof n === "number" && n > 0 ? n : 0)

/**
 * Detects the usage shape and returns the meter convention (see top of file).
 *  - OpenAI / DeepSeek: prompt_tokens is the whole prompt; hits are cached_tokens / prompt_cache_hit_tokens; a miss is
 *    uncached input.
 *  - Anthropic-style (cache_creation_input_tokens / cache_read_input_tokens): LiteLLM-style proxies report prompt_tokens
 *    as the whole prompt (input + reads + writes). A proxy that forwards Anthropic's raw usage instead has
 *    prompt_tokens = uncached input only, which shows as prompt_tokens < reads + writes; then it is taken as uncached.
 */
export function normalizeOpenAiStyleUsage(usage: OpenAiStyleUsageInput | undefined | null): NormalizedUsage {
	const reads =
		positive(usage?.cache_read_input_tokens) ||
		positive(usage?.prompt_cache_hit_tokens) ||
		positive(usage?.prompt_tokens_details?.cached_tokens)
	const writes = positive(usage?.cache_creation_input_tokens)
	const miss = usage?.prompt_cache_miss_tokens
	const reported = positive(usage?.prompt_tokens)
	const outputTokens = positive(usage?.completion_tokens)

	if (writes === 0 && typeof miss === "number") {
		// DeepSeek-style hit/miss: trust their sum if prompt_tokens is absent.
		return {
			promptTokens: reported || reads + miss,
			uncachedInputTokens: miss,
			cacheReadTokens: reads,
			cacheWriteTokens: 0,
			outputTokens,
		}
	}
	if (reported > 0 && reported < reads + writes) {
		// prompt_tokens excludes the cache tokens (raw Anthropic usage forwarded by a proxy).
		return {
			promptTokens: reported + reads + writes,
			uncachedInputTokens: reported,
			cacheReadTokens: reads,
			cacheWriteTokens: writes,
			outputTokens,
		}
	}
	return {
		promptTokens: reported || reads + writes,
		uncachedInputTokens: Math.max(0, reported - reads - writes),
		cacheReadTokens: reads,
		cacheWriteTokens: writes,
		outputTokens,
	}
}
