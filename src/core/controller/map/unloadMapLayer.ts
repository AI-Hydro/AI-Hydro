import { UnloadMapLayerResponse, type UnloadMapLayerRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/** Unload: the layer leaves the map and its style and place are kept beside the catalog. The file on disk is not touched. */
export async function unloadMapLayer(controller: Controller, request: UnloadMapLayerRequest): Promise<UnloadMapLayerResponse> {
	const result = await controller.unloadMapLayer(request.layerId, {
		opacity: request.hasOpacity ? request.opacity : undefined,
		hidden: request.hidden,
		positionFromTop: request.positionFromTop >= 0 ? request.positionFromTop : undefined,
	})
	return UnloadMapLayerResponse.create(result)
}
