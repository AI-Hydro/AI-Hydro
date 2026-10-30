/**
 * Shared vocabulary for in-process subagents (plan: docs/vision-2040/plans/subagents.md). Pure types and small pure
 * helpers, so the host, the transcript presenter and the webview agree on one definition.
 *
 * Only the `explorer` profile exists. A child is never more capable than its parent, never creates, revises or
 * approves a claim, and returns its output to the parent as untrusted text.
 */

export type SubagentProfileId = "explorer"

/** Where a child ask came from. Stamped by the host on the parent's ask; never supplied by a model. */
export interface SubagentOrigin {
	childId: string
	/** "Explorer 2": the label the status row, the approval chip and the live region all use. */
	label: string
	profile: SubagentProfileId
	/** First line of the child's prompt (capped), so the approval card can say what the child is trying to do. */
	promptHead: string
}

/**
 * queued: waiting for a free slot (at most 3 run at once). waiting: blocked on the user's answer to one of its asks.
 * completed: it called report_findings. partial: a budget stopped it (its last assistant text is kept). blocked: it kept
 * hitting policy refusals. failed: an error. cancelled: Stop, or the parent task ended.
 */
export type SubagentStatus = "queued" | "running" | "waiting" | "completed" | "partial" | "blocked" | "failed" | "cancelled"

export const SUBAGENT_FINAL_STATUSES: readonly SubagentStatus[] = ["completed", "partial", "blocked", "failed", "cancelled"]

export function isFinalSubagentStatus(status: SubagentStatus): boolean {
	return SUBAGENT_FINAL_STATUSES.includes(status)
}

/** What a child hands back with report_findings. The host validates and writes it; the child has no write tool. */
export interface SubagentReport {
	summary: string
	keyFindings: string[]
	filesRead: string[]
	openQuestions: string[]
}

export interface SubagentUsage {
	toolCalls: number
	turns: number
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	/** Sum of provider-reported cost; undefined when the provider reports none (a USD cap then does not apply). */
	cost?: number
}

export interface SubagentBudget {
	maxToolCalls: number
	wallClockMs: number
	/** Cumulative output tokens across the child's turns. */
	maxOutputTokens: number
	/** Stop at this fraction of the model's context window (measured from the last request's input tokens). */
	contextStopFraction: number
	/** Applies only when the provider reports cost. */
	maxCostUsd: number
}

/** Why a child was stopped by its budget, in words the status row can show. */
export type SubagentBudgetStop = "tool_calls" | "wall_clock" | "output_tokens" | "context" | "cost"

/** One tool call, as the record and the expanded status row show it. Arguments are hashed, never stored. */
export interface SubagentToolCallRecord {
	name: string
	server?: string
	tool?: string
	argsSha256: string
	/** How the call was approved: auto (inside the child's read ceiling), asked and approved, asked and denied, or refused by the profile before any ask. */
	approval: "auto" | "approved" | "denied" | "refused"
	result: "ok" | "error" | "refused" | "denied"
}

/** An origin from a stored or transmitted ask; anything that is not exactly the expected shape is no origin at all. */
export function parseSubagentOrigin(json: string): SubagentOrigin | undefined {
	try {
		const v = JSON.parse(json)
		if (
			v &&
			typeof v.childId === "string" &&
			typeof v.label === "string" &&
			v.profile === "explorer" &&
			typeof v.promptHead === "string"
		) {
			return { childId: v.childId, label: v.label, profile: v.profile, promptHead: v.promptHead }
		}
	} catch {
		// not an origin
	}
	return undefined
}

/** A tool call in the expanded status row: the name and how it ended. No arguments, no results. */
export interface SubagentCallLine {
	name: string
	/** The MCP tool, when the call was an MCP call. */
	tool?: string
	approval: SubagentToolCallRecord["approval"]
	result: SubagentToolCallRecord["result"]
}

/** The part of a child the status row shows. Everything here is a summary the host computed, never raw model output. */
export interface SubagentChildSummary {
	childId: string
	label: string
	profile: SubagentProfileId
	/** First line of the child's prompt, capped. */
	promptHead: string
	status: SubagentStatus
	lastTool?: string
	toolCalls: number
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost?: number
	budgetStop?: SubagentBudgetStop
	/** Path of the child record under the task directory (relative), once written. */
	recordPath?: string
	/** The most recent calls (capped), for the expanded row. */
	calls: SubagentCallLine[]
}

/** What the launch ask shows the user before anything runs. */
export interface SubagentLaunch {
	profile: SubagentProfileId
	prompts: string[]
	budget: SubagentBudget
	/** The model every child will use (the parent's). */
	model: string
	/** One sentence on what the profile cannot do, from the profile, so the card never overstates. */
	limits: string
}

/** The text of a `subagent_status` row. One per spawn call, rewritten in place as the children progress. */
export interface SubagentStatusPayload {
	profile: SubagentProfileId
	children: SubagentChildSummary[]
	/** True once every child has ended. */
	done: boolean
}

export function parseSubagentStatus(text: string | undefined): SubagentStatusPayload | undefined {
	try {
		const value = JSON.parse(text ?? "")
		if (value && typeof value === "object" && Array.isArray(value.children) && typeof value.done === "boolean") {
			return value as SubagentStatusPayload
		}
	} catch {
		// a malformed row is shown as nothing rather than guessed at
	}
	return undefined
}

/** Whole-call usage from a status row, for the task totals. */
export function subagentStatusUsage(text: string | undefined): {
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost: number
} {
	const total = { tokensIn: 0, tokensOut: 0, cacheWrites: 0, cacheReads: 0, cost: 0 }
	for (const child of parseSubagentStatus(text)?.children ?? []) {
		total.tokensIn += child.tokensIn || 0
		total.tokensOut += child.tokensOut || 0
		total.cacheWrites += child.cacheWrites || 0
		total.cacheReads += child.cacheReads || 0
		total.cost += child.cost || 0
	}
	return total
}

/** Constants shared by the host and the transcript so a label can be rebuilt from an index. */
export function subagentLabel(profile: SubagentProfileId, ordinal: number): string {
	return `${profile === "explorer" ? "Explorer" : "Subagent"} ${ordinal}`
}

/** The first line of a child's prompt, whitespace-collapsed and capped, for the approval chip and the status row. */
export function promptHeadOf(prompt: string, max = 120): string {
	const first = (prompt.split(/\r?\n/).find((line) => line.trim()) ?? "").replace(/\s+/g, " ").trim()
	return first.length > max ? `${first.slice(0, max - 1)}…` : first
}
