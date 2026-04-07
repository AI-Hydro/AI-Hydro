import type { AiHydroAsk, AiHydroSay } from "@shared/ExtensionMessage"
import type { AiHydroDefaultTool } from "@shared/tools"
import type { AiHydroAskResponse } from "@shared/WebviewMessage"
import { telemetryService } from "@/services/telemetry"
import type { ToolParamName, ToolUse } from "../../../assistant-message"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import { removeClosingTag } from "../utils/ToolConstants"
import type { TaskConfig } from "./TaskConfig"

/**
 * Strongly-typed UI helper functions for tool handlers
 */
export interface StronglyTypedUIHelpers {
	// Core UI methods
	say: (type: AiHydroSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>

	ask: (
		type: AiHydroAsk,
		text?: string,
		partial?: boolean,
	) => Promise<{
		response: AiHydroAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}>

	// Utility methods
	removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => string
	removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: AiHydroAsk | AiHydroSay) => Promise<void>

	// Approval methods
	shouldAutoApproveTool: (toolName: AiHydroDefaultTool) => boolean | [boolean, boolean]
	shouldAutoApproveToolWithPath: (toolName: AiHydroDefaultTool, path?: string) => Promise<boolean>
	askApproval: (messageType: AiHydroAsk, message: string) => Promise<boolean>

	// Telemetry and notifications
	captureTelemetry: (toolName: AiHydroDefaultTool, autoApproved: boolean, approved: boolean) => void
	showNotificationIfEnabled: (message: string) => void

	// Config access - returns the proper typed config
	getConfig: () => TaskConfig
}

/**
 * Creates strongly-typed UI helpers from a TaskConfig
 */
export function createUIHelpers(config: TaskConfig): StronglyTypedUIHelpers {
	return {
		say: config.callbacks.say,
		ask: config.callbacks.ask,
		removeClosingTag: (block: ToolUse, tag: ToolParamName, text?: string) => removeClosingTag(block, tag, text),
		removeLastPartialMessageIfExistsWithType: config.callbacks.removeLastPartialMessageIfExistsWithType,
		shouldAutoApproveTool: (toolName: AiHydroDefaultTool) => config.autoApprover.shouldAutoApproveTool(toolName),
		shouldAutoApproveToolWithPath: config.callbacks.shouldAutoApproveToolWithPath,
		askApproval: async (messageType: AiHydroAsk, message: string): Promise<boolean> => {
			const { response } = await config.callbacks.ask(messageType, message, false)
			return response === "yesButtonClicked"
		},
		captureTelemetry: (toolName: AiHydroDefaultTool, autoApproved: boolean, approved: boolean) => {
			telemetryService.captureToolUsage(config.ulid, toolName, config.api.getModel().id, autoApproved, approved)
		},
		showNotificationIfEnabled: (message: string) => {
			showNotificationForApprovalIfAutoApprovalEnabled(
				message,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)
		},
		getConfig: () => config,
	}
}
