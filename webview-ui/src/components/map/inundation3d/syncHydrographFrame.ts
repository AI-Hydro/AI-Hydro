import type { MapLayer } from "@shared/proto/cline/map"

export function hydrographFrameIndex(layer: MapLayer): number | null {
	const raw = layer.metadata?.hydrograph_frame
	if (raw === undefined || raw === "") {
		return null
	}
	const n = Number(raw)
	return Number.isFinite(n) ? n : null
}

export function isHydrographTimedLayer(layer: MapLayer): boolean {
	return layer.metadata?.tool === "map_flood_inundation_hydrograph" && hydrographFrameIndex(layer) !== null
}

/** Layer ids that should be visible for the selected hydrograph frame (3D playback). */
export function hydrographFrameVisibilityUpdates(
	layers: MapLayer[],
	frameIndex: number,
	visibleLayerIds: Set<string>,
): Array<{ layerId: string; visible: boolean }> {
	const updates: Array<{ layerId: string; visible: boolean }> = []
	for (const layer of layers) {
		if (!isHydrographTimedLayer(layer)) {
			continue
		}
		const frame = hydrographFrameIndex(layer)
		if (frame === null) {
			continue
		}
		const shouldShow = frame === frameIndex
		const isVisible = visibleLayerIds.has(layer.id)
		if (shouldShow !== isVisible) {
			updates.push({ layerId: layer.id, visible: shouldShow })
		}
	}
	return updates
}

export function maxHydrographFrameIndex(layers: MapLayer[]): number {
	let max = 0
	for (const layer of layers) {
		const frame = hydrographFrameIndex(layer)
		if (frame !== null && frame > max) {
			max = frame
		}
	}
	return max
}
