import { Empty } from "@shared/proto/cline/common"
import { TaskFavoriteRequest } from "@shared/proto/cline/task"
import { Controller } from "../"

export async function toggleTaskFavorite(controller: Controller, request: TaskFavoriteRequest): Promise<Empty> {
	if (!request.taskId || request.isFavorited === undefined) {
		const errorMsg = `[toggleTaskFavorite] Invalid request: taskId or isFavorited missing`
		console.error(errorMsg)
		return Empty.create({})
	}

	try {
		// One write path (historyPatch.ts): only the favourite field changes, everything else is kept.
		try {
			const history = controller.stateManager.getGlobalStateKey("taskHistory")
			if (!history.some((item) => item.id === request.taskId)) {
				console.log(`[toggleTaskFavorite] Task not found in history array!`)
			} else {
				controller.patchTaskHistory(request.taskId, { isFavorited: request.isFavorited }, "user")
			}
		} catch (historyErr) {
			console.error("Error processing task history:", historyErr)
		}

		// Post to webview
		try {
			await controller.postStateToWebview()
		} catch (webviewErr) {
			console.error("Error posting to webview:", webviewErr)
		}
	} catch (error) {
		console.error("Error in toggleTaskFavorite:", error)
	}

	return Empty.create({})
}
