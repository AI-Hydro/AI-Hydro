import type { SubagentBudget, SubagentProfileId } from "@shared/aihydro/subagents"
import { AiHydroDefaultTool } from "@/shared/tools"

/**
 * A subagent profile is data, so the in-process runner, a future headless team runner and the server-side role policy
 * can all consume one definition (plan section 4, "shaped for (3)"). It lists what a child may do; it never grants.
 *
 * `explorer` is the only profile. A `general` or `data-runner` profile (PR-4) needs its own owner decision (H3).
 */
export interface AgentProfile {
	id: SubagentProfileId
	/** Built-in tools the child may call. An ALLOWLIST: a tool not listed is neither registered nor callable. */
	builtinAllow: readonly AiHydroDefaultTool[]
	/** The tool the child ends with. Handled by the host; it writes nothing and raises no ask on the parent. */
	reportTool: "report_findings"
	/**
	 * MCP calls are allowed only for READ-class tools on a trusted server (explorerMcpBlockReason). The predicate is
	 * named, not a function, so a profile stays serialisable and cannot widen itself by closure.
	 */
	mcpPredicate: "read_class_on_trusted_server"
	/** What a child may auto-approve at most: its own reads, never a write, a command or a non-READ MCP call. */
	autoApproveCeiling: "read"
	budget: SubagentBudget
	/** Always false: a child cannot spawn. Kept as data so a test can assert no profile ever turns it on. */
	canSpawn: false
}

/**
 * Child v1 allowlist (plan 5.5). Absent on purpose: web_fetch (an open-world egress channel for a read-only agent),
 * ask_followup_question (a free-text question to the user outside the approval model), attempt_completion (it would
 * raise the parent's completion ask and run its answer-audit gate), plan_mode_respond, condense, summarize_task and
 * focus_chain (they act on task-level state), and every write, command, browser and preview tool.
 */
const EXPLORER_BUILTINS: readonly AiHydroDefaultTool[] = [
	AiHydroDefaultTool.FILE_READ,
	AiHydroDefaultTool.SEARCH,
	AiHydroDefaultTool.LIST_FILES,
	AiHydroDefaultTool.MCP_DOCS,
	AiHydroDefaultTool.MCP_USE, // READ class on a trusted server only (explorerMcpBlockReason)
	AiHydroDefaultTool.MCP_ACCESS, // a resource on a trusted server only (explorerResourceBlockReason)
]

export const EXPLORER_PROFILE: AgentProfile = {
	id: "explorer",
	builtinAllow: EXPLORER_BUILTINS,
	reportTool: "report_findings",
	mcpPredicate: "read_class_on_trusted_server",
	autoApproveCeiling: "read",
	budget: {
		maxToolCalls: 30,
		wallClockMs: 10 * 60 * 1000,
		maxOutputTokens: 40_000,
		contextStopFraction: 0.8,
		maxCostUsd: 2,
	},
	canSpawn: false,
}

const PROFILES: Readonly<Record<SubagentProfileId, AgentProfile>> = { explorer: EXPLORER_PROFILE }

/** Resolve a profile id a model supplied. Anything but a known id is undefined (never a default). */
export function resolveProfile(id: unknown): AgentProfile | undefined {
	return typeof id === "string" && Object.hasOwn(PROFILES, id) ? PROFILES[id as SubagentProfileId] : undefined
}

/** What the parent could do right now. A child is the intersection of this and its profile, never the union. */
export interface ParentCapabilities {
	/** Whether the parent's own executor can call this built-in tool at the moment. */
	canCall: (tool: AiHydroDefaultTool) => boolean
	workspaceTrusted: boolean
	/** The parent is itself a child (it must not spawn). */
	parentIsChild: boolean
}

export interface EffectiveCapabilities {
	profileId: SubagentProfileId
	builtinAllow: readonly AiHydroDefaultTool[]
	reportTool: AgentProfile["reportTool"]
	/** READ-class MCP is reachable only if the parent can call use_mcp_tool at all. */
	mcpEnabled: boolean
	/** "none" in an untrusted workspace: every call asks. Otherwise the profile's ceiling. */
	autoApproveCeiling: "none" | "read"
	canSpawn: false
	budget: SubagentBudget
}

/**
 * S1: a tool is available to the child only if the profile allows it AND the parent could call it now. A parent in
 * strict plan mode, an untrusted workspace or a restricted registry yields a child with no more than that.
 * Returns undefined when nothing may be spawned (a child never spawns a child).
 */
export function capFor(parent: ParentCapabilities, profile: AgentProfile): EffectiveCapabilities | undefined {
	if (parent.parentIsChild) {
		return undefined
	}
	const builtinAllow = profile.builtinAllow.filter((tool) => parent.canCall(tool))
	return {
		profileId: profile.id,
		builtinAllow,
		reportTool: profile.reportTool,
		mcpEnabled: builtinAllow.includes(AiHydroDefaultTool.MCP_USE),
		autoApproveCeiling: parent.workspaceTrusted ? profile.autoApproveCeiling : "none",
		canSpawn: false,
		budget: profile.budget,
	}
}
