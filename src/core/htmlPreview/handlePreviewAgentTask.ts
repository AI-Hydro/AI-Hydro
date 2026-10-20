import type { Controller } from "@core/controller"
import { startPreviewAgentTask } from "./startPreviewAgentTask"

/**
 * Handles the `aihydro-preview-agent-task` postMessage from the preview
 * webview panel. Mirrors `handleMapAgentTaskMessage` in
 * `src/core/map/handleMapAgentTask.ts`.
 *
 * Trust gate: a document can hand work to the agent only when it is trusted and
 * the user has allowed execution for it. The webview additionally requires a
 * user click on a visible prompt; the host re-checks the document so a request
 * for an unknown, static or unsigned document is refused no matter who sent it.
 */
export async function handlePreviewAgentTaskMessage(
	controller: Controller,
	message: { requestId?: string; prompt?: string; artifactId?: string },
	postMessage: (response: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
	const requestId = message.requestId ?? "unknown"
	const prompt = typeof message.prompt === "string" ? message.prompt : ""
	const artifactId = typeof message.artifactId === "string" ? message.artifactId : ""
	if (!artifactId || !controller.getArtifactPreviewService().canExecute(artifactId)) {
		await postMessage({
			type: "aihydro-preview-agent-result",
			requestId,
			ok: false,
			error: "denied: this document is not allowed to start an agent task",
		})
		return
	}
	const result = await startPreviewAgentTask(controller, prompt)
	await postMessage({
		type: "aihydro-preview-agent-result",
		requestId,
		ok: result.ok,
		error: result.error,
	})
}
