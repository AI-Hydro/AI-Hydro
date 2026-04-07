import { EmptyRequest } from "@shared/proto/cline/common"
import { MapStateResponse } from "@shared/proto/cline/map"
import type { Controller } from ".."

/**
 * Gets current map state
 */
export async function getMapState(controller: Controller, _request: EmptyRequest): Promise<MapStateResponse> {
	console.log("[getMapState] Retrieving current map state")

	const layers = controller.getMapLayers()

	return MapStateResponse.create({
		layers,
		layerCount: layers.length,
	})
}
