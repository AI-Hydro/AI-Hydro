import type { Anthropic } from "@anthropic-ai/sdk"
import type { ApiHandler } from "@core/api"
import { parseAssistantMessageV2, type ToolUse } from "@core/assistant-message"
import { type NativeToolCallContext, repairNativeToolCallsForModel } from "@core/assistant-message/nativeToolCallRepair"
import { ContextManager } from "@core/context/context-management/ContextManager"
import type { AiHydroIgnoreController } from "@core/ignore/AiHydroIgnoreController"
import { formatResponse } from "@core/prompts/responses"
import { isServerTrusted } from "@shared/aihydro/firstPartyServers"
import {
	isFinalSubagentStatus,
	promptHeadOf,
	type SubagentBudgetStop,
	type SubagentChildSummary,
	type SubagentOrigin,
	type SubagentProfileId,
	type SubagentReport,
	type SubagentStatus,
	type SubagentToolCallRecord,
	type SubagentUsage,
} from "@shared/aihydro/subagents"
import type { AiHydroAsk, AiHydroSay } from "@shared/ExtensionMessage"
import { AiHydroDefaultTool } from "@shared/tools"
import type * as vscode from "vscode"
import type { WorkspaceRootManager } from "@/core/workspace"
import type { StateManager } from "../../storage/StateManager"
import { ToolExecutor } from "../ToolExecutor"
import type { TaskServices } from "../tools/types/TaskConfig"
import type { EffectiveCapabilities } from "./agentProfile"
import { ChildMessageState, newChildTaskState, nullFileContextTracker } from "./childRuntime"
import type { ParentAskBridge } from "./ParentAskBridge"
import { buildSubagentSystemPrompt, subagentTaskMessage } from "./subagentPrompt"
import { allowlistSha256, type SubagentRecord, type SubagentRecordWriter, sha256 } from "./subagentRecord"

/** Largest single tool-result text a child keeps. The cut is stated in the text, never silent. */
const MAX_RESULT_CHARS = 40_000
/** A model that answers without a tool this many times in a row is stopped (partial). */
const MAX_TOOL_LESS_TURNS = 3
/** Refused or denied calls in a row before the child is marked blocked. */
const MAX_BLOCKED_IN_A_ROW = 3
/** Handlers' own failures in a row (bad arguments, missing files) before the child gives up as partial. */
const MAX_ERRORS_IN_A_ROW = 6

export interface SubagentRunnerInit {
	childId: string
	/** Position among this call's children, from 1; the label is derived from it. */
	ordinal: number
	label: string
	profile: SubagentProfileId
	caps: EffectiveCapabilities
	prompt: string
	// The parent's world, passed explicitly so a child cannot reach anything it was not handed.
	context: vscode.ExtensionContext
	services: TaskServices
	stateManager: StateManager
	cwd: string
	taskId: string
	ulid: string
	workspaceManager?: WorkspaceRootManager
	isMultiRootEnabled: boolean
	aihydroIgnoreController: AiHydroIgnoreController
	/** A handler built for this child alone, so its stream can be dropped without touching the parent's. */
	api: ApiHandler
	bridge: ParentAskBridge
	/** The parent's abort flag. Polled; a child stops within one poll interval of it turning true. */
	isParentAborted: () => boolean
	writeRecord: SubagentRecordWriter
	onUpdate?: (summary: SubagentChildSummary) => void
	/** Clock and poll interval are injectable so the abort and budget paths are testable without waiting. */
	now?: () => number
	pollMs?: number
}

export interface SubagentResult {
	childId: string
	label: string
	status: SubagentStatus
	report?: SubagentReport
	/** Last assistant text, present when a budget or an error ended the child without a report. */
	lastAssistantText?: string
	budgetStop?: SubagentBudgetStop
	usage: SubagentUsage
	recordPath?: string
	error?: string
}

class Interrupt extends Error {
	constructor(readonly kind: "cancelled" | "wall_clock") {
		super(kind)
	}
}

function emptyUsage(): SubagentUsage {
	return { toolCalls: 0, turns: 0, tokensIn: 0, tokensOut: 0, cacheWrites: 0, cacheReads: 0 }
}

/** Cut one text block to a cap, saying so in the text. */
function capText(text: string): string {
	return text.length > MAX_RESULT_CHARS
		? `${text.slice(0, MAX_RESULT_CHARS)}\n[Result cut by the host at ${MAX_RESULT_CHARS} characters. Read a narrower range or search for what you need.]`
		: text
}

/**
 * Runs one subagent: a headless model loop with its own conversation, state and API handler, executing tools through a
 * profile-scoped ToolExecutor (plan 5.1). It reaches the parent only through the ParentAskBridge, and it ends on
 * report_findings, a budget, an error or a cancel. It never throws: every ending is a SubagentResult and a record.
 *
 * What it deliberately does not do: touch the parent's TaskState, message list or history; call the parent's `say`
 * (that would move `lastMessageTs` and supersede a pending ask); hold the task lock; persist anything but its record.
 */
export class SubagentRunner {
	readonly childId: string
	readonly label: string

	private status: SubagentStatus = "queued"
	private readonly usage: SubagentUsage = emptyUsage()
	private readonly toolCalls: SubagentToolCallRecord[] = []
	private readonly now: () => number
	private readonly pollMs: number
	private startedAt = 0
	private cancelRequested = false
	private report?: SubagentReport
	private lastAssistantText = ""
	private budgetStop?: SubagentBudgetStop
	private lastTool?: string
	private modelIdReturned?: string
	private recordPath?: string
	private rejectInterrupt?: (error: Interrupt) => void
	private currentCall?: { approval: SubagentToolCallRecord["approval"] }
	private refusedThisCall = false
	private lastRequestInputTokens = 0

	constructor(private readonly init: SubagentRunnerInit) {
		this.childId = init.childId
		this.label = init.label
		this.now = init.now ?? Date.now
		this.pollMs = init.pollMs ?? 200
	}

	get origin(): SubagentOrigin {
		return {
			childId: this.childId,
			label: this.label,
			profile: this.init.profile,
			promptHead: promptHeadOf(this.init.prompt),
		}
	}

	get currentStatus(): SubagentStatus {
		return this.status
	}

	summary(): SubagentChildSummary {
		return {
			childId: this.childId,
			label: this.label,
			profile: this.init.profile,
			promptHead: promptHeadOf(this.init.prompt),
			status: this.status,
			...(this.lastTool ? { lastTool: this.lastTool } : {}),
			toolCalls: this.usage.toolCalls,
			tokensIn: this.usage.tokensIn,
			tokensOut: this.usage.tokensOut,
			...(this.usage.cost !== undefined ? { cost: this.usage.cost } : {}),
			...(this.budgetStop ? { budgetStop: this.budgetStop } : {}),
			...(this.recordPath ? { recordPath: this.recordPath } : {}),
		}
	}

	/** Ask the child to stop. Takes effect at its next await; a child waiting on the user stops at once. */
	cancel(): void {
		this.cancelRequested = true
		this.rejectInterrupt?.(new Interrupt("cancelled"))
	}

	/** Mark a child that never got a slot (cancelled while queued) so it still ends with a record. */
	async cancelQueued(): Promise<SubagentResult> {
		this.cancelRequested = true
		this.startedAt = this.now()
		return this.finish("cancelled")
	}

	private setStatus(next: SubagentStatus): void {
		if (isFinalSubagentStatus(this.status)) {
			return
		}
		this.status = next
		this.emit()
	}

	private emit(): void {
		try {
			this.init.onUpdate?.(this.summary())
		} catch (error) {
			console.error("Subagent update sink failed:", error)
		}
	}

	async run(): Promise<SubagentResult> {
		this.startedAt = this.now()
		this.setStatus("running")
		const { init } = this
		const budget = init.caps.budget
		const taskState = newChildTaskState()
		const messages = new ChildMessageState(init.taskId, init.ulid, taskState)

		// The interrupt is a rejection that any `await` in the loop can lose a race to: cancel, wall clock, parent abort.
		const interrupt = new Promise<never>((_resolve, reject) => {
			this.rejectInterrupt = reject
		})
		interrupt.catch(() => {})
		const deadline = this.startedAt + budget.wallClockMs
		const timer = setInterval(() => {
			if (this.cancelRequested || init.isParentAborted()) {
				this.rejectInterrupt?.(new Interrupt("cancelled"))
			} else if (this.now() >= deadline) {
				this.rejectInterrupt?.(new Interrupt("wall_clock"))
			}
		}, this.pollMs)
		const race = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, interrupt])

		let activeIterator: AsyncIterator<unknown> | undefined
		try {
			const executor = this.buildExecutor(taskState, messages)
			const system = this.systemPrompt()
			const history: Anthropic.MessageParam[] = [
				{ role: "user", content: [{ type: "text", text: subagentTaskMessage(init.prompt) }] },
			]
			let toolLessTurns = 0
			let blockedInARow = 0
			let errorsInARow = 0

			for (;;) {
				if (this.cancelRequested || init.isParentAborted()) {
					return this.finish("cancelled")
				}
				const stop = this.budgetBreach(budget)
				if (stop) {
					return this.finish("partial", { budgetStop: stop })
				}

				// ---- one model request ----
				this.usage.turns++
				this.lastRequestInputTokens = 0
				let text = ""
				const thinking: Array<Anthropic.Messages.ThinkingBlock | Anthropic.Messages.RedactedThinkingBlock> = []
				const iterator = init.api.createMessage(system, history)[Symbol.asyncIterator]()
				activeIterator = iterator
				for (;;) {
					const next = await race(iterator.next())
					if (next.done) {
						break
					}
					const chunk = next.value
					if (!chunk) {
						continue
					}
					switch (chunk.type) {
						case "text":
							text += chunk.text
							this.lastAssistantText = text
							break
						case "usage":
							this.usage.tokensIn += chunk.inputTokens
							this.usage.tokensOut += chunk.outputTokens
							this.usage.cacheWrites += chunk.cacheWriteTokens ?? 0
							this.usage.cacheReads += chunk.cacheReadTokens ?? 0
							this.lastRequestInputTokens +=
								chunk.inputTokens + (chunk.cacheReadTokens ?? 0) + (chunk.cacheWriteTokens ?? 0)
							if (chunk.totalCost !== undefined) {
								this.usage.cost = (this.usage.cost ?? 0) + chunk.totalCost
							}
							break
						case "response_model":
							this.modelIdReturned = chunk.modelId
							break
						case "ant_thinking":
							thinking.push({ type: "thinking", thinking: chunk.thinking, signature: chunk.signature })
							break
						case "ant_redacted_thinking":
							thinking.push({ type: "redacted_thinking", data: chunk.data })
							break
						default:
							break
					}
				}
				activeIterator = undefined
				this.emit()

				history.push({
					role: "assistant",
					content: [...thinking, { type: "text", text: text.trim() ? text : "Failure: I did not provide a response." }],
				})

				// ---- the tool call, if any (one per message) ----
				const repaired = repairNativeToolCallsForModel(init.api.getModel().id, text, this.nativeContext(), true).text
				const blocks = parseAssistantMessageV2(repaired)
				const toolUse = blocks.find((block): block is ToolUse => block.type === "tool_use")
				if (!toolUse) {
					toolLessTurns++
					if (toolLessTurns >= MAX_TOOL_LESS_TURNS) {
						return this.finish("partial", { note: "The model stopped calling tools without reporting." })
					}
					history.push({
						role: "user",
						content: [
							{
								type: "text",
								text: "[ERROR] You did not use a tool. Use exactly one tool per message. When you have what was asked, or nothing more can be learned, call report_findings.",
							},
						],
					})
					continue
				}
				toolLessTurns = 0
				const block: ToolUse = { ...toolUse, partial: false }

				if (block.name !== AiHydroDefaultTool.REPORT_FINDINGS && this.usage.toolCalls >= budget.maxToolCalls) {
					return this.finish("partial", { budgetStop: "tool_calls" })
				}
				this.usage.toolCalls++
				this.lastTool = this.describeTool(block)
				this.emit()

				taskState.userMessageContent = []
				taskState.didAlreadyUseTool = false
				taskState.didRejectTool = false
				this.currentCall = { approval: "auto" }
				this.refusedThisCall = false
				await race(executor.executeTool(block))
				const call = this.currentCall
				this.currentCall = undefined

				const resultText = taskState.userMessageContent
					.map((part) => (part.type === "text" ? part.text : ""))
					.filter(Boolean)
					.join("\n")
				const failed = ToolExecutor.isToolErrorResult(resultText)
				const outcome: SubagentToolCallRecord["result"] = this.refusedThisCall
					? "refused"
					: call.approval === "denied"
						? "denied"
						: failed
							? "error"
							: "ok"
				this.toolCalls.push(this.callRecord(block, this.refusedThisCall ? "refused" : call.approval, outcome))
				this.setStatus("running")

				if (this.report) {
					return this.finish("completed")
				}

				blockedInARow = outcome === "refused" || outcome === "denied" ? blockedInARow + 1 : 0
				errorsInARow = outcome === "error" ? errorsInARow + 1 : 0
				if (blockedInARow >= MAX_BLOCKED_IN_A_ROW) {
					return this.finish("blocked", { note: `${blockedInARow} calls in a row were refused or denied.` })
				}
				if (errorsInARow >= MAX_ERRORS_IN_A_ROW) {
					return this.finish("partial", { note: `${errorsInARow} tool errors in a row.` })
				}

				history.push({
					role: "user",
					content: taskState.userMessageContent.length
						? taskState.userMessageContent.map((part) =>
								part.type === "text" ? { ...part, text: capText(part.text) } : part,
							)
						: [{ type: "text", text: "(tool did not return anything)" }],
				})
			}
		} catch (error) {
			if (error instanceof Interrupt) {
				return error.kind === "wall_clock"
					? this.finish("partial", { budgetStop: "wall_clock" })
					: this.finish("cancelled")
			}
			if (init.isParentAborted() || this.cancelRequested) {
				return this.finish("cancelled")
			}
			const message = error instanceof Error ? error.message : String(error)
			return this.finish("failed", { error: message })
		} finally {
			clearInterval(timer)
			// Drop the stream without waiting: a provider call that is still pending cannot be awaited past a cancel.
			void (activeIterator as AsyncIterator<unknown> | undefined)?.return?.()?.catch?.(() => {})
		}
	}

	// ---- pieces ----

	private buildExecutor(taskState: ReturnType<typeof newChildTaskState>, messages: ChildMessageState): ToolExecutor {
		const { init } = this
		let sayTs = 0
		const say = async (type: AiHydroSay, text?: string, images?: string[], files?: string[], partial?: boolean) => {
			// Into the child's own in-memory list. Never the parent's `say`: that moves lastMessageTs.
			if (partial === true) {
				return undefined
			}
			sayTs = Math.max(sayTs + 1, this.now())
			await messages.addToAiHydroMessages({ ts: sayTs, type: "say", say: type, text, images, files })
			return sayTs
		}
		const ask = async (type: AiHydroAsk, text?: string, partial?: boolean) => {
			this.setStatus("waiting")
			try {
				const result = await init.bridge.ask(this.origin, type, text, partial)
				if (this.currentCall) {
					this.currentCall.approval = result.response === "yesButtonClicked" ? "approved" : "denied"
				}
				return result
			} finally {
				this.setStatus("running")
			}
		}
		return new ToolExecutor(
			init.context,
			taskState,
			messages,
			init.api,
			init.services.urlContentFetcher,
			init.services.browserSession,
			init.services.diffViewProvider,
			init.services.mcpHub,
			nullFileContextTracker(init.taskId),
			init.aihydroIgnoreController,
			new ContextManager(),
			init.stateManager,
			init.services.controller,
			init.cwd,
			init.taskId,
			init.ulid,
			init.workspaceManager,
			init.isMultiRootEnabled,
			say,
			ask,
			async () => {},
			async (toolName, paramName) => formatResponse.toolError(formatResponse.missingToolParameterError(paramName)),
			async () => {},
			async () => {
				throw new Error("A subagent cannot run commands.")
			},
			async () => false,
			async () => {},
			async () => false,
			{
				profile: init.caps,
				reportSink: (report) => {
					this.report = report
				},
				onRefused: () => {
					this.refusedThisCall = true
				},
			},
		)
	}

	private systemPrompt(): string {
		const { init } = this
		const model = init.api.getModel()
		const servers = init.services.mcpHub.getServers()
		return buildSubagentSystemPrompt({
			caps: init.caps,
			label: this.label,
			cwd: init.cwd,
			workspaceRoots: init.workspaceManager?.getRoots().map((root) => ({ path: root.path, name: root.name ?? root.path })),
			servers,
			context: {
				providerInfo: { providerId: "subagent", model },
				ide: "vscode",
				cwd: init.cwd,
				mcpHub: init.services.mcpHub,
			},
		})
	}

	/** Servers and tools a repaired native envelope may name: the same READ-on-trusted set the prompt lists. */
	private nativeContext(): NativeToolCallContext {
		const servers = (this.init.services.mcpHub.connections ?? [])
			.filter((conn) => conn.server.status === "connected" && Array.isArray(conn.server.tools))
			.map((conn) => ({ name: conn.server.name, trusted: isServerTrusted(conn.server), tools: conn.server.tools ?? [] }))
		return { servers }
	}

	private budgetBreach(budget: EffectiveCapabilities["budget"]): SubagentBudgetStop | undefined {
		if (this.usage.tokensOut >= budget.maxOutputTokens) {
			return "output_tokens"
		}
		const window = this.init.api.getModel().info.contextWindow
		if (window && this.lastRequestInputTokens >= window * budget.contextStopFraction) {
			return "context"
		}
		// A USD cap applies only when the provider reports cost.
		if (this.usage.cost !== undefined && this.usage.cost >= budget.maxCostUsd) {
			return "cost"
		}
		return undefined
	}

	private describeTool(block: ToolUse): string {
		return block.name === AiHydroDefaultTool.MCP_USE && block.params.tool_name ? block.params.tool_name : block.name
	}

	private callRecord(
		block: ToolUse,
		approval: SubagentToolCallRecord["approval"],
		result: SubagentToolCallRecord["result"],
	): SubagentToolCallRecord {
		const isMcp = block.name === AiHydroDefaultTool.MCP_USE || block.name === AiHydroDefaultTool.MCP_ACCESS
		return {
			name: block.name,
			...(isMcp ? { server: block.params.server_name, tool: block.params.tool_name } : {}),
			argsSha256: sha256(JSON.stringify(block.params)),
			approval,
			result,
		}
	}

	private async finish(
		status: SubagentStatus,
		extra: { budgetStop?: SubagentBudgetStop; error?: string; note?: string } = {},
	): Promise<SubagentResult> {
		this.status = status
		this.budgetStop = extra.budgetStop
		const { init } = this
		const keepText = status !== "completed" && status !== "cancelled" && this.lastAssistantText.trim()
		const record: SubagentRecord = {
			schema: "aihydro.subagent-record/1",
			childId: this.childId,
			label: this.label,
			parentTaskId: init.taskId,
			parentUlid: init.ulid,
			profile: init.profile,
			allowlistSha256: allowlistSha256([...init.caps.builtinAllow, init.caps.reportTool]),
			prompt: init.prompt,
			promptSha256: sha256(init.prompt),
			modelIdRequested: init.api.getModel().id,
			...(this.modelIdReturned ? { modelIdReturned: this.modelIdReturned } : {}),
			startedAt: new Date(this.startedAt).toISOString(),
			endedAt: new Date(this.now()).toISOString(),
			status,
			...(extra.budgetStop ? { budgetStop: extra.budgetStop } : {}),
			usage: this.usage,
			toolCalls: this.toolCalls,
			...(this.report ? { report: this.report } : {}),
			...(keepText ? { lastAssistantText: this.lastAssistantText } : {}),
			...(extra.error || extra.note ? { error: extra.error ?? extra.note } : {}),
		}
		let error = extra.error ?? extra.note
		try {
			this.recordPath = await init.writeRecord(record)
		} catch (writeError) {
			// The result still stands; the missing record is reported, never hidden.
			error = `${error ? `${error} ` : ""}(record not written: ${writeError instanceof Error ? writeError.message : String(writeError)})`
		}
		this.emit()
		return {
			childId: this.childId,
			label: this.label,
			status,
			...(this.report ? { report: this.report } : {}),
			...(keepText ? { lastAssistantText: this.lastAssistantText } : {}),
			...(extra.budgetStop ? { budgetStop: extra.budgetStop } : {}),
			usage: this.usage,
			...(this.recordPath ? { recordPath: this.recordPath } : {}),
			...(error ? { error } : {}),
		}
	}
}
