import type { SubagentBudgetStop, SubagentChildSummary, SubagentStatus } from "@shared/aihydro/subagents"
import { formatCompactTokens } from "@shared/getApiMetrics"

/** The state in words. "Waiting for you" is the only one that needs the user, so it says so. */
export function statusLabel(child: Pick<SubagentChildSummary, "status" | "budgetStop">): string {
	switch (child.status) {
		case "queued":
			return "Queued"
		case "running":
			return "Running"
		case "waiting":
			return "Waiting for you"
		case "completed":
			return "Done"
		case "partial":
			return child.budgetStop ? `Stopped early: ${stopLabel(child.budgetStop)}` : "Stopped early"
		case "blocked":
			return "Blocked: its profile refused its calls"
		case "failed":
			return "Failed"
		case "cancelled":
			return "Cancelled"
		default: {
			const unreachable: never = child.status
			return String(unreachable)
		}
	}
}

export function stopLabel(stop: SubagentBudgetStop): string {
	switch (stop) {
		case "tool_calls":
			return "tool-call budget used"
		case "wall_clock":
			return "out of time"
		case "output_tokens":
			return "output budget used"
		case "context":
			return "context nearly full"
		case "cost":
			return "cost cap reached"
	}
}

export const STATUS_ICON: Record<SubagentStatus, string> = {
	queued: "clock",
	running: "loading codicon-modifier-spin",
	waiting: "bell",
	completed: "check",
	partial: "debug-pause",
	blocked: "circle-slash",
	failed: "error",
	cancelled: "stop-circle",
}

/** "12 calls · 4.2k tokens · $0.0123". Cost only when the provider reported one; never "$0.0000". */
export function usageLine(
	child: Pick<SubagentChildSummary, "toolCalls" | "tokensIn" | "tokensOut" | "cacheReads" | "cacheWrites" | "cost">,
): string {
	const tokens = child.tokensIn + child.tokensOut + (child.cacheReads || 0) + (child.cacheWrites || 0)
	const parts = [`${child.toolCalls} call${child.toolCalls === 1 ? "" : "s"}`, `${formatCompactTokens(tokens)} tokens`]
	if (child.cost !== undefined && child.cost > 0) {
		parts.push(`$${child.cost.toFixed(4)}`)
	}
	return parts.join(" · ")
}
