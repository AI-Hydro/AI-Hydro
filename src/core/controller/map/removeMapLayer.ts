import { Empty } from "@shared/proto/cline/common"
import type { RemoveMapLayerRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/**
 * Removes a map layer
 */
export async function removeMapLayer(controller: Controller, request: RemoveMapLayerRequest): Promise<Empty> {
	console.log("[removeMapLayer] Removing layer:", request.layerId)

	if (!request.layerId) {
		console.error("[removeMapLayer] No layer ID provided in request")
		return Empty.create()
	}

	controller.removeMapLayer(request.layerId)

	return Empty.create()
}
