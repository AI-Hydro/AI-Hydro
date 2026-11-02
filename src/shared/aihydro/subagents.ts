/**
 * Shared vocabulary for in-process subagents (plan: docs/vision-2040/plans/subagents.md). Pure types and small pure
 * helpers, so the host, the transcript presenter and the webview agree on one definition.
 *
 * A child runs an agent definition (core/task/subagents/agentDefinition.ts). A child is never more capable than its
 * parent, never creates, revises or approves a claim, and returns its output to the parent as untrusted text.
 */

/** The id of an agent definition: a built-in, or a user file that extends one. Lowercase words joined by hyphens. */
export type SubagentProfileId = string

const AGENT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Whether `value` can be an agent definition id. The shape only; whether the id exists is the registry's to say. */
export function isAgentId(value: unknown): value is SubagentProfileId {
	return typeof value === "string" && value.length <= 40 && AGENT_ID.test(value)
}

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

/**
 * A reviewer's verdict on one statement. "unverifiable" means the reviewer could not check it against anything it was
 * given or could read: that is reported as unverified, never as refuted.
 */
export type ReviewVerdict = "supported" | "unsupported" | "unverifiable"

export const REVIEW_VERDICTS: readonly ReviewVerdict[] = ["supported", "unsupported", "unverifiable"]

/** What a reviewer hands back with report_review. Advisory text from a second model run, never evidence. */
export interface SubagentReviewReport {
	summary: string
	verdicts: Array<{ statement: string; verdict: ReviewVerdict; evidence: string }>
	openQuestions: string[]
}

/** The report shape a definition returns (`reportSchema`). The host validates it; a model cannot choose another. */
export type ReportSchemaId = "findings" | "review"

/**
 * Why a launch is proposed. `bulk`: one wide question. `independent`: separate sizeable questions. `user_asked`: the
 * user asked for subagents. `independent_check`: a reviewer, asked for by the user or before a claim goes to promotion.
 */
export type SubagentSignal = "bulk" | "independent" | "user_asked" | "independent_check"

export const SUBAGENT_SIGNALS: readonly SubagentSignal[] = ["bulk", "independent", "user_asked", "independent_check"]

/** The host caps the model's one-line `purpose` here. */
export const MAX_PURPOSE_CHARS = 140

export interface SubagentUsage {
	toolCalls: number
	turns: number
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	/**
	 * Cost of the child's requests, computed as the parent computes its own (provider-reported when there is one,
	 * otherwise from tokens and the model's prices). Undefined when the cost is unknown (a USD cap then does not apply).
	 */
	cost?: number
	/** "unavailable": no verified price, so `cost` is absent. "lower-bound": `cost` is at least this much. Absent: exact. */
	costStatus?: SubagentCostStatus
}

export type SubagentCostStatus = "unavailable" | "lower-bound"

export interface SubagentBudget {
	maxToolCalls: number
	wallClockMs: number
	/** Cumulative output tokens across the child's turns. */
	maxOutputTokens: number
	/** Stop at this fraction of the model's context window (measured from the last request's input tokens). */
	contextStopFraction: number
	/** Applies only when the cost is known: the model has verified prices, or the provider reports cost. */
	maxCostUsd: number
}

/** Why a child was stopped by its budget, in words the status row can show. */
export type SubagentBudgetStop = "tool_calls" | "wall_clock" | "output_tokens" | "context" | "cost" | "task_cost"

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
			isAgentId(v.profile) &&
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
	costStatus?: SubagentCostStatus
	budgetStop?: SubagentBudgetStop
	/** Path of the child record under the task directory (relative), once written. */
	recordPath?: string
	/** The most recent calls (capped), for the expanded row. */
	calls: SubagentCallLine[]
}

/** What the launch ask shows the user before anything runs. */
export interface SubagentLaunch {
	profile: SubagentProfileId
	/** The definition's display name, singular ("Explorer"). The card builds its headline from it. */
	label?: string
	prompts: string[]
	budget: SubagentBudget
	/** The model every child will use. */
	model: string
	/** The provider every child will use. Shown when it differs from the parent's (D7: opt-in, and the data goes there). */
	provider?: string
	/** True when the children's provider is not the parent's, so the card says the prompts leave for another vendor. */
	otherProvider?: boolean
	/** One sentence on what the profile cannot do, from the profile, so the card never overstates. */
	limits: string
	/** What the output of this kind of agent is and is not, from the definition (a reviewer: advice, not a review). */
	advisory?: string
	/** The task-level agent budget this launch draws on (plan 5.7, D6). */
	taskBudget?: SubagentTaskBudget
	/** The model's one line on what this will find and what it saves. Model-written, capped by the host. Untrusted. */
	purpose?: string
	/** The reason the model named. Host-checked to be one of the known signals. */
	signal?: SubagentSignal
	/** Facts the host computed itself, shown beside `purpose` so the user does not rest on the model's words alone. */
	facts?: SubagentLaunchFacts
	/** Where the definition came from and its hash. A file-defined agent is named here (stage 3); a built-in shows "built-in". */
	definition?: SubagentDefinitionRef
	/** True when the host built a study brief for the children (study id, gauge, period, plan id). Never model-written. */
	studyBrief?: boolean
}

/** What the launch card says about the definition behind the children. */
export interface SubagentDefinitionRef {
	id: string
	source: "builtin" | "global" | "workspace"
	sha256: string
	/** The file, for a global or workspace definition. Absent for a built-in. */
	path?: string
	/** The built-in it extends, for a file. */
	extends?: string
}

/** Host-computed facts for a launch card. */
export interface SubagentLaunchFacts {
	/** The parent's context use at the last request, as a percentage. Absent when it is not known. */
	contextUsedPercent?: number
	/** Spawn calls the user approved earlier in this task. */
	launchesSoFar: number
	/** Launches the user denied earlier in this task. */
	deniedSoFar: number
	/** Children started so far in this task, and the most the task may start (`maxAgentsPerTask`). */
	agentsSoFar: number
	maxAgents: number
	/** True when reads do not auto-approve, so every child read asks the user. */
	readsAsk: boolean
	/** `independent` was named with one prompt: nothing can run in parallel. */
	singlePromptIndependent?: boolean
}

/** What the launch card says about the task-level cap. */
export interface SubagentTaskBudget {
	/** `agentBudgetUsd`: the most all of this task's subagents may cost together. */
	budgetUsd: number
	/** Cost of earlier spawns in this task, as far as it is known. */
	spentUsd: number
	/** False when the model has no verified price: cost is unknown, so the dollar cap cannot fire. */
	priced: boolean
	/** Children of earlier spawns whose cost was unknown. `spentUsd` then undercounts. */
	unpricedChildren: number
}

/** Default `agentBudgetUsd`: dollars all subagents of one task may cost together (owner decision D6). A guess, not a measurement. */
export const DEFAULT_AGENT_BUDGET_USD = 5

/**
 * Default `maxAgentsPerTask`: children all of one task's spawn calls may start together. The count needs no price, so it
 * bounds a model whose cost is unknown, where `agentBudgetUsd` cannot fire. 12 is the orchestration report's value
 * (3 calls of 4); it is untested, and under the delegation policy it should almost never be reached.
 */
export const DEFAULT_MAX_AGENTS_PER_TASK = 12

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

/** The label of the nth child of a definition: its display name and the position in the call ("Explorer 2"). */
export function subagentLabel(displayName: string, ordinal: number): string {
	return `${displayName} ${ordinal}`
}

/** The first line of a child's prompt, whitespace-collapsed and capped, for the approval chip and the status row. */
export function promptHeadOf(prompt: string, max = 120): string {
	const first = (prompt.split(/\r?\n/).find((line) => line.trim()) ?? "").replace(/\s+/g, " ").trim()
	return first.length > max ? `${first.slice(0, max - 1)}…` : first
}
