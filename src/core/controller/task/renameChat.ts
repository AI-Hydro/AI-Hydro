import { RenameChatRequest, RenameChatResult } from "@shared/proto/cline/task"
import { Controller } from "../"

/**
 * Rename a chat (X1-P2). A title locks (`titleSource: "user"`) and survives every later save, completion and automatic
 * title. An empty title resets the chat to an automatic one. The write goes through `patchTaskHistory`.
 */
export async function renameChat(controller: Controller, request: RenameChatRequest): Promise<RenameChatResult> {
	if (!request.taskId) {
		return RenameChatResult.create({ ok: false, reason: "not_found" })
	}
	const result = controller.renameChat(request.taskId, request.title ?? "", request.description)
	if (result.ok) {
		await controller.postStateToWebview().catch(() => {})
		return RenameChatResult.create({ ok: true })
	}
	return RenameChatResult.create({ ok: false, reason: result.reason, detail: result.detail ?? "" })
}
