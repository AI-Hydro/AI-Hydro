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
	prompt_cache_hit_tokens?: number | null
	prompt_cache_miss_tokens?: number | null
}

export interface NormalizedUsage {
	/** The whole prompt (hits + misses). */
	promptTokens: number
	/** Prompt tokens that were not cache hits. */
	uncachedInputTokens: number
	cacheReadTokens: number
	outputTokens: number
}

export function normalizeOpenAiStyleUsage(usage: OpenAiStyleUsageInput | undefined | null): NormalizedUsage {
	const hit = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0
	const miss = usage?.prompt_cache_miss_tokens
	const reported = usage?.prompt_tokens ?? 0
	// When the API reports hit and miss separately, trust their sum if prompt_tokens is absent.
	const promptTokens = reported || hit + (miss ?? 0)
	const uncached = typeof miss === "number" ? miss : Math.max(0, promptTokens - hit)
	return {
		promptTokens,
		uncachedInputTokens: uncached,
		cacheReadTokens: hit,
		outputTokens: usage?.completion_tokens ?? 0,
	}
}
