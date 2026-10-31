import type { Controller } from "@core/controller"
import { parseMapRef, stripInvisible } from "@shared/map/mapRef"
import { type MapLaunchContext, startMapAgentTask } from "./startMapAgentTask"

/** Strings only, bounded: the hint comes from a webview and is passed to the server as a lookup key. */
function cleanHint(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() && value.length <= 1024 ? value.trim() : undefined
}

export function parseMapLaunch(raw: unknown): MapLaunchContext | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined
	}
	const r = raw as Record<string, unknown>
	const sessionId = cleanHint(r.sessionId)
	const artifactPath = cleanHint(r.artifactPath)
	const questionClean = typeof r.userQuestion === "string" ? stripInvisible(r.userQuestion).trim() : ""
	const userQuestion = questionClean ? questionClean.slice(0, 4000) : undefined
	const ref = parseMapRef(r.ref)
	const composerClean = typeof r.composerText === "string" ? stripInvisible(r.composerText).trim() : ""
	const composerText = composerClean ? composerClean.slice(0, 1000) : undefined
	if (!sessionId && !artifactPath && !userQuestion && !ref && !composerText) {
		return undefined
	}
	return {
		...(userQuestion ? { userQuestion } : {}),
		...(ref ? { ref } : {}),
		...(composerText ? { composerText } : {}),
		...(sessionId || artifactPath
			? { studyHint: { ...(sessionId ? { sessionId } : {}), ...(artifactPath ? { artifactPath } : {}) } }
			: {}),
	}
}

export async function handleMapAgentTaskMessage(
	controller: Controller,
	message: { requestId?: string; prompt?: string; launch?: unknown },
	postMessage: (response: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
	const requestId = message.requestId ?? "unknown"
	const prompt = typeof message.prompt === "string" ? message.prompt : ""
	const result = await startMapAgentTask(controller, prompt, parseMapLaunch(message.launch))
	await postMessage({
		type: "aihydro-map-agent-result",
		requestId,
		ok: result.ok,
		error: result.error,
		cancelled: result.cancelled === true,
		addedToChat: result.addedToChat === true,
		warning: result.warning,
	})
}
