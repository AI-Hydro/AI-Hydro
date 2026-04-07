import { Empty } from "@shared/proto/cline/common"
import type { AddMapLayerRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."

/**
 * Adds a map layer and streams it to all subscribed clients
 */
export async function addMapLayer(controller: Controller, request: AddMapLayerRequest): Promise<Empty> {
	console.log("[addMapLayer] Adding layer:", request.layer?.id)

	if (!request.layer) {
		console.error("[addMapLayer] No layer provided in request")
		return Empty.create()
	}

	// Log layer information for debugging
	console.log("[addMapLayer] Layer data:", {
		id: request.layer.id,
		name: request.layer.name,
		layerType: request.layer.layerType,
		autoZoom: request.autoZoom,
		replaceExisting: request.replaceExisting,
	})

	// Add layer to controller storage and notify subscribers
	controller.addMapLayer(request.layer)

	if (request.autoZoom) {
		console.log("[addMapLayer] Auto-zoom requested for layer:", request.layer.id)
		// Auto-zoom is handled by the frontend MapView component
	}

	return Empty.create()
}
