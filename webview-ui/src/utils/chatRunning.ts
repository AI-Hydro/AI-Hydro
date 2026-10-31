/**
 * Whether the chat is mid-run, from the messages the webview has: the same rule as the host's `isChatInProgress`
 * (core/map/launchGuard.ts). No messages means no chat. A finished chat or one that only offers to resume is idle.
 */
export function isChatRunning(messages: ReadonlyArray<{ ask?: string; say?: string }>): boolean {
	const last = messages[messages.length - 1]
	if (!last) {
		return false
	}
	const idle = ["completion_result", "resume_task", "resume_completed_task"]
	return !(idle.includes(last.ask ?? "") || last.say === "completion_result")
}

/** True when the page has no focused control: the focus was on something that has just been removed. */
export function nothingHasFocus(doc: Document = document): boolean {
	const el = doc.activeElement
	return !el || el === doc.body || el === doc.documentElement
}
