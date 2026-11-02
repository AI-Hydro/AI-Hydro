import { type ApiHandler, buildApiHandler } from "@core/api"
import type { ToolUse } from "@core/assistant-message"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import {
	DEFAULT_AGENT_BUDGET_USD,
	DEFAULT_MAX_AGENTS_PER_TASK,
	MAX_PURPOSE_CHARS,
	SUBAGENT_SIGNALS,
	type SubagentChildSummary,
	type SubagentLaunch,
	type SubagentLaunchFacts,
	type SubagentSignal,
	type SubagentStatusPayload,
} from "@shared/aihydro/subagents"
import type { AiHydroSayTool } from "@shared/ExtensionMessage"
import { telemetryService } from "@/services/telemetry"
import { convertAiHydroMessageToProto } from "@/shared/proto-conversions/aihydro-message"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { type AgentDefinition, BUILTIN_DEFINITIONS, DEFAULT_AGENT_ID, resolveDefinition } from "../../subagents/agentDefinition"
import { type ChildApiResolution, resolveChildApi } from "../../subagents/agentModel"
import { launchesPaused, recordLaunchDenial } from "../../subagents/launchBrake"
import { ParentAskBridge } from "../../subagents/ParentAskBridge"
import { DEFAULT_STAGGER_MS, MAX_PROMPTS_PER_CALL, SpawnRefused, SubagentSupervisor } from "../../subagents/SubagentSupervisor"
import { isModelPriced } from "../../subagents/subagentCost"
import { diskRecordWriter } from "../../subagents/subagentRecord"
import { formatReportsForParent } from "../../subagents/subagentReports"
import { agentCountRefusal, resolveAgentBudgetUsd, resolveMaxAgentsPerTask, TaskAgentLedger } from "../../subagents/taskLedger"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import { isWorkspaceTrusted } from "../../workspaceTrust"
import { AutoApprove } from "../autoApprove"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

/** How often a status row is rewritten while children run (plan 5.2: at most 4 a second). */
export const STATUS_UPDATE_INTERVAL_MS = 250

/** Longest prompt accepted per explorer. A longer one is refused, not cut: a cut prompt asks a different question. */
export const MAX_PROMPT_CHARS = 4_000

/**
 * Prompts from the tool call: a JSON array of strings (what the spec asks for), or a single string, or one prompt
 * per non-empty line, because weaker models drift from the JSON form. Anything else is an error the model is told.
 */
export function parsePrompts(raw: string | undefined): { ok: true; prompts: string[] } | { ok: false; error: string } {
	const text = (raw ?? "").trim()
	if (!text) {
		return { ok: false, error: "spawn_subagents needs a prompts parameter: a JSON array of 1 to 4 strings." }
	}
	let prompts: string[]
	if (text.startsWith("[")) {
		try {
			const value = JSON.parse(text)
			if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
				return { ok: false, error: "prompts must be a JSON array of strings." }
			}
			prompts = value
		} catch {
			return { ok: false, error: "prompts is not valid JSON. Pass a JSON array of strings." }
		}
	} else {
		prompts = text.startsWith('"') ? [safeJsonString(text)] : text.split(/\r?\n/).filter((line) => line.trim())
	}
	prompts = prompts.map((prompt) => prompt.trim())
	if (prompts.length === 0 || prompts.some((prompt) => !prompt)) {
		return { ok: false, error: "prompts must hold 1 to 4 non-empty strings." }
	}
	if (prompts.length > MAX_PROMPTS_PER_CALL) {
		return {
			ok: false,
			error: `At most ${MAX_PROMPTS_PER_CALL} prompts per call; got ${prompts.length}. Merge them or call again later.`,
		}
	}
	const tooLong = prompts.findIndex((prompt) => prompt.length > MAX_PROMPT_CHARS)
	if (tooLong >= 0) {
		return {
			ok: false,
			error: `Prompt ${tooLong + 1} is longer than ${MAX_PROMPT_CHARS} characters. Shorten it; an explorer needs a question, not a document.`,
		}
	}
	return { ok: true, prompts }
}

function safeJsonString(text: string): string {
	try {
		const value = JSON.parse(text)
		return typeof value === "string" ? value : text
	} catch {
		return text
	}
}

/** `subagentStaggerMs` from settings: a finite number of milliseconds, 0 or more; anything else is the default. */
export function resolveStaggerMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_STAGGER_MS
}

/** What the definition cannot do, in one sentence, from the definition (the launch card must not overstate or understate it). */
export function profileLimits(definition: AgentDefinition): string {
	return definition.limits
}

/** The model's one line for the launch card: one line of plain text, capped. Undefined when it wrote nothing. */
export function cleanPurpose(raw: string | undefined): string | undefined {
	const oneLine = (raw ?? "").replace(/\s+/g, " ").trim()
	if (!oneLine) {
		return undefined
	}
	return oneLine.length > MAX_PURPOSE_CHARS ? `${oneLine.slice(0, MAX_PURPOSE_CHARS - 1)}…` : oneLine
}

/** The signal the model named, if it is one of the known words. A wrong word is dropped, not refused: it must not cost a turn. */
export function cleanSignal(raw: string | undefined): SubagentSignal | undefined {
	const word = (raw ?? "").trim().toLowerCase()
	return SUBAGENT_SIGNALS.find((known) => known === word)
}

/** The parent's context use at its last request, as a whole percentage; undefined when the window or the usage is not known. */
export function contextUsedPercent(
	rows: ReadonlyArray<{ say?: string; text?: string }>,
	contextWindow: number | undefined,
): number | undefined {
	if (!contextWindow) {
		return undefined
	}
	for (let i = rows.length - 1; i >= 0; i--) {
		if (rows[i].say !== "api_req_started" || !rows[i].text) {
			continue
		}
		try {
			const { tokensIn, tokensOut, cacheWrites, cacheReads } = JSON.parse(rows[i].text as string)
			const total = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
			if (total > 0) {
				return Math.round((total / contextWindow) * 100)
			}
		} catch {
			// a malformed row says nothing
		}
	}
	return undefined
}

/** Calls `fn` at most once per `intervalMs` (trailing edge), and `flush` runs any pending call now. */
export function createCoalescer(fn: () => Promise<void>, intervalMs: number) {
	let timer: ReturnType<typeof setTimeout> | undefined
	let running: Promise<void> = Promise.resolve()
	const run = () => {
		timer = undefined
		running = running.then(fn).catch((error) => console.error("Subagent status update failed:", error))
		return running
	}
	return {
		schedule() {
			if (!timer) {
				timer = setTimeout(run, intervalMs)
			}
		},
		async flush() {
			if (timer) {
				clearTimeout(timer)
			}
			await run()
		},
	}
}

/**
 * `spawn_subagents`: start read-only explorers. Registered only on a top-level executor and only while the setting is
 * on (ToolExecutor.syncSubagentHandler); a child can never reach it. It ALWAYS asks first (H2): the launch is never
 * auto-approved, not by auto-approve settings and not by YOLO, because children cost money and the user should see
 * what each will be asked.
 */
export class SpawnSubagentsToolHandler implements IFullyManagedTool {
	readonly name = AiHydroDefaultTool.SPAWN_SUBAGENTS

	/**
	 * `buildApi` is a test seam; production builds each child's handler from the user's current API configuration, or
	 * from the configuration a definition's model setting resolved to.
	 */
	constructor(
		private readonly options: { buildApi?: (config: TaskConfig, resolved?: ChildApiResolution) => ApiHandler } = {},
	) {}

	getDescription(_block: ToolUse): string {
		return `[${this.name}]`
	}

	async handlePartialBlock(_block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Nothing streams for this tool: the card appears once the call is complete.
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const stateManager = config.services.stateManager
		// Fail closed even if the registry was stale: the setting is read at call time.
		if (stateManager.getGlobalSettingsKey("subagentsEnabled") !== true) {
			return formatResponse.toolError("Subagents are turned off. Do the work yourself with your own tools.")
		}
		// Two bare denials in a row end proposals until the user writes again. No card is raised, so a model that was
		// told to stop cannot make the user answer the same question a third time.
		if (launchesPaused(config.taskState)) {
			return formatResponse.subagentLaunchesPaused()
		}
		const definition = resolveDefinition(block.params.profile?.trim() || DEFAULT_AGENT_ID)
		if (!definition) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`Unknown profile. Known profiles: ${[...BUILTIN_DEFINITIONS.keys()].join(", ")}. Leave profile out for ${DEFAULT_AGENT_ID}.`,
			)
		}
		const parsed = parsePrompts(block.params.prompts)
		if (!parsed.ok) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(parsed.error)
		}
		config.taskState.consecutiveMistakeCount = 0

		// The task-level cap (D6): all of this task's subagents together. Read from the transcript, so it holds across
		// calls and across a resume. At the cap no further spawn starts, and the model is told so.
		const ledger = TaskAgentLedger.fromMessages(
			config.messageState.getAiHydroMessages(),
			resolveAgentBudgetUsd(stateManager.getGlobalSettingsKey("agentBudgetUsd"), DEFAULT_AGENT_BUDGET_USD),
			resolveMaxAgentsPerTask(stateManager.getGlobalSettingsKey("maxAgentsPerTask"), DEFAULT_MAX_AGENTS_PER_TASK),
		)
		if (ledger.exceeded()) {
			return formatResponse.toolError(ledger.refusal())
		}
		// The count needs no price, so unlike the dollar cap it holds for a model whose cost is unknown.
		if (!ledger.allowsAgents(parsed.prompts.length)) {
			return formatResponse.toolError(agentCountRefusal(ledger, parsed.prompts.length))
		}

		// Which model the children run. An id or provider that cannot be applied is an error, never a silent fallback to
		// the parent's model: a reviewer that quietly ran on the author's model would look independent and not be.
		const mode = stateManager.getGlobalSettingsKey("mode")
		const resolved = resolveChildApi(
			() => stateManager.getApiConfiguration(),
			mode,
			definition,
			stateManager.getGlobalSettingsKey("agentModels"),
		)
		if (!resolved.ok) {
			return formatResponse.toolError(resolved.error)
		}
		const buildChildApi = (): ApiHandler =>
			this.options.buildApi?.(config, resolved) ??
			buildApiHandler({ ...(resolved.config ?? stateManager.getApiConfiguration()), ulid: config.ulid }, resolved.mode)
		let childModel: { id: string; info: ReturnType<ApiHandler["getModel"]>["info"] }
		try {
			childModel = resolved.overridden ? buildChildApi().getModel() : config.api.getModel()
		} catch (error) {
			return formatResponse.toolError(
				`The model set for '${definition.id}' could not be built: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		const purpose = cleanPurpose(block.params.purpose)
		const signal = cleanSignal(block.params.signal)
		const studyBrief = config.taskState.projectContextBrief || undefined

		const bridge = new ParentAskBridge(config.callbacks.ask, () => config.taskState.abort)
		const children: { current: SubagentChildSummary[] } = { current: [] }
		let statusTs: number | undefined
		const publish = async (final: boolean) => {
			if (statusTs === undefined) {
				return
			}
			const messages = config.messageState.getAiHydroMessages()
			const index = messages.findIndex((m) => m.ts === statusTs)
			if (index < 0) {
				return
			}
			const payload: SubagentStatusPayload = { profile: definition.id, children: children.current, done: final }
			messages[index].text = JSON.stringify(payload)
			if (final) {
				await config.messageState.updateAiHydroMessage(index, { text: messages[index].text })
			}
			await sendPartialMessageEvent(convertAiHydroMessageToProto(messages[index]))
		}
		const coalescer = createCoalescer(() => publish(false), STATUS_UPDATE_INTERVAL_MS)

		let supervisor: SubagentSupervisor
		try {
			supervisor = new SubagentSupervisor({
				definition,
				parent: {
					canCall: (tool) => config.coordinator.has(tool),
					workspaceTrusted: isWorkspaceTrusted(),
					parentIsChild: false,
				},
				runnerBase: {
					context: config.context,
					services: config.services,
					stateManager,
					cwd: config.cwd,
					taskId: config.taskId,
					ulid: config.ulid,
					workspaceManager: config.workspaceManager,
					isMultiRootEnabled: !!config.isMultiRootEnabled,
					aihydroIgnoreController: config.services.aihydroIgnoreController,
					bridge,
					isParentAborted: () => config.taskState.abort,
					ledger,
					...(studyBrief ? { studyBrief } : {}),
					...(resolved.providerId ? { provider: resolved.providerId } : {}),
					...(purpose ? { purpose } : {}),
					...(signal ? { signal } : {}),
					writeRecord: diskRecordWriter(() => ensureTaskDirectoryExists(config.taskId)),
				},
				buildApi: buildChildApi,
				staggerMs: resolveStaggerMs(stateManager.getGlobalSettingsKey("subagentStaggerMs")),
				onUpdate: (next) => {
					children.current = next
					coalescer.schedule()
				},
			})
		} catch (error) {
			if (error instanceof SpawnRefused) {
				return formatResponse.toolError(error.message)
			}
			throw error
		}

		// The launch ask: always asked, never auto-approved (H2). It shows exactly what will run.
		const readsAutoRun = new AutoApprove(stateManager, isWorkspaceTrusted() ? "read" : "none").shouldAutoApproveTool(
			AiHydroDefaultTool.FILE_READ,
		)
		const contextPercent = contextUsedPercent(
			config.messageState.getAiHydroMessages(),
			config.api.getModel().info.contextWindow,
		)
		const facts: SubagentLaunchFacts = {
			...(contextPercent !== undefined ? { contextUsedPercent: contextPercent } : {}),
			launchesSoFar: ledger.launchesApproved,
			deniedSoFar: config.taskState.launchDenials ?? 0,
			agentsSoFar: ledger.agentsStarted,
			maxAgents: ledger.maxAgents,
			readsAsk: !(Array.isArray(readsAutoRun) ? readsAutoRun[0] : readsAutoRun),
			...(signal === "independent" && parsed.prompts.length === 1 ? { singlePromptIndependent: true } : {}),
		}
		const launch: SubagentLaunch = {
			profile: definition.id,
			label: definition.displayName,
			prompts: parsed.prompts,
			budget: supervisor.caps.budget,
			model: childModel.id,
			...(resolved.providerId ? { provider: resolved.providerId } : {}),
			...(resolved.otherProvider ? { otherProvider: true } : {}),
			limits: profileLimits(definition),
			...(definition.advisory ? { advisory: definition.advisory } : {}),
			taskBudget: ledger.describe(isModelPriced(childModel.info)),
			...(purpose ? { purpose } : {}),
			...(signal ? { signal } : {}),
			facts,
			definition: {
				id: definition.id,
				source: definition.source,
				sha256: definition.sha256,
				...(definition.path ? { path: definition.path } : {}),
				...(definition.extends ? { extends: definition.extends } : {}),
			},
			...(studyBrief ? { studyBrief: true } : {}),
		}
		const completeMessage = JSON.stringify({ tool: "spawnSubagents", subagents: launch } satisfies AiHydroSayTool)
		showNotificationForApprovalIfAutoApprovalEnabled(
			`AI-Hydro wants to start ${parsed.prompts.length} read-only ${definition.displayName.toLowerCase()}${parsed.prompts.length === 1 ? "" : "s"}`,
			config.autoApprovalSettings.enabled,
			config.autoApprovalSettings.enableNotifications,
		)
		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
		const decision = await ToolResultUtils.askApprovalDetailed("tool", completeMessage, config)
		if (!decision.approved) {
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
			recordLaunchDenial(config.taskState, decision.hadFeedback)
			// A denial with words is the user speaking to the lead: the brake does not count it, and the words reach the lead.
			return decision.hadFeedback ? formatResponse.toolDenied() : formatResponse.subagentLaunchDenied()
		}
		telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)

		// One row for the whole call, rewritten in place. Added once with `say` (before any child ask exists), and
		// afterwards only mutated: a `say` per update would move lastMessageTs and supersede a pending child ask.
		const initial: SubagentStatusPayload = { profile: definition.id, children: [], done: false }
		statusTs = await config.callbacks.say("subagent_status", JSON.stringify(initial))

		try {
			const results = await supervisor.run(parsed.prompts)
			children.current = supervisor.children
			await coalescer.flush()
			await publish(true)
			return formatReportsForParent(results)
		} catch (error) {
			supervisor.cancelAll()
			children.current = supervisor.children
			await publish(true).catch(() => {})
			if (error instanceof SpawnRefused) {
				return formatResponse.toolError(error.message)
			}
			throw error
		}
	}
}
