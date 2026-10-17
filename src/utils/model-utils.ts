import { ApiHandlerModel, ApiProviderInfo } from "@core/api"
import { AnthropicModelId, anthropicModels } from "@/shared/api"

export function modelDoesntSupportWebp(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("grok")
}

/**
 * Determines if reasoning content should be skipped for a given model
 * Currently skips reasoning for Grok-4 models since they only display "thinking" without useful information
 */
export function shouldSkipReasoningForModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}
	return modelId.includes("grok-4")
}

export function isAnthropicModelId(modelId: string): modelId is AnthropicModelId {
	return modelId in anthropicModels || isClaude4ModelFamily(modelId) || isClaude5ModelFamily(modelId)
}

export function isClaude4ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return (
		modelId.includes("sonnet-4") ||
		modelId.includes("opus-4") ||
		modelId.includes("4-sonnet") ||
		modelId.includes("4-opus") ||
		modelId.includes("haiku-4") ||
		modelId.includes("4-5-haiku") ||
		modelId.includes("4.5-haiku")
	)
}

/**
 * Claude 5.x line (fable-5-1, opus-5-5, sonnet-5-5, haiku-5-5, ... and dotted OpenRouter-style ids such
 * as "anthropic/claude-opus-5.5"). Substring matching, like the 4.x check, so it also covers dated,
 * region-prefixed and "anthropic."-prefixed ids. "claude-3-5-sonnet" does not match ("sonnet-5" only
 * appears in the 5.x naming).
 */
export function isClaude5ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return /(?:fable|mythos|opus|sonnet|haiku)-5(?![0-9])/.test(modelId)
}

export function isGemini2dot5ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gemini-2.5")
}

/** Gemini 3.x (e.g. gemini-3.1-pro-preview, the registry's Gemini default). */
export function isGemini3ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return /gemini-3(?![0-9])/.test(modelId)
}

export function isGrok4ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("grok-4")
}

export function isGPT5ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gpt-5") || modelId.includes("gpt5")
}

/**
 * Capable open-weight models in the DeepSeek-v4 series. These are strong enough
 * to warrant flagship-grade harness treatment (richer prompt, auto-condense,
 * higher mistake tolerance) even though they are not "next-gen" frontier models.
 */
export function isDeepSeekV4ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("deepseek-v4")
}

export function isNextGenModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return (
		isClaude4ModelFamily(modelId) ||
		isClaude5ModelFamily(modelId) ||
		isGemini2dot5ModelFamily(modelId) ||
		isGemini3ModelFamily(modelId) ||
		isGrok4ModelFamily(modelId) ||
		isGPT5ModelFamily(modelId)
	)
}

export function isLocalModel(providerInfo: ApiProviderInfo): boolean {
	const localProviders = ["lmstudio", "ollama"]
	return localProviders.includes(normalize(providerInfo.providerId))
}

/**
 * Parses a price string and converts it from per-token to per-million-tokens
 * @param priceString The price string to parse (e.g. from API responses)
 * @returns The price multiplied by 1,000,000 for per-million-token pricing, or 0 if invalid
 */
export function parsePrice(priceString: string | undefined): number {
	if (!priceString || priceString === "" || priceString === "0") {
		return 0
	}
	const parsed = parseFloat(priceString)
	if (Number.isNaN(parsed)) {
		return 0
	}
	// Convert from per-token to per-million-tokens (multiply by 1,000,000)
	return parsed * 1_000_000
}

function normalize(text: string): string {
	return text.trim().toLowerCase()
}
