import { createHash } from "node:crypto"
import type { ReportSchemaId, SubagentBudget, SubagentProfileId } from "@shared/aihydro/subagents"
import { AiHydroDefaultTool } from "@/shared/tools"

/**
 * An agent definition is data, so the in-process runner, a future headless team runner and the server-side role policy
 * can all consume one record (orchestration report 5.1). It lists what a child may do; it never grants. Everything in
 * it is serialisable: a policy is a named string, never a function, so a definition cannot widen itself by closure.
 *
 * Built-ins live in this file and nowhere else: the rest of the code asks the registry for a definition by id and reads
 * its fields. A user file (agentFiles.ts) can only narrow a built-in it extends.
 */
export type AgentSource = "builtin" | "global" | "workspace"

/** The MCP policy a definition names. Only READ class on a trusted server exists; a wider one needs its own owner decision. */
export type AgentMcpPolicy = "read"

export interface AgentDefinition {
	id: SubagentProfileId
	/** Singular display name. A child is labelled with it and its position in the call ("Explorer 2"). */
	displayName: string
	/** The built-in a file narrows. Absent for a built-in. */
	extends?: SubagentProfileId
	source: AgentSource
	/** sha256 of the definition: of the file's bytes for a file, of the canonical built-in record otherwise. */
	sha256: string
	/** The file, for a global or workspace definition. */
	path?: string
	description: string
	/** The opening paragraph of the child's system prompt: who it is and what it is for. */
	role: string
	/** Prompt text a file added after the role. It is text, so it can ask for less, and cannot grant a tool. */
	body?: string
	/** Built-in tools the child may call. An ALLOWLIST: a tool not listed is neither registered nor callable. */
	builtinAllow: readonly AiHydroDefaultTool[]
	/**
	 * MCP calls are allowed only by this named policy (agentPolicy.ts). The policy is a name, not a function, so a
	 * definition stays serialisable and cannot widen itself by closure.
	 */
	mcpPolicy: AgentMcpPolicy
	/** The shape of the report the child ends with. The host picks the exit tool from it and validates the result. */
	reportSchema: ReportSchemaId
	/** What a child may auto-approve at most: its own reads, never a write, a command or a non-READ MCP call. */
	autoApproveCeiling: "read"
	/**
	 * Which model the child runs: the parent's ("inherit"), or the one the user set for this definition in the
	 * `agentModels` setting ("setting"). A file may name a model id on the parent's provider (`modelId`), never a provider.
	 */
	model: "inherit" | "setting"
	/** A model id a file set, on the parent's provider. */
	modelId?: string
	/**
	 * Whether the user may point this definition at a provider other than the parent's (owner decision D7). Opt-in twice:
	 * the definition must allow it, and the user must set a provider for it. Then the prompts go to a second vendor.
	 */
	crossProvider: boolean
	/** One sentence on what the child cannot do, so the launch card never overstates. */
	limits: string
	/** What its output is and is not, when that needs saying on the launch card. Absent for a plain explorer. */
	advisory?: string
	budget: SubagentBudget
	/** Always false: a child cannot spawn. Kept as data so a test can assert no definition ever turns it on. */
	canSpawn: false
}

/** The exit tool for a report schema. */
export function reportToolFor(schema: ReportSchemaId): AiHydroDefaultTool.REPORT_FINDINGS | AiHydroDefaultTool.REPORT_REVIEW {
	return schema === "review" ? AiHydroDefaultTool.REPORT_REVIEW : AiHydroDefaultTool.REPORT_FINDINGS
}

/** Stable JSON: keys sorted, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
	}
	return JSON.stringify(value) ?? "null"
}

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}

/**
 * Read-only built-ins (plan 5.5). Absent on purpose: web_fetch (an open-world egress channel for a read-only agent),
 * ask_followup_question (a free-text question to the user outside the approval model), attempt_completion (it would
 * raise the parent's completion ask and run its answer-audit gate), plan_mode_respond, condense, summarize_task and
 * focus_chain (they act on task-level state), and every write, command, browser and preview tool.
 */
const READ_ONLY_BUILTINS: readonly AiHydroDefaultTool[] = [
	AiHydroDefaultTool.FILE_READ,
	AiHydroDefaultTool.SEARCH,
	AiHydroDefaultTool.LIST_FILES,
	AiHydroDefaultTool.MCP_DOCS,
	AiHydroDefaultTool.MCP_USE, // READ class on a trusted server only (agentMcpBlockReason)
	AiHydroDefaultTool.MCP_ACCESS, // a resource on a trusted server only (agentResourceBlockReason)
]

const READ_ONLY_LIMITS =
	"No file writes, no commands, no network or browser tools, no questions to you, and no claims. It reads this workspace and calls read-only tools on the trusted AI-Hydro server."

const DEFAULT_BUDGET: SubagentBudget = {
	maxToolCalls: 30,
	wallClockMs: 10 * 60 * 1000,
	maxOutputTokens: 40_000,
	contextStopFraction: 0.8,
	maxCostUsd: 2,
}

function builtin(definition: Omit<AgentDefinition, "source" | "sha256">): AgentDefinition {
	const record = { ...definition, source: "builtin" as const }
	return Object.freeze({ ...record, sha256: sha256Hex(canonicalJson(record)) })
}

export const EXPLORER_DEFINITION: AgentDefinition = builtin({
	id: "explorer",
	displayName: "Explorer",
	description: "Reads the workspace and calls read-only tools to find where to look. Reports what it saw.",
	role: "You are a read-only research subagent of AI-Hydro. Another agent (the parent) gave you one focused question. You read the workspace and call read-only tools, then report what you found. You cannot change anything.",
	builtinAllow: READ_ONLY_BUILTINS,
	mcpPolicy: "read",
	reportSchema: "findings",
	autoApproveCeiling: "read",
	model: "inherit",
	crossProvider: false,
	limits: READ_ONLY_LIMITS,
	budget: DEFAULT_BUDGET,
	canSpawn: false,
})

/**
 * A second, clean-context read of an answer against the evidence it cites. It has the explorer's tools, which already
 * include the READ-class `audit_interpretation` and `run_skeptic`, so it gains no authority. Its output is advisory text
 * from another model run: it does not enter promotion, is not evidence, and the UI never calls it "reviewed".
 */
export const REVIEWER_DEFINITION: AgentDefinition = builtin({
	id: "reviewer",
	displayName: "Reviewer",
	description:
		"Checks statements against the evidence behind them, in a clean context. Reports supported, unsupported or unverifiable for each. Advice only.",
	role: "You are a read-only reviewer subagent of AI-Hydro. Another agent (the parent) gave you statements to check against the evidence behind them. You have none of the parent's reasoning: only what the prompt states and what you can read. For each statement, decide whether what you read supports it, contradicts it or cannot settle it. You cannot change anything. You do not approve, reject or promote a claim: what you return is advice that the parent and the user may weigh, written by a second model run.",
	builtinAllow: READ_ONLY_BUILTINS,
	mcpPolicy: "read",
	reportSchema: "review",
	autoApproveCeiling: "read",
	model: "setting",
	crossProvider: true,
	limits: READ_ONLY_LIMITS,
	advisory:
		"Its verdicts are advice from a second model run, not a review by a person. They do not approve, reject or promote any claim.",
	budget: DEFAULT_BUDGET,
	canSpawn: false,
})

/** The definition used when a call names none. */
export const DEFAULT_AGENT_ID: SubagentProfileId = EXPLORER_DEFINITION.id

export const BUILTIN_DEFINITIONS: ReadonlyMap<SubagentProfileId, AgentDefinition> = new Map([
	[EXPLORER_DEFINITION.id, EXPLORER_DEFINITION],
	[REVIEWER_DEFINITION.id, REVIEWER_DEFINITION],
])

/**
 * Resolve a definition id a model supplied. Anything but a known id is undefined (never a default). `extra` holds file
 * definitions the loader accepted; a file can never shadow a built-in id (the loader refuses it), and a built-in is
 * looked up first anyway.
 */
export function resolveDefinition(
	id: unknown,
	extra?: ReadonlyMap<SubagentProfileId, AgentDefinition>,
): AgentDefinition | undefined {
	if (typeof id !== "string") {
		return undefined
	}
	return BUILTIN_DEFINITIONS.get(id) ?? extra?.get(id)
}

/** What the parent could do right now. A child is the intersection of this and its definition, never the union. */
export interface ParentCapabilities {
	/** Whether the parent's own executor can call this built-in tool at the moment. */
	canCall: (tool: AiHydroDefaultTool) => boolean
	workspaceTrusted: boolean
	/** The parent is itself a child (it must not spawn). */
	parentIsChild: boolean
}

export interface EffectiveCapabilities {
	profileId: SubagentProfileId
	/** The definition the capabilities were cut from: the prompt builder reads its role, body and report schema. */
	definition: AgentDefinition
	builtinAllow: readonly AiHydroDefaultTool[]
	reportTool: ReturnType<typeof reportToolFor>
	reportSchema: ReportSchemaId
	/** READ-class MCP is reachable only if the parent can call use_mcp_tool at all. */
	mcpEnabled: boolean
	/** "none" in an untrusted workspace: every call asks. Otherwise the definition's ceiling. */
	autoApproveCeiling: "none" | "read"
	canSpawn: false
	budget: SubagentBudget
}

/**
 * S1: a tool is available to the child only if the definition allows it AND the parent could call it now. A parent in
 * strict plan mode, an untrusted workspace or a restricted registry yields a child with no more than that.
 * Returns undefined when nothing may be spawned (a child never spawns a child).
 */
export function capFor(parent: ParentCapabilities, definition: AgentDefinition): EffectiveCapabilities | undefined {
	if (parent.parentIsChild) {
		return undefined
	}
	const builtinAllow = definition.builtinAllow.filter((tool) => parent.canCall(tool))
	return {
		profileId: definition.id,
		definition,
		builtinAllow,
		reportTool: reportToolFor(definition.reportSchema),
		reportSchema: definition.reportSchema,
		mcpEnabled: builtinAllow.includes(AiHydroDefaultTool.MCP_USE),
		autoApproveCeiling: parent.workspaceTrusted ? definition.autoApproveCeiling : "none",
		canSpawn: false,
		budget: definition.budget,
	}
}
