import type { Controller } from "@core/controller"
import { layerRunId } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"

/** Run ids accepted from a webview: the charset the Replay link uses, and a small cap (a tool card names one run). */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_RUNS = 20

export function parseRunIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) {
		return []
	}
	return [...new Set(raw.filter((v): v is string => typeof v === "string" && RUN_ID.test(v)))].slice(0, MAX_RUNS)
}

/** The layers a set of runs made, by the run id each layer's metadata carries. The webview never names a layer. */
export function layersForRuns(layers: MapLayer[], runIds: string[]): MapLayer[] {
	const wanted = new Set(runIds)
	return layers.filter((layer) => {
		const run = layerRunId(layer.metadata)
		return !!run && wanted.has(run)
	})
}

export interface ShowOnMapDeps {
	openMap: () => Promise<void>
	now: () => number
}

const defaultDeps: ShowOnMapDeps = {
	openMap: async () => {
		const { VscodeMapPanelProvider } = await import("@/hosts/vscode/VscodeMapPanelProvider")
		await VscodeMapPanelProvider.createOrShow()
	},
	now: () => Date.now(),
}

/**
 * "On map" from a tool card or a claim: open the map and tell it which layers to show. The map makes them visible,
 * selects the first and fits to them only when the user is not working in the map (the map decides; the host cannot
 * see the user's pointer). Returns the layer ids, empty when no layer carries one of the runs.
 */
export async function showRunsOnMap(
	controller: Controller,
	rawRunIds: unknown,
	deps: ShowOnMapDeps = defaultDeps,
): Promise<{ ok: boolean; layerIds: string[] }> {
	const runIds = parseRunIds(rawRunIds)
	const layerIds = layersForRuns(controller.getMapLayers(), runIds).map((l) => l.id)
	if (layerIds.length === 0) {
		return { ok: false, layerIds }
	}
	await deps.openMap()
	controller.mapSessionService.appendEvent({
		type: "command.focus_layers",
		payloadJson: JSON.stringify({ layerIds, runIds }),
		timestampMs: deps.now(),
		source: "user",
	})
	return { ok: true, layerIds }
}
