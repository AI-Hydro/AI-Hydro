import type { MapRef } from "@shared/map/mapRef"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import {
	buildAnnotationAgentPrompt,
	buildAskAboutMapAgentPrompt,
	buildBatchAnnotationsAgentPrompt,
	buildDelineateAgentPrompt,
	type MapAgentInspectContext,
	type MapAnnotationContext,
	type MapBatchAnnotationsContext,
} from "./mapAgentPrompts"

export type { MapAgentInspectContext, MapAnnotationContext, MapBatchAnnotationsContext }

/** The study keys a layer carries: its catalogue study id and its source file (resolved host-side, never guessed). */
export function mapLayerStudyHint(layer: { metadata?: Record<string, string> } | undefined): MapAgentInspectContext["studyHint"] {
	const md = layer?.metadata
	const sessionId = md?.session_id?.trim()
	const artifactPath = (md?.source_path || md?.path || "").trim()
	if (!sessionId && !artifactPath) {
		return undefined
	}
	return { ...(sessionId ? { sessionId } : {}), ...(artifactPath ? { artifactPath } : {}) }
}

function newRequestId(): string {
	return `map-agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Start an agent task from the map and focus the chat sidebar (host handles initTask).
 */
export interface MapLaunchHint {
	/** The study id the clicked layer carries (layer catalogue). */
	sessionId?: string
	/** The clicked layer's source file (resolved to its study by the server's artifact manifest). */
	artifactPath?: string
	/** The user's own question when the prompt wraps it. */
	userQuestion?: string
	/** What was pointed at. An open chat gets this as one line; a new chat gets the full prompt. */
	ref?: MapRef
	/** The short text that leads the line added to an open chat. */
	composerText?: string
}

export type MapAgentStartResult = {
	ok: boolean
	error?: string
	cancelled?: boolean
	/** An open chat took the text into its input; no new chat was started. */
	addedToChat?: boolean
	/** The host's note, e.g. the layer is from another study than the chat's. */
	warning?: string
}

export function startMapAgentTask(prompt: string, launch?: MapLaunchHint): Promise<MapAgentStartResult> {
	const requestId = newRequestId()
	return new Promise((resolve) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			resolve({ ok: false, error: "Timed out waiting for agent task to start" })
		}, 60_000)

		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-map-agent-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			resolve({
				ok: Boolean(data.ok),
				error: data.error,
				cancelled: Boolean(data.cancelled),
				addedToChat: Boolean(data.addedToChat),
				warning: typeof data.warning === "string" ? data.warning : undefined,
			})
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-map-agent-task",
			requestId,
			prompt,
			...(launch ? { launch } : {}),
		})
	})
}

/** What the launch can say about the study the clicked layer belongs to (lookup keys only; the host resolves them). */
function launchHint(ctx: MapAgentInspectContext, userQuestion?: string, composerText?: string): MapLaunchHint | undefined {
	const hint: MapLaunchHint = {
		...(ctx.ref ? { ref: ctx.ref } : {}),
		...(ctx.ref && composerText ? { composerText } : {}),
		...(ctx.studyHint?.sessionId ? { sessionId: ctx.studyHint.sessionId } : {}),
		...(ctx.studyHint?.artifactPath ? { artifactPath: ctx.studyHint.artifactPath } : {}),
		...(userQuestion?.trim() ? { userQuestion: userQuestion.trim() } : {}),
	}
	return Object.keys(hint).length > 0 ? hint : undefined
}

export async function askAgentToDelineate(ctx: MapAgentInspectContext): Promise<MapAgentStartResult> {
	const prompt = buildDelineateAgentPrompt(ctx)
	return startMapAgentTask(prompt, launchHint(ctx, undefined, "Delineate the watershed at this point:"))
}

export async function askAgentAboutMap(ctx: MapAgentInspectContext, userQuestion?: string): Promise<MapAgentStartResult> {
	const prompt = buildAskAboutMapAgentPrompt({ ...ctx, userQuestion })
	return startMapAgentTask(prompt, launchHint(ctx, userQuestion, userQuestion?.trim() || "About this place:"))
}

export async function askAgentAboutTransect(
	ctx: import("./mapAgentPrompts").MapTransectContext,
): Promise<{ ok: boolean; error?: string }> {
	const { buildTransectAgentPrompt } = await import("./mapAgentPrompts")
	const prompt = buildTransectAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}

export async function askAgentAboutBatchTransects(
	ctx: import("./mapAgentPrompts").MapBatchTransectsContext,
): Promise<{ ok: boolean; error?: string }> {
	const { buildBatchTransectsAgentPrompt } = await import("./mapAgentPrompts")
	const prompt = buildBatchTransectsAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}

export async function askAgentAboutBatchAnnotations(ctx: MapBatchAnnotationsContext): Promise<{ ok: boolean; error?: string }> {
	const prompt = buildBatchAnnotationsAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}

export async function askAgentAboutAnnotation(ctx: MapAnnotationContext): Promise<{ ok: boolean; error?: string }> {
	const prompt = buildAnnotationAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}
