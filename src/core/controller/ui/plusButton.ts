import type { Controller } from ".."
import { confirmAbortRunningTask } from "../abortGuard"
import { sendChatButtonClickedEvent } from "./subscribeToChatButtonClicked"

/** "New Task" in the view title (`aihydro.plusButtonClicked`). A running chat is kept unless the user confirms. */
export async function plusButtonClicked(controller: Controller): Promise<void> {
	if (!(await confirmAbortRunningTask(controller, "plusButton"))) {
		await sendChatButtonClickedEvent() // kept the running chat: show it
		return
	}
	await controller.clearTask()
	await controller.postStateToWebview()
	await sendChatButtonClickedEvent()
}
