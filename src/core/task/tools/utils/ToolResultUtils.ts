import { ApiHandler } from "@core/api"
import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ToolResponse } from "@core/task"
import { processFilesIntoText } from "@/integrations/misc/extract-text"
import { AiHydroAsk } from "@/shared/ExtensionMessage"
import type { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

/**
 * Utility functions for handling tool results and feedback
 */
export class ToolResultUtils {
	/**
	 * Push tool result to user message content with proper formatting
	 */
	static pushToolResult(
		content: ToolResponse,
		block: ToolUse,
		userMessageContent: any[],
		toolDescription: (block: ToolUse) => string,
		_api: ApiHandler,
		markToolAsUsed: () => void,
		coordinator?: ToolExecutorCoordinator,
	): void {
		if (typeof content === "string") {
			const resultText = content || "(tool did not return anything)"

			// Try to get description from coordinator first, otherwise use the provided function
			const description = coordinator
				? (() => {
						const handler = coordinator.getHandler(block.name)
						return handler ? handler.getDescription(block) : toolDescription(block)
					})()
				: toolDescription(block)

			// Non-Claude 4: Use traditional format with header
			userMessageContent.push({
				type: "text",
				text: `${description} Result:`,
			})
			userMessageContent.push({
				type: "text",
				text: resultText,
			})
		} else {
			userMessageContent.push(...content)
		}
		// once a tool result has been collected, ignore all other tool uses since we should only ever present one tool result per message
		markToolAsUsed()
	}

	/**
	 * Push additional tool feedback from user to message content
	 */
	static pushAdditionalToolFeedback(
		userMessageContent: any[],
		feedback?: string,
		images?: string[],
		fileContentString?: string,
	): void {
		if (!feedback && (!images || images.length === 0) && !fileContentString) {
			return
		}
		const content = formatResponse.toolResult(
			`The user provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`,
			images,
			fileContentString,
		)
		if (typeof content === "string") {
			userMessageContent.push({
				type: "text",
				text: content,
			})
		} else {
			userMessageContent.push(...content)
		}
	}

	/**
	 * Handles tool approval flow and processes any user feedback
	 */
	static async askApprovalAndPushFeedback(type: AiHydroAsk, completeMessage: string, config: TaskConfig) {
		return (await ToolResultUtils.askApprovalDetailed(type, completeMessage, config)).approved
	}

	/**
	 * The same flow, saying also whether the user wrote anything with the answer. A denial with text is the user
	 * speaking; a bare denial is only a "no" (the subagent launch brake counts only those).
	 */
	static async askApprovalDetailed(
		type: AiHydroAsk,
		completeMessage: string,
		config: TaskConfig,
	): Promise<{ approved: boolean; hadFeedback: boolean }> {
		const { response, text, images, files } = await config.callbacks.ask(type, completeMessage, false)
		const hadFeedback = !!text || (images?.length ?? 0) > 0 || (files?.length ?? 0) > 0

		if (hadFeedback) {
			let fileContentString = ""
			if (files && files.length > 0) {
				fileContentString = await processFilesIntoText(files)
			}

			ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContentString)
			await config.callbacks.say("user_feedback", text, images, files)
		}

		if (response !== "yesButtonClicked") {
			// User pressed reject button or responded with a message, which we treat as a rejection
			config.taskState.didRejectTool = true // Prevent further tool uses in this message
			return { approved: false, hadFeedback }
		} else {
			// User hit the approve button, and may have provided feedback
			return { approved: true, hadFeedback }
		}
	}
}
