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
	cost?: number
	budgetStop?: SubagentBudgetStop
	/** Path of the child record under the task directory (relative), once written. */
	recordPath?: string
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
