import type { Controller } from "@core/controller"

export interface ReplayShowOnMapDeps {
	show: (controller: Controller, runIds: unknown) => Promise<{ ok: boolean }>
	notify: (message: string) => void
}

/**
 * "Show on map" from the Replay panel. The main controller owns the map, so the same function the chat uses answers here.
 * Every outcome is said to the user: no controller (the main view is not up), or no layer from that run.
 */
export async function handleReplayShowOnMap(
	controller: Controller | undefined,
	runIds: unknown,
	deps: ReplayShowOnMapDeps,
): Promise<"shown" | "no-layer" | "no-controller"> {
	if (!controller) {
		deps.notify("The map is not available yet. Open the AI-Hydro view and try again.")
		return "no-controller"
	}
	const result = await deps.show(controller, runIds)
	if (!result.ok) {
		deps.notify("No layer on the map came from that run.")
		return "no-layer"
	}
	return "shown"
}
