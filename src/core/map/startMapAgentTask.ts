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
}

/** What asking from the map needs. It never replaces a chat, so there is no confirm. */
export interface MapAskDeps {
	focusChat: () => Promise<void>
	/** Put text into the open chat's input. Resolves false when no chat input received it. */
	addToInput: (text: string) => Promise<boolean>
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
 * The line that goes into the chat input. When the ref's study is not the chat's (another study, or the chat is bound
 * to none), the study is not asserted in the ref and the note is written in the input itself, so the user sees it
 * before sending and the agent reads it as plain text.
 */
export function composerLine(controller: Controller, lead: string, ref: MapRef | undefined): { text: string; warning?: string } {
	if (!ref) return { text: lead }
	const warning = studyMismatch(controller, ref)
	const taskId = (controller.task as { ulid?: string } | undefined)?.ulid
	const b = controller.studyBinding
	const bound = !!b && b.status === "bound" && !!b.studyId && b.chatId === taskId
	if (ref.study_id && !bound) {
		const note = `(This layer is from study ${ref.study_id}; this chat is not bound to a study.)`
		return {
			text: [lead, note, formatMapRef({ ...ref, study_id: undefined })].filter(Boolean).join(" "),
			warning: note.slice(1, -1),
		}
	}
	if (warning) {
		return { text: [lead, `(${warning})`, formatMapRef({ ...ref, study_id: undefined })].filter(Boolean).join(" "), warning }
	}
	return { text: [lead, formatMapRef(ref)].filter(Boolean).join(" ") }
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
	deps: MapAskDeps = { focusChat, addToInput: sendAddToInputEvent },
): Promise<MapLaunchResult> {
	if (!prompt?.trim()) {
		return { ok: false, error: "Empty prompt" }
	}
	try {
		if (hasOpenChat(controller)) {
			const lead = launch?.composerText?.trim() || (launch?.ref ? "" : prompt.trim())
			const line = composerLine(controller, lead, launch?.ref)
			await deps.focusChat()
			if (!(await deps.addToInput(line.text))) {
				return {
					ok: false,
					error: "The chat input is not open, so nothing was added. Open the AI-Hydro chat and ask again.",
				}
			}
			return { ok: true, addedToChat: true, warning: line.warning }
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
