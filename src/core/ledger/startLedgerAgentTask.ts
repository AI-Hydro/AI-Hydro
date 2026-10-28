import type { Controller } from "@core/controller"
import { isChatInProgress } from "@core/map/launchGuard"
import { confirmReplaceChat, focusChat, type MapLaunchDeps } from "@core/map/startMapAgentTask"

/**
 * Focus the chat sidebar and start a new agent task pre-seeded with a
 * ledger prompt (e.g. "check claim staleness for session X"). Mirrors
 * startPreviewAgentTask / startMapAgentTask — only the function name differs.
 */
export async function startLedgerAgentTask(
	controller: Controller,
	prompt: string,
	deps: MapLaunchDeps = { confirmReplace: confirmReplaceChat, focusChat },
): Promise<{ ok: boolean; error?: string; cancelled?: boolean }> {
	if (!prompt?.trim()) {
		return { ok: false, error: "Empty prompt" }
	}
	try {
		// Replacing the chat aborts running work and hides a pending ask: ask first (same guard as the map).
		if (isChatInProgress(controller.task) && !(await deps.confirmReplace())) {
			return { ok: false, cancelled: true, error: "Kept the current chat." }
		}
		await controller.clearTask()
		await controller.postStateToWebview()
		await deps.focusChat()
		await controller.initTask(prompt.trim(), [], [], undefined, undefined, { origin: "ledger" })
		return { ok: true }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error("[startLedgerAgentTask]", message)
		return { ok: false, error: message }
	}
}
