import type { Controller } from "@core/controller"
import { confirmReplaceChat } from "@core/controller/abortGuard"
import { sendAddToInputEvent } from "@core/controller/ui/subscribeToAddToInput"
import { sendChatButtonClickedEvent } from "@core/controller/ui/subscribeToChatButtonClicked"
import { sendFocusChatInputEvent } from "@core/controller/ui/subscribeToFocusChatInput"
import { WebviewProvider } from "@core/webview"
import { formatMapRef, type MapRef } from "@shared/map/mapRef"
import { VscodeWebviewProvider } from "@/hosts/vscode/VscodeWebviewProvider"
import type { LaunchStudyHint } from "@/integrations/aihydro-session/studyBinding"

/** What the webview knows about a map launch: the user's own words and the study the clicked layer belongs to. */
export interface MapLaunchContext {
	userQuestion?: string
	studyHint?: LaunchStudyHint
	/** What the user pointed at (layer, run, study, feature, place). Added to an open chat as one line. */
	ref?: MapRef
	/** The short text to put in an open chat's input, ahead of the ref. Without it the whole prompt goes in. */
	composerText?: string
}

export interface MapLaunchResult {
	ok: boolean
	error?: string
	/** The user kept the current chat instead of replacing it. */
	cancelled?: boolean
	/** An open chat took the text into its input; no new chat was started and nothing was cleared. */
	addedToChat?: boolean
	/** Said to the user next to the result, e.g. the layer is from another study than this chat's. */
	warning?: string
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
	/** Put text into the open chat's input. */
	addToInput?: (text: string) => Promise<void>
}

/** True when a chat is open and alive. A finished chat is still the user's chat; asking from the map does not discard it. */
function hasOpenChat(controller: Controller): boolean {
	const task = controller.task as { taskState?: { abort?: boolean } } | undefined
	return !!task && !task.taskState?.abort
}

/** Say so when the thing pointed at belongs to another study than the chat. The text still goes in; the user decides. */
function studyMismatch(controller: Controller, ref: MapRef | undefined): string | undefined {
	const binding = controller.studyBinding
	const taskId = (controller.task as { ulid?: string } | undefined)?.ulid
	if (!ref?.study_id || !binding || binding.status !== "bound" || !binding.studyId || binding.chatId !== taskId) {
		return undefined
	}
	return binding.studyId === ref.study_id
		? undefined
		: `This layer is from study ${ref.study_id}; this chat is bound to ${binding.label ?? binding.studyId}.`
}

/**
 * Asking from the map. With a chat open, the text goes into that chat's input and nothing is cleared, aborted or
 * replaced: the user reads it and sends it. With no chat open, a new chat starts with the map-seeded prompt, bound
 * to the study the launch names (or asks the user to pick) before its first tool call.
 */
export async function startMapAgentTask(
	controller: Controller,
	prompt: string,
	launch?: MapLaunchContext,
	deps: MapLaunchDeps = { confirmReplace: confirmReplaceChat, focusChat, addToInput: sendAddToInputEvent },
): Promise<MapLaunchResult> {
	if (!prompt?.trim()) {
		return { ok: false, error: "Empty prompt" }
	}
	try {
		if (hasOpenChat(controller)) {
			const lead = launch?.composerText?.trim() || (launch?.ref ? "" : prompt.trim())
			const text = [lead, launch?.ref ? formatMapRef(launch.ref) : ""].filter(Boolean).join(" ")
			await deps.focusChat()
			await (deps.addToInput ?? sendAddToInputEvent)(text)
			return { ok: true, addedToChat: true, warning: studyMismatch(controller, launch?.ref) }
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
