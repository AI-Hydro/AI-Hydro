import { type ApiHandler, buildApiHandler } from "@core/api"
import type { ToolUse } from "@core/assistant-message"
import { sendPartialMessageEvent } from "@core/controller/ui/subscribeToPartialMessage"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import type { SubagentChildSummary, SubagentLaunch, SubagentStatusPayload } from "@shared/aihydro/subagents"
import type { AiHydroSayTool } from "@shared/ExtensionMessage"
import { telemetryService } from "@/services/telemetry"
import { convertAiHydroMessageToProto } from "@/shared/proto-conversions/aihydro-message"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { type AgentProfile, resolveProfile } from "../../subagents/agentProfile"
import { ParentAskBridge } from "../../subagents/ParentAskBridge"
import { MAX_PROMPTS_PER_CALL, SpawnRefused, SubagentSupervisor } from "../../subagents/SubagentSupervisor"
import { diskRecordWriter } from "../../subagents/subagentRecord"
import { formatReportsForParent } from "../../subagents/subagentReports"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import { isWorkspaceTrusted } from "../../workspaceTrust"
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

/** What the profile cannot do, in one sentence, from the profile (the launch card must not overstate or understate it). */
export function profileLimits(profile: AgentProfile): string {
	return profile.id === "explorer"
		? "No file writes, no commands, no network or browser tools, no questions to you, and no claims. It reads this workspace and calls read-only tools on the trusted AI-Hydro server."
		: ""
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

	/** `buildApi` is a test seam; production builds each child's handler from the user's current API configuration. */
	constructor(private readonly options: { buildApi?: (config: TaskConfig) => ApiHandler } = {}) {}

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
		const profile = resolveProfile(block.params.profile?.trim() || "explorer")
		if (!profile) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError('Unknown profile. The only profile is "explorer"; leave profile out.')
		}
		const parsed = parsePrompts(block.params.prompts)
		if (!parsed.ok) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(parsed.error)
		}
		config.taskState.consecutiveMistakeCount = 0

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
			const payload: SubagentStatusPayload = { profile: profile.id, children: children.current, done: final }
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
				profile,
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
					writeRecord: diskRecordWriter(() => ensureTaskDirectoryExists(config.taskId)),
				},
				buildApi: () =>
					this.options.buildApi?.(config) ??
					buildApiHandler(
						{ ...stateManager.getApiConfiguration(), ulid: config.ulid },
						stateManager.getGlobalSettingsKey("mode"),
					),
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
		const launch: SubagentLaunch = {
			profile: profile.id,
			prompts: parsed.prompts,
			budget: supervisor.caps.budget,
			model: config.api.getModel().id,
			limits: profileLimits(profile),
		}
		const completeMessage = JSON.stringify({ tool: "spawnSubagents", subagents: launch } satisfies AiHydroSayTool)
		showNotificationForApprovalIfAutoApprovalEnabled(
			`AI-Hydro wants to start ${parsed.prompts.length} read-only explorer${parsed.prompts.length === 1 ? "" : "s"}`,
			config.autoApprovalSettings.enabled,
			config.autoApprovalSettings.enableNotifications,
		)
		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
		if (!(await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config))) {
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
			return formatResponse.toolDenied()
		}
		telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)

		// One row for the whole call, rewritten in place. Added once with `say` (before any child ask exists), and
		// afterwards only mutated: a `say` per update would move lastMessageTs and supersede a pending child ask.
		const initial: SubagentStatusPayload = { profile: profile.id, children: [], done: false }
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
