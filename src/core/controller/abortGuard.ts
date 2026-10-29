import { isChatInProgress } from "@core/map/launchGuard"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

/**
 * One confirm guard for every USER-INITIATED path that would stop the running chat (`Controller.clearTask()` aborts
 * the task and drops a pending ask). Call it before `clearTask()` / `initTask()`; do not call it from internal or
 * system paths (dispose, webview re-resolve, cancel-and-resume, tests).
 *
 * "Running" is `isChatInProgress` (core/map/launchGuard.ts): a live task, not aborted, whose last message is not
 * `completion_result` and not an idle resume prompt. That covers streaming, tool execution, and a pending approval or
 * follow-up ask. A finished, aborted, absent, or just-reopened (resume) chat proceeds silently.
 */
export const STOP_AND_CONTINUE_LABEL = "Stop and continue"
const MESSAGE = "A chat is still running. Stop it and start a new one?"

export interface AbortGuardTarget {
	task?: Parameters<typeof isChatInProgress>[0]
}

export interface AbortGuardDeps {
	/** Replaces the modal (tests). */
	confirm?: (reason: string) => Promise<boolean>
	/** The user is answering this very pending ask (its button started the new chat), so it is not "running". */
	answeringAsk?: string
}

function lastAsk(task: AbortGuardTarget["task"]): string | undefined {
	const messages = task?.messageStateHandler?.getAiHydroMessages() ?? []
	return messages[messages.length - 1]?.ask
}

/** Non-modal feedback so a declined or unavailable modal never leaves "New task" silently doing nothing. */
function notifyKept(): void {
	try {
		void Promise.resolve(
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Kept the running chat; stop it first to start a new one.",
			}),
		).catch(() => {})
	} catch {
		// host without a window: the console.warn above is the record
	}
}

/** The modal. Anything but the explicit button, or a host that cannot show one, keeps the chat. */
export async function showStopRunningChatModal(): Promise<boolean> {
	try {
		const response = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: MESSAGE,
			options: { modal: true, items: [STOP_AND_CONTINUE_LABEL] },
		})
		return response?.selectedOption === STOP_AND_CONTINUE_LABEL
	} catch (err) {
		// No modal available: keep the chat, but never silently.
		console.warn("[abortGuard] could not show the stop-chat modal; kept the running chat:", err)
		notifyKept()
		return false
	}
}

/**
 * True = go ahead (nothing running, or the user chose "Stop and continue").
 * False = the user kept the running chat; the caller must not touch it.
 * `reason` names the path (for tests and logs); it is not shown.
 */
export async function confirmAbortRunningTask(
	controller: AbortGuardTarget,
	reason: string,
	deps: AbortGuardDeps = {},
): Promise<boolean> {
	if (!isChatInProgress(controller.task)) {
		return true
	}
	if (deps.answeringAsk && lastAsk(controller.task) === deps.answeringAsk) {
		return true
	}
	return (deps.confirm ?? showStopRunningChatModal)(reason)
}

/** Kept for the map/ledger/preview launchers, which pass it as their `confirmReplace` dependency. */
export const confirmReplaceChat = showStopRunningChatModal
