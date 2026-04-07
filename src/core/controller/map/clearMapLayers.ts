import { Empty } from "@shared/proto/cline/common"
import type { ClearMapLayersRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/**
 * Clears all map layers
 */
export async function clearMapLayers(controller: Controller, _request: ClearMapLayersRequest): Promise<Empty> {
	console.log("[clearMapLayers] Clearing all layers")

	controller.clearMapLayers()

	return Empty.create()
}
