import { AskResponseRequest, AskResponseResult } from "@shared/proto/cline/task"
import { AiHydroAskResponse } from "../../../shared/WebviewMessage"
import { Controller } from ".."
import { clearPending } from "../ui/pendingAskBadge"

/**
 * Handles a response from the webview for a previous ask operation
 *
 * @param controller The controller instance
 * @param request The request containing response type, optional text and optional images
 * @returns `stale: true` when the response named an ask that is no longer the pending one and was dropped
 */
export async function askResponse(controller: Controller, request: AskResponseRequest): Promise<AskResponseResult> {
	try {
		if (!controller.task) {
			console.warn("askResponse: No active task to receive response")
			// A bound response (non-zero ask_ts) with no task to answer is stale too.
			return AskResponseResult.create({ stale: request.askTs !== 0 })
		}

		// Map the string responseType to the AiHydroAskResponse enum
		let responseType: AiHydroAskResponse
		switch (request.responseType) {
			case "yesButtonClicked":
				responseType = "yesButtonClicked"
				break
			case "noButtonClicked":
				responseType = "noButtonClicked"
				break
			case "messageResponse":
				responseType = "messageResponse"
				break
			default:
				console.warn(`askResponse: Unknown response type: ${request.responseType}`)
				return AskResponseResult.create({ stale: false })
		}

		// The user answered: drop the "waiting for you" badge. Only for the ask that is pending, so a stale response
		// (dropped below) cannot clear the badge of the ask that replaced it.
		const pendingTs = controller.task.taskState?.lastMessageTs
		if (pendingTs !== undefined && (request.askTs === 0 || request.askTs === pendingTs)) {
			clearPending(pendingTs)
		}

		// Call the task's handler for webview responses
		const result = await controller.task.handleWebviewAskResponse(
			responseType,
			request.text,
			request.images,
			request.files,
			request.askTs,
		)

		return AskResponseResult.create({ stale: result?.stale === true })
	} catch (error) {
		console.error("Error in askResponse handler:", error)
		throw error
	}
}
