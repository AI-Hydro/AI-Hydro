/**
 * Guard for actions that replace the current chat (a map "Ask" or "Delineate here" opens a new chat). Starting one
 * calls `clearTask()`, which aborts a running task and removes a pending ask from view, so it needs the user's
 * word first. A finished chat (its last message is the completion) has nothing to lose, and neither does a chat
 * that was just reopened and only offers to resume. See `confirmAbortRunningTask` (core/controller/abortGuard.ts),
 * which every user-initiated path shares.
 */
interface GuardTask {
	taskState?: { abort?: boolean }
	messageStateHandler?: { getAiHydroMessages(): Array<{ ask?: string; say?: string }> }
}

export function isChatInProgress(task: GuardTask | undefined): boolean {
	if (!task || task.taskState?.abort) {
		return false
	}
	const messages = task.messageStateHandler?.getAiHydroMessages() ?? []
	const last = messages[messages.length - 1]
	if (!last) {
		return true // initialising: the task is live but has said nothing yet
	}
	const idle = ["completion_result", "resume_task", "resume_completed_task"]
	return !(idle.includes(last.ask ?? "") || last.say === "completion_result")
}
