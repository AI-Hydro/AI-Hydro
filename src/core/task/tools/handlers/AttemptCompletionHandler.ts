import type Anthropic from "@anthropic-ai/sdk"
import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { AUDIT_PROGRESS_DRAFTING } from "@shared/aihydro/answerAuditGate"
import type { AnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import { findLastIndex } from "@shared/array"
import { COMPLETION_RESULT_CHANGES_FLAG } from "@shared/ExtensionMessage"
import { resolveWorkspaceRoot } from "@/core/mcp/workspaceRoot"
import { telemetryService } from "@/services/telemetry"
import { AiHydroDefaultTool } from "@/shared/tools"
import {
	compactPendingRows,
	computeGateEligibility,
	cycleHadHard,
	evaluateDraft,
	finalPayload,
	type GateDecision,
	interruptedPayload,
	resetGateCycle,
	sweepAuditProgress,
} from "../../answerAuditGate"
import { type FinalAnswerAuditOutcome, runFinalAnswerAudit, toAnswerAuditPayload } from "../../finalAnswerAudit"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class AttemptCompletionHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = AiHydroDefaultTool.ATTEMPT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for attempt_completion
	 * Matches the original conditional logic structure for command vs no-command cases
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const result = block.params.result
		const command = block.params.command

		// Gate-eligible tasks do not stream the draft: it may be rejected and revised before the user should read it.
		// The decision is made once per block from cached state (no I/O) and reused by execute().
		const config = uiHelpers.getConfig()
		const gate = config.taskState.answerAuditGate
		gate.eligibleForBlock ??= this.gateEligibility(config)
		if (gate.eligibleForBlock) {
			await uiHelpers.say("answer_audit", AUDIT_PROGRESS_DRAFTING, undefined, undefined, true)
			return
		}

		if (!command) {
			// no command, still outputting partial result
			await uiHelpers.say(
				"completion_result",
				uiHelpers.removeClosingTag(block, "result", result),
				undefined,
				undefined,
				block.partial,
			)
		}
	}

	/** Cheap, I/O-free eligibility for the pre-completion gate (cached hub state and task caches only). */
	private gateEligibility(config: TaskConfig): boolean {
		const settings = config.services.stateManager
		const result = computeGateEligibility({
			toolName: this.name,
			mode: settings.getGlobalSettingsKey("mode"),
			gateSetting: settings.getGlobalSettingsKey("finalAnswerAuditGate"),
			auditEnabled: settings.getGlobalSettingsKey("finalAnswerAuditEnabled"),
			servers: config.services.mcpHub.getServers(),
			state: config.taskState.answerAuditGate,
		})
		config.taskState.answerAuditGate.eligibleServer = result.eligible ? result.serverName : undefined
		return result.eligible
	}

	/** Emit one structured `answer_audit` row (never prose): the webview renders it, copy/notification text is derived. */
	private async emitAnswerAudit(config: TaskConfig, outcome: FinalAnswerAuditOutcome, answer: string): Promise<void> {
		const answerRow = config.messageState
			.getAiHydroMessages()
			.slice()
			.reverse()
			.find((m) => m.say === "completion_result")
		const payload = toAnswerAuditPayload(outcome, {
			stage: "final",
			attempt: 0,
			answerTs: answerRow?.ts ?? Date.now(),
			answer,
		})
		await config.callbacks.say("answer_audit", JSON.stringify(payload))
	}

	/** Emit the final-stage row for a gate-accepted answer (the audit already ran inside the gate). */
	private async emitGateFinal(config: TaskConfig, decision: Extract<GateDecision, { kind: "accept" }>): Promise<void> {
		// Nothing to audit / no research session stays silent unless the answer was revised: a revised answer
		// always carries its record.
		if (decision.outcome.status === "skipped" && decision.attempt === 0) {
			await compactPendingRows(config.messageState)
			return
		}
		const answerRow = config.messageState
			.getAiHydroMessages()
			.slice()
			.reverse()
			.find((m) => m.say === "completion_result")
		const payload: AnswerAuditPayload = finalPayload(decision, answerRow?.ts ?? Date.now(), cycleHadHard(decision.history))
		await config.callbacks.say("answer_audit", JSON.stringify(payload))
		await compactPendingRows(config.messageState)
	}

	private async showFinalAnswerAudit(config: TaskConfig, answer: string): Promise<void> {
		let emitted = false
		try {
			if (config.services.stateManager.getGlobalSettingsKey("finalAnswerAuditEnabled") === false) {
				return
			}
			const outcome = await runFinalAnswerAudit({
				hub: config.services.mcpHub,
				ulid: config.ulid,
				workspaceRoot: await resolveWorkspaceRoot(config.cwd),
				answer,
				modelIdReturned: config.taskState.lastResponseModelId,
				projectId: config.services.controller?.getChatProjectId(config.ulid),
			})
			// Nothing to audit / no research session stays silent, as before: no row for chats outside a study.
			if (outcome.status !== "skipped") {
				emitted = true // set before the say: a throw from the say itself must not produce a second row
				await this.emitAnswerAudit(config, outcome, answer)
			}
		} catch (error) {
			if (emitted) {
				return
			}
			// Never let the audit affect completion; surface that it did not run.
			await this.emitAnswerAudit(
				config,
				{ status: "unavailable", reason: error instanceof Error ? error.message : String(error) },
				answer,
			).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// The eligibility decided before streaming wins, so a draft that streamed is never gated afterwards.
		const gate = config.taskState.answerAuditGate
		const gateEligible = gate.eligibleForBlock ?? this.gateEligibility(config)
		gate.eligibleForBlock = undefined
		try {
			return await this.executeBlock(config, block, gateEligible)
		} finally {
			if (gateEligible) {
				await sweepAuditProgress(config.messageState).catch(() => {}) // never leave the activity line behind
			}
		}
	}

	/** Reveal a hidden draft because the gate was left early, then end the cycle. */
	private async revealDraft(config: TaskConfig, reason: string): Promise<void> {
		const payload = interruptedPayload(config.taskState.answerAuditGate, reason)
		resetGateCycle(config.taskState.answerAuditGate)
		await sweepAuditProgress(config.messageState)
		if (payload) {
			await config.callbacks.say("answer_audit", JSON.stringify(payload))
			await compactPendingRows(config.messageState)
		}
	}

	private async executeBlock(config: TaskConfig, block: ToolUse, gateEligible: boolean): Promise<ToolResponse> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		// Validate required parameters
		if (!result) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "result")
		}

		// The pre-completion gate runs FIRST: before the notification, the completion say, the checkpoint,
		// telemetry and the command ask. Not eligible: nothing below changes.
		let gateDecision: Extract<GateDecision, { kind: "accept" }> | undefined
		// Emit the gate's final record once, as soon as the answer is shown (before any command ask, so a denied or
		// rejected command cannot drop the revision / removed-value / unresolved-findings disclosure).
		const finalizeGate = async () => {
			const decision = gateDecision
			gateDecision = undefined
			if (decision) {
				await this.emitGateFinal(config, decision).catch(() => {})
				resetGateCycle(config.taskState.answerAuditGate)
			}
		}
		if (gateEligible) {
			const state = config.taskState.answerAuditGate
			const decision = await evaluateDraft({
				state,
				hub: config.services.mcpHub,
				serverName: state.eligibleServer,
				ulid: config.ulid,
				workspaceRoot: await resolveWorkspaceRoot(config.cwd),
				modelId: config.taskState.lastResponseModelId,
				projectId: config.services.controller?.getChatProjectId(config.ulid),
				result,
				rows: () => config.messageState.getAiHydroMessages(),
				emit: async (payload) => {
					await sweepAuditProgress(config.messageState)
					await config.callbacks.say("answer_audit", JSON.stringify(payload))
				},
				setProgress: async (text) => {
					if (text) {
						await config.callbacks.say("answer_audit", text, undefined, undefined, true)
					} else {
						await sweepAuditProgress(config.messageState)
					}
				},
				takeUserMessage: () => {
					const ts = config.taskState
					if (ts.askResponse !== "messageResponse") {
						return undefined
					}
					const typed = { text: ts.askResponseText, images: ts.askResponseImages, files: ts.askResponseFiles }
					ts.askResponse = undefined
					ts.askResponseText = undefined
					ts.askResponseImages = undefined
					ts.askResponseFiles = undefined
					return typed
				},
				isAborted: () => config.taskState.abort,
			})
			await sweepAuditProgress(config.messageState)
			if (decision.kind === "aborted") {
				return ""
			}
			if (decision.kind === "revise") {
				// Not an accepted attempt: consecutiveMistakeCount is neither incremented nor reset here.
				return decision.feedback
			}
			if (decision.kind === "user_feedback") {
				await this.revealDraft(config, "you sent a message while the answer was being checked")
				await config.callbacks.say("user_feedback", decision.text ?? "", decision.images, decision.files)
				return await this.feedbackResult(undefined, decision.text, decision.images, decision.files)
			}
			gateDecision = decision
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show notification if auto-approval is enabled
		if (config.autoApprovalSettings.enabled && config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Task Completed",
				message: result.replace(/\n/g, " "),
			})
		}

		const addNewChangesFlagToLastCompletionResultMessage = async () => {
			// Add newchanges flag if there are new changes to the workspace
			const hasNewChanges = await config.callbacks.doesLatestTaskCompletionHaveNewChanges()
			const aihydroMessages = config.messageState.getAiHydroMessages()

			const lastCompletionResultMessageIndex = findLastIndex(aihydroMessages, (m: any) => m.say === "completion_result")
			const lastCompletionResultMessage =
				lastCompletionResultMessageIndex !== -1 ? aihydroMessages[lastCompletionResultMessageIndex] : undefined
			if (
				lastCompletionResultMessage &&
				lastCompletionResultMessageIndex !== -1 &&
				hasNewChanges &&
				!lastCompletionResultMessage.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG)
			) {
				await config.messageState.updateAiHydroMessage(lastCompletionResultMessageIndex, {
					text: lastCompletionResultMessage.text + COMPLETION_RESULT_CHANGES_FLAG,
				})
			}
		}

		let commandResult: any
		const lastMessage = config.messageState.getAiHydroMessages().at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask !== "command") {
				// haven't sent a command message yet so first send completion_result then command
				const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
				config.taskState.answerAuditGate.hidden = undefined // shown: no longer a hidden draft
				await config.callbacks.saveCheckpoint(true, completionMessageTs)
				await addNewChangesFlagToLastCompletionResultMessage()
				telemetryService.captureTaskCompleted(config.ulid)
				await finalizeGate()
			} else {
				config.taskState.answerAuditGate.hidden = undefined
				// we already sent a command message, meaning the complete completion message has also been sent
				await config.callbacks.saveCheckpoint(true)
			}

			// Attempt completion is a special tool where we want to update the focus chain list before the user provides response
			if (!block.partial && config.focusChainSettings.enabled) {
				await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
			}

			// complete command message - need to ask for approval
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("command", command, config)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}

			// User approved, execute the command
			const [userRejected, execCommandResult] = await config.callbacks.executeCommandTool(command!, undefined) // no timeout for attempt_completion command
			if (userRejected) {
				config.taskState.didRejectTool = true
				return execCommandResult
			}
			// user didn't reject, but the command may have output
			commandResult = execCommandResult
		} else {
			const completionMessageTs = await config.callbacks.say("completion_result", result, undefined, undefined, false)
			config.taskState.answerAuditGate.hidden = undefined // shown: no longer a hidden draft
			await config.callbacks.saveCheckpoint(true, completionMessageTs)
			await addNewChangesFlagToLastCompletionResultMessage()
			telemetryService.captureTaskCompleted(config.ulid)
		}

		// The chat has an answer: one more automatic title, from the whole exchange, unless the user named it (X1-P2).
		config.services?.controller?.requestChatTitle?.("completion")

		// we already sent completion_result says, an empty string asks relinquishes control over button and field
		// in case last command was interactive and in partial state, the UI is expecting an ask response. This ends the command ask response, freeing up the UI to proceed with the completion ask.
		if (config.messageState.getAiHydroMessages().at(-1)?.ask === "command_output") {
			await config.callbacks.say("command_output", "")
		}

		if (!block.partial && config.focusChainSettings.enabled) {
			await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
		}

		// Final-answer audit: display-only evidence check of the answer the user is about to read.
		// Runs before the completion ask (a say after a pending ask would hide the ask's buttons) and
		// is time-bounded; it can never block or change the answer.
		if (gateDecision) {
			// The audit already ran inside the gate; emit its record (with revisions, removed values, disclosure).
			await finalizeGate()
		} else {
			await this.showFinalAnswerAudit(config, result)
		}

		const { response, text, images, files: completionFiles } = await config.callbacks.ask("completion_result", "", false)
		if (response === "yesButtonClicked") {
			return "" // signals to recursive loop to stop (for now this never happens since yesButtonClicked will trigger a new task)
		}

		await config.callbacks.say("user_feedback", text ?? "", images, completionFiles)
		return await this.feedbackResult(commandResult, text, images, completionFiles)
	}

	/** Tool result carrying the user's feedback on a shown (or gate-interrupted) answer. */
	private async feedbackResult(
		commandResult: any,
		text: string | undefined,
		images: string[] | undefined,
		completionFiles: string[] | undefined,
	): Promise<ToolResponse> {
		const toolResults: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []
		if (commandResult) {
			if (typeof commandResult === "string") {
				toolResults.push({
					type: "text",
					text: commandResult,
				})
			} else if (Array.isArray(commandResult)) {
				toolResults.push(...commandResult)
			}
		}
		toolResults.push({
			type: "text",
			text: `The user has provided feedback on the results. Consider their input to continue the task, and then attempt completion again.\n<feedback>\n${text}\n</feedback>`,
		})
		toolResults.push(...formatResponse.imageBlocks(images))

		let fileContentString = ""
		if (completionFiles && completionFiles.length > 0) {
			fileContentString = await processFilesIntoText(completionFiles)
		}

		// Return the tool results as a complex response
		return [
			{
				type: "text" as const,
				text: `[attempt_completion] Result:`,
			},
			...toolResults,
			...(fileContentString
				? [
						{
							type: "text" as const,
							text: fileContentString,
						},
					]
				: []),
		]
	}
}
