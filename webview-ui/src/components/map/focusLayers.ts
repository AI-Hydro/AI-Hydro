/**
 * "Show on map" from the chat: the map decides whether it may move the camera. A move while the user is reading or
 * working in the map is hostile (they lose their place), so the view only moves when the map has been left alone.
 */
export const IDLE_MS = 5000

export function mayMoveCamera(lastInteractionMs: number, nowMs: number, idleMs = IDLE_MS): boolean {
	return nowMs - lastInteractionMs >= idleMs
}

/** What the map says after it shows layers. The text never claims a camera move that did not happen. */
export function focusLayersMessage(shown: number, requested: number, moved: boolean): string {
	if (shown === 0) {
		return "None of that run's layers are on this map."
	}
	const base = `Showing ${shown} layer${shown === 1 ? "" : "s"} from the run`
	const missing = requested > shown ? ` (${requested - shown} not on this map)` : ""
	return moved ? `${base}${missing}.` : `${base}${missing}. The view did not move; use Zoom to layer.`
}
