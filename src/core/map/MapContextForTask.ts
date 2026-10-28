import type { Controller } from "@core/controller"
import os from "os"
import type { MapEvent } from "@shared/proto/cline/map"

/** Hard cap on the whole block, separator included (X0-8 stop-gap, replaced by the MAP digest in Wave 2). */
export const MAP_CONTEXT_MAX_CHARS = 600
export const MAP_CONTEXT_TRUNCATION_MARKER = "…[map context truncated]"

const MAX_VISIBLE_LAYERS = 5
const MAX_ACTIVITY_ITEMS = 3
/** How far back to look for meaningful events once camera moves are filtered out. */
const ACTIVITY_WINDOW = 40

/** Facts the gate needs about the task asking for context. */
export interface MapContextRequest {
	/** The task's workspace / project folder. */
	taskCwd: string
	/** The chat was started from the map (its history origin is "map"). */
	launchedFromMap: boolean
	/** The user's message this turn refers to the map. */
	userReferencedMap: boolean
}

/** Camera movement is not research evidence: it changes on every pan and would defeat change detection. */
export function isCameraEvent(type: string | undefined): boolean {
	const t = type ?? ""
	return t === "view.changed" || t.startsWith("command.fit_") || t === "command.fly_to" || /pan|zoom|move/i.test(t)
}

const MAP_REFERENCE = /\b(maps?|basemaps?|layers?|viewport|map view|basin outline|choropleth|delineat\w*|drawn?|drawing)\b/i

/** True when this turn's user-authored text refers to the map. Tool results are not user text and never count. */
export function userMessageReferencesMap(userContent: ReadonlyArray<{ type: string; text?: string }>): boolean {
	return userContent.some((block) => {
		if (block.type !== "text" || !block.text) {
			return false
		}
		const markers = ["task", "feedback", "answer", "user_message"]
		return markers.some((tag) => {
			const open = block.text!.indexOf(`<${tag}>`)
			if (open < 0) {
				return false
			}
			const close = block.text!.indexOf(`</${tag}>`, open)
			const inner = block.text!.slice(open + tag.length + 2, close < 0 ? undefined : close)
			return MAP_REFERENCE.test(inner)
		})
	})
}

function normalizeRoot(p: string): string {
	let out = p.trim().replace(/\\/g, "/").replace(/\/+$/, "")
	if (process.platform === "win32" || process.platform === "darwin") {
		out = out.toLowerCase()
	}
	return out
}

/** Fewer path segments than this (after any drive letter) is too broad a parent to claim its children. */
const MIN_PARENT_DEPTH = 3

function isBroadRoot(normalized: string): boolean {
	const home = normalizeRoot(os.homedir())
	if (normalized === home) {
		return true
	}
	const segments = normalized
		.replace(/^[a-z]:/i, "")
		.split("/")
		.filter(Boolean)
	return segments.length < MIN_PARENT_DEPTH
}

/**
 * Same folder, or one contains the other (a project folder inside a workspace and vice versa). A containing folder
 * that is the home directory, a drive root or shallower than MIN_PARENT_DEPTH never claims its children.
 */
export function workspaceMatches(mapRoot: string, taskCwd: string): boolean {
	const a = normalizeRoot(mapRoot)
	const b = normalizeRoot(taskCwd)
	if (!a || !b) {
		return false
	}
	if (a === b) {
		return true
	}
	if (b.startsWith(`${a}/`)) {
		return !isBroadRoot(a)
	}
	if (a.startsWith(`${b}/`)) {
		return !isBroadRoot(b)
	}
	return false
}

function parsePayload(event: MapEvent): Record<string, unknown> {
	if (!event.payloadJson) {
		return {}
	}
	try {
		return JSON.parse(event.payloadJson) as Record<string, unknown>
	} catch {
		return {}
	}
}

function summarizeEvent(event: MapEvent): string {
	const payload = parsePayload(event)
	switch (event.type) {
		case "user.file_saved":
			return `saved vector ${String(payload.path ?? "")}`
		case "user.file_loaded":
			return `loaded ${String(payload.name ?? payload.path ?? "file")}`
		case "layer.geojson":
			return `layer added ${String(payload.name ?? payload.layerId ?? "")}`.trim()
		case "layer.visibility":
			return `toggled ${String(payload.layerId ?? "layer")}`
		case "inspect.click":
			return `feature selected (${String(payload.featureCount ?? 0)} features)`
		case "roi.set":
		case "roi.saved":
			return "region of interest set"
		case "roi.cleared":
			return "region of interest cleared"
		case "delineation.requested": {
			const lat = payload.lat
			const lon = payload.lon
			if (typeof lat === "number" && typeof lon === "number") {
				return `delineation requested at ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`
			}
			return "delineation requested"
		}
		case "delineation.started":
			return "delineation started"
		case "delineation.completed":
			return `delineation done (${String(payload.area_km2 ?? "")} km²)`
		default:
			return event.type || "map activity"
	}
}

/** Meaningful recent events, camera moves and the basemap switch (already a line of its own) removed. */
function meaningfulEvents(events: MapEvent[]): MapEvent[] {
	return events.filter((e) => !isCameraEvent(e.type) && e.type !== "basemap.changed")
}

/** Cut to `max` characters with a marker that is part of the budget, so the result is deterministic and never over. */
export function capWithMarker(text: string, max: number = MAP_CONTEXT_MAX_CHARS): string {
	if (text.length <= max) {
		return text
	}
	let head = text.slice(0, max - MAP_CONTEXT_TRUNCATION_MARKER.length)
	const last = head.charCodeAt(head.length - 1)
	if (last >= 0xd800 && last <= 0xdbff) {
		head = head.slice(0, -1) // never leave half a surrogate pair in front of the marker
	}
	return head + MAP_CONTEXT_TRUNCATION_MARKER
}

/**
 * Compact map context for the agent: the layers, the last selection and meaningful recent actions.
 *
 * Returns "" unless the map belongs to this chat: the map session's workspace matches the task folder, or the chat
 * was launched from the map, or the user referred to the map this turn (either of the last two wins even when the
 * folders differ). A basemap alone is never enough, and the pan/zoom view is left out (it changes constantly and says
 * nothing about the study).
 */
export function buildMapContextForTask(controller: Controller, request: MapContextRequest): string {
	const svc = controller.mapSessionService
	const belongs =
		workspaceMatches(svc.getWorkspaceRoot(), request.taskCwd) || request.launchedFromMap || request.userReferencedMap
	if (!belongs) {
		return ""
	}

	const events = meaningfulEvents(svc.getRecentEvents(ACTIVITY_WINDOW))
	const layers = controller.getMapLayers()
	const inspect = svc.getLastInspect()
	if (layers.length === 0 && events.length === 0 && !inspect) {
		return ""
	}

	const lines: string[] = ["## Map context"]

	const basemap = svc.getBasemap()
	if (basemap) {
		lines.push(`Basemap: ${basemap.name}`)
	}

	const visible = layers.filter((l) => l.visible !== false)
	if (layers.length > 0) {
		const hidden = layers.length - visible.length
		const shown = visible
			.slice(0, MAX_VISIBLE_LAYERS)
			.map((l) => `${l.id} "${l.name}" [${l.layerType || "vector"}]`)
			.join("; ")
		const more = visible.length > MAX_VISIBLE_LAYERS ? ` (+${visible.length - MAX_VISIBLE_LAYERS} more)` : ""
		lines.push(
			`Layers: ${layers.length} (${visible.length} visible${hidden > 0 ? `, ${hidden} hidden` : ""})${shown ? `: ${shown}${more}` : ""}`,
		)
		lines.push("Restyle existing layers by id instead of re-sending their data.")
	}

	if (inspect) {
		const props = Object.entries(inspect.featureProperties ?? {})
			.filter(([k]) => !k.startsWith("_"))
			.slice(0, 4)
			.map(([k, v]) => `${k}=${v}`)
			.join(", ")
		lines.push(
			`Selected: ${inspect.layerName ?? "feature"} at ${inspect.lat.toFixed(4)}°, ${inspect.lon.toFixed(4)}°${props ? ` (${props})` : ""}`,
		)
	}

	if (events.length > 0) {
		const recent = events
			.slice(-MAX_ACTIVITY_ITEMS)
			.map((e) => `${e.source || "user"}: ${summarizeEvent(e)}`)
			.join("; ")
		lines.push(`Recent map activity: ${recent}`)
	}

	return `\n\n${capWithMarker(lines.join("\n"), MAP_CONTEXT_MAX_CHARS - 2)}`
}

/**
 * Send-only-when-changed decision. `lastInjected` is the block this task sent last (undefined = none, or it was
 * lost to compaction). An identical block is re-sent only when the user referred to the map this turn.
 */
export function decideMapContextInjection(
	block: string,
	lastInjected: string | undefined,
	userReferencedMap: boolean,
): { inject: boolean; next: string | undefined } {
	if (!block) {
		return { inject: false, next: undefined }
	}
	if (block === lastInjected && !userReferencedMap) {
		return { inject: false, next: lastInjected }
	}
	return { inject: true, next: block }
}

/** A chat is map-launched when it was created from the map, now or in the history item it resumes. */
export function isMapLaunched(launch?: { origin?: string }, historyItem?: { origin?: string }): boolean {
	return (launch?.origin ?? historyItem?.origin) === "map"
}

/** The one place environment_details asks for map context: builds, dedups, and records what was sent. */
export function mapContextForEnvironmentDetails(
	controller: Controller,
	state: { lastInjectedMapContext?: string },
	taskCwd: string,
	launchedFromMap: boolean,
	userContent: ReadonlyArray<{ type: string; text?: string }>,
): string {
	const userReferencedMap = userMessageReferencesMap(userContent)
	const block = buildMapContextForTask(controller, { taskCwd, launchedFromMap, userReferencedMap })
	const decision = decideMapContextInjection(block, state.lastInjectedMapContext, userReferencedMap)
	state.lastInjectedMapContext = decision.next
	return decision.inject ? block : ""
}
