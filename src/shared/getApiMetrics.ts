import { subagentStatusUsage } from "./aihydro/subagents"
import { AiHydroMessage } from "./ExtensionMessage"

interface ApiMetrics {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number
	totalCacheReads?: number
	totalCost: number
}

/**
 * Calculates API metrics from an array of AiHydroMessages.
 *
 * This function processes 'api_req_started' messages that have been combined with their
 * corresponding 'api_req_finished' messages by the combineApiRequests function. It also takes into account 'deleted_api_reqs' messages, which are aggregated from deleted messages.
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of AiHydroMessage objects to process.
 * @returns An ApiMetrics object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, and totalCost.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = getApiMetrics(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
/**
 * Token meter semantics (one definition, shared by the extension host and the webview):
 *
 *   tokensIn    input tokens that were neither cache hits nor cache writes ("uncached input")
 *   cacheReads  cache hits
 *   cacheWrites tokens written to the cache (only providers that bill a write: Anthropic, Bedrock, Vertex)
 *   tokensOut   output tokens
 *
 * Providers normalise to this convention (see core/api/transform/usage.ts), so in + reads + writes is the
 * whole prompt of a request, and in + reads + writes + out is that request's "context now".
 */
export interface ApiReqTokens {
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
}

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function parseApiReqTokens(text: string | undefined): ApiReqTokens | undefined {
	if (!text) {
		return undefined
	}
	try {
		const p = JSON.parse(text)
		return {
			tokensIn: num(p.tokensIn),
			tokensOut: num(p.tokensOut),
			cacheWrites: num(p.cacheWrites),
			cacheReads: num(p.cacheReads),
		}
	} catch {
		return undefined
	}
}

/**
 * Per-request context: the whole prompt of the most recent API request that reported usage (uncached input +
 * cache reads + cache writes) plus its output. This is what the context-window bar shows; it is NOT cumulative.
 * Requests with no reported usage (still in flight, or failed) are skipped.
 */
export function getLastApiReqTotalTokens(messages: AiHydroMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say" && msg.say === "api_req_started") {
			const t = parseApiReqTokens(msg.text)
			if (t) {
				const total = t.tokensIn + t.tokensOut + t.cacheWrites + t.cacheReads
				if (total > 0) {
					return total
				}
			}
		}
	}
	return 0
}

export interface TaskUsageSummary {
	/** Last request's whole context (see getLastApiReqTotalTokens). */
	contextNow: number
	/** Cumulative over the task. */
	uncachedInputTokens: number
	cacheReadTokens: number
	cacheWriteTokens: number
	outputTokens: number
	/** uncached + reads + writes, cumulative. */
	totalInputTokens: number
	/** Everything billed or processed this task: input + output. */
	totalTokens: number
	/** Cache hits as a share of all input this task, 0-100, or undefined when there was no input. */
	cachedPercent: number | undefined
	totalCost: number
}

export function summarizeTaskUsage(messages: AiHydroMessage[]): TaskUsageSummary {
	const m = getApiMetrics(messages)
	const reads = m.totalCacheReads ?? 0
	const writes = m.totalCacheWrites ?? 0
	const totalInput = m.totalTokensIn + reads + writes
	return {
		contextNow: getLastApiReqTotalTokens(messages),
		uncachedInputTokens: m.totalTokensIn,
		cacheReadTokens: reads,
		cacheWriteTokens: writes,
		outputTokens: m.totalTokensOut,
		totalInputTokens: totalInput,
		totalTokens: totalInput + m.totalTokensOut,
		cachedPercent: totalInput > 0 ? Math.round((reads / totalInput) * 100) : undefined,
		totalCost: m.totalCost,
	}
}

/** "67k", "1.0M", "325k": compact count for the headline. */
export function formatCompactTokens(n: number): string {
	// Truncate rather than round, so "325k" never overstates a 325,5xx figure.
	if (n >= 1_000_000) {
		return `${(Math.floor(n / 100_000) / 10).toFixed(1)}M`
	}
	if (n >= 1_000) {
		return `${Math.floor(n / 1_000)}k`
	}
	return String(Math.round(n))
}

/**
 * One-line headline for the task header, e.g.
 *   "Context now: 67k of 1.0M · This task: 325k tokens (79% cached) · $0.11"
 * The context figure is per request and the task figure is cumulative; saying both keeps the two apart.
 */
export function formatUsageHeadline(args: {
	contextNow: number
	contextWindow: number
	totalTokens: number
	cachedPercent: number | undefined
	totalCost?: number
}): string {
	const parts = [`Context now: ${formatCompactTokens(args.contextNow)} of ${formatCompactTokens(args.contextWindow)}`]
	const cached = args.cachedPercent !== undefined && args.cachedPercent > 0 ? ` (${args.cachedPercent}% cached)` : ""
	parts.push(`This task: ${formatCompactTokens(args.totalTokens)} tokens${cached}`)
	if (args.totalCost) {
		parts.push(`$${args.totalCost.toFixed(2)}`)
	}
	return parts.join(" \u00b7 ")
}

export function getApiMetrics(messages: AiHydroMessage[]): ApiMetrics {
	const result: ApiMetrics = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
	}

	messages.forEach((message) => {
		// Subagent children are billed requests too: a spawn call's status row carries their running totals.
		if (message.type === "say" && message.say === "subagent_status") {
			const usage = subagentStatusUsage(message.text)
			result.totalTokensIn += usage.tokensIn
			result.totalTokensOut += usage.tokensOut
			if (usage.cacheWrites > 0) {
				result.totalCacheWrites = (result.totalCacheWrites ?? 0) + usage.cacheWrites
			}
			if (usage.cacheReads > 0) {
				result.totalCacheReads = (result.totalCacheReads ?? 0) + usage.cacheReads
			}
			result.totalCost += usage.cost
			return
		}
		if (message.type === "say" && (message.say === "api_req_started" || message.say === "deleted_api_reqs") && message.text) {
			try {
				const parsedData = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads, cost } = parsedData

				if (typeof tokensIn === "number") {
					result.totalTokensIn += tokensIn
				}
				if (typeof tokensOut === "number") {
					result.totalTokensOut += tokensOut
				}
				if (typeof cacheWrites === "number") {
					result.totalCacheWrites = (result.totalCacheWrites ?? 0) + cacheWrites
				}
				if (typeof cacheReads === "number") {
					result.totalCacheReads = (result.totalCacheReads ?? 0) + cacheReads
				}
				if (typeof cost === "number") {
					result.totalCost += cost
				}
			} catch (error) {
				console.error("Error parsing JSON:", error)
			}
		}
	})

	return result
}
