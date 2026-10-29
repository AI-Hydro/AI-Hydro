import type { Controller } from "@core/controller"
import { confirmReplaceChat } from "@core/controller/abortGuard"
import { sendChatButtonClickedEvent } from "@core/controller/ui/subscribeToChatButtonClicked"
import { sendFocusChatInputEvent } from "@core/controller/ui/subscribeToFocusChatInput"
import { WebviewProvider } from "@core/webview"
import { VscodeWebviewProvider } from "@/hosts/vscode/VscodeWebviewProvider"
import type { LaunchStudyHint } from "@/integrations/aihydro-session/studyBinding"
import { isChatInProgress } from "./launchGuard"

/** What the webview knows about a map launch: the user's own words and the study the clicked layer belongs to. */
export interface MapLaunchContext {
	userQuestion?: string
	studyHint?: LaunchStudyHint
}

export interface MapLaunchResult {
	ok: boolean
	error?: string
	/** The user kept the current chat instead of replacing it. */
	cancelled?: boolean
}

export { confirmReplaceChat }

/** Show the chat sidebar and focus its input. */
export async function focusChat(): Promise<void> {
	await sendChatButtonClickedEvent()
	const webview = WebviewProvider.getInstance()
	if (webview instanceof VscodeWebviewProvider) {
		webview.getWebview()?.show()
	}
	await sendFocusChatInputEvent()
}

export interface MapLaunchDeps {
	confirmReplace: () => Promise<boolean>
	focusChat: () => Promise<void>
}

/**
 * Focus chat sidebar and start a new task with a map-seeded prompt. The new chat is bound to the study the launch
 * names (or asks the user to pick) before its first tool call; a running chat is never aborted without a confirm.
 */
export async function startMapAgentTask(
	controller: Controller,
	prompt: string,
	launch?: MapLaunchContext,
	deps: MapLaunchDeps = { confirmReplace: confirmReplaceChat, focusChat },
): Promise<MapLaunchResult> {
	if (!prompt?.trim()) {
		return { ok: false, error: "Empty prompt" }
	}
	try {
		if (isChatInProgress(controller.task) && !(await deps.confirmReplace())) {
			return { ok: false, cancelled: true, error: "Kept the current chat." }
		}
		await controller.clearTask()
		await controller.postStateToWebview()
		await deps.focusChat()
		await controller.initTask(prompt.trim(), [], [], undefined, undefined, {
			origin: "map",
			userQuestion: launch?.userQuestion?.trim() || undefined,
			studyHint: launch?.studyHint,
		})
		return { ok: true }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error("[startMapAgentTask]", message)
		return { ok: false, error: message }
	}
}
