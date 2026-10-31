/**
 * "Show on map" from the chat: the map decides whether it may move the camera. A move while the user is reading or
 * working in the map is hostile (they lose their place), so the view only moves when the map has been left alone.
 */
export const IDLE_MS = 5000

export function mayMoveCamera(lastInteractionMs: number, nowMs: number, idleMs = IDLE_MS): boolean {
	return nowMs - lastInteractionMs >= idleMs
}

/** The host replays recent events on subscribe; a "show on map" older than this is stale and must not move the view. */
export const FOCUS_TTL_MS = 30_000
/** How long a request waits for its layers to arrive (the map may have just opened, still restoring layers). */
export const FOCUS_WAIT_MS = 15_000

export const focusExpired = (timestampMs: number | undefined, nowMs: number, ttlMs = FOCUS_TTL_MS): boolean =>
	!timestampMs || nowMs - timestampMs > ttlMs

/** What the map says after it shows layers. The text never claims a camera move that did not happen. */
export function focusLayersMessage(shown: number, requested: number, moved: boolean): string {
	if (shown === 0) {
		return "None of that run's layers are on this map."
	}
	const base = `Showing ${shown} layer${shown === 1 ? "" : "s"} from the run`
	const missing = requested > shown ? ` (${requested - shown} not on this map)` : ""
	return moved ? `${base}${missing}.` : `${base}${missing}. The view did not move; use Zoom to layer.`
}
