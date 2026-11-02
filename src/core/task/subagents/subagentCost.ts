import type { SubagentCostStatus } from "@shared/aihydro/subagents"
import type { ModelInfo } from "@shared/api"
import { assessApiCost, calculateApiCostAnthropic } from "@/utils/cost"

/** Token counts and the provider-reported cost for one model request, summed over its usage chunks as the parent does. */
export interface RequestUsage {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	/** The last cost a usage chunk carried (the parent keeps the last, not the sum). */
	totalCost?: number
	/** False when the stream ended without any usage chunk: nothing was measured. */
	received: boolean
}

export function emptyRequestUsage(): RequestUsage {
	return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, received: false }
}

export interface PricedRequest {
	/** Undefined when the cost of this request is unknown. */
	cost?: number
	status?: SubagentCostStatus
}

/** Whether the model carries a price table at all. A model with neither price listed has no computable cost. */
export function modelHasPrices(info: ModelInfo): boolean {
	return info.inputPrice !== undefined || info.outputPrice !== undefined
}

/**
 * Whether a cost can be known for this model without the provider reporting one: its prices are verified and present.
 * The launch card uses it to say up front that a dollar cap cannot fire.
 */
export function isModelPriced(info: ModelInfo): boolean {
	return assessApiCost(info) !== "unavailable" && modelHasPrices(info)
}

/**
 * One request's cost, the way `updateApiReqMsg` computes the parent's: the provider's own figure when it sent one, else
 * `calculateApiCostAnthropic` on the request's tokens, and no number when the model's price is unverified. Where the
 * parent would record $0 for a model with no price table, the child says unknown: a cap compared with a made-up zero
 * would look enforced and never fire.
 */
export function priceRequest(info: ModelInfo, usage: RequestUsage): PricedRequest {
	if (!usage.received) {
		return { status: "unavailable" }
	}
	const status = assessApiCost(info, usage.cacheWriteTokens, usage.cacheReadTokens)
	if (status === "unavailable") {
		return { status: "unavailable" }
	}
	const flag = status === "lower-bound" ? ({ status } as const) : {}
	if (usage.totalCost !== undefined) {
		return { cost: usage.totalCost, ...flag }
	}
	if (!modelHasPrices(info)) {
		return { status: "unavailable" }
	}
	const cost = calculateApiCostAnthropic(
		info,
		usage.inputTokens,
		usage.outputTokens,
		usage.cacheWriteTokens,
		usage.cacheReadTokens,
	)
	return { cost, ...flag }
}

/** A child's running cost over its requests. Unknown requests make the total a lower bound, or unknown if none was priced. */
export class CostTally {
	private known = 0
	private pricedRequests = 0
	private unknownRequests = 0
	private lowerBound = false

	/** Adds one settled request and returns the dollars it contributes to the total (0 when unknown). */
	add(request: PricedRequest): number {
		if (request.cost === undefined) {
			this.unknownRequests++
			return 0
		}
		this.pricedRequests++
		this.known += request.cost
		this.lowerBound = this.lowerBound || request.status === "lower-bound"
		return request.cost
	}

	get cost(): number | undefined {
		return this.pricedRequests > 0 ? this.known : undefined
	}

	get status(): SubagentCostStatus | undefined {
		if (this.pricedRequests === 0) {
			return this.unknownRequests > 0 ? "unavailable" : undefined
		}
		return this.unknownRequests > 0 || this.lowerBound ? "lower-bound" : undefined
	}

	/** True once any request's cost was unknown, so the total (if any) undercounts. */
	get hasUnknown(): boolean {
		return this.unknownRequests > 0
	}
}
