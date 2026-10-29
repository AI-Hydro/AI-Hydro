import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."
import { confirmAbortRunningTask } from "../abortGuard"

/**
 * Clears the current task
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function clearTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	// clearTask is called here when the user closes the task
	if (!(await confirmAbortRunningTask(controller, "clearTask"))) {
		return Empty.create() // the user kept the running chat
	}
	await controller.clearTask()
	await controller.postStateToWebview()
	return Empty.create()
}
