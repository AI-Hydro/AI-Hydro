import { layerRunId } from "@shared/map/provenanceEnvelope"
import type { MapLayer } from "@shared/proto/cline/map"
import { useMemo } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { useOptionalMapLayers } from "../../context/MapContext"

/** The layers a set of runs made. */
export function layersOfRuns(layers: MapLayer[], runIds: string[]): MapLayer[] {
	const wanted = new Set(runIds.filter(Boolean))
	return wanted.size === 0 ? [] : layers.filter((layer) => wanted.has(layerRunId(layer.metadata) ?? ""))
}

/** Ask the host to open the map and show the layers these runs made. The host finds the layers itself. */
export function showRunsOnMap(runIds: string[]): void {
	PLATFORM_CONFIG.postMessage({ type: "aihydro-show-on-map", run_ids: runIds })
}

/** How many map layers a set of runs made, and the action that shows them. `count` is 0 when none are on the map. */
export function useRunLayers(runIds: string[]): { count: number; show: () => void } {
	const layers = useOptionalMapLayers()
	const key = runIds.join("|")
	const count = useMemo(() => layersOfRuns(layers, runIds).length, [layers, key])
	return { count, show: () => showRunsOnMap(runIds) }
}
