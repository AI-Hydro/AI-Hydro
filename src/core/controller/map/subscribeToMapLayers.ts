import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapLayer } from "@shared/proto/cline/map"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from ".."

// Keep track of active map layer subscriptions
const activeMapLayerSubscriptions = new Set<StreamingResponseHandler<MapLayer>>()

/**
 * Subscribes to map layer updates via streaming
 * This is a server-to-client streaming RPC
 */
export async function subscribeToMapLayers(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<MapLayer>,
	requestId?: string,
): Promise<void> {
	console.log("[subscribeToMapLayers] Client subscribed to map layer updates", requestId)

	// Add this subscription to the active subscriptions
	activeMapLayerSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeMapLayerSubscriptions.delete(responseStream)
		console.log("[subscribeToMapLayers] Cleaned up layer subscription")
	}

	// Register the cleanup function with the request registry
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "map_layer_subscription" }, responseStream)
	}

	// Subscribe to layer updates from controller
	const unsubscribe = controller.subscribeToMapLayerUpdates(async (layer: MapLayer) => {
		// Only send to this specific subscription if it's still active
		if (activeMapLayerSubscriptions.has(responseStream)) {
			console.log(`[subscribeToMapLayers] Streaming layer to client: ${layer.id}`)
			try {
				await responseStream(layer, false) // Not the last message
			} catch (error) {
				console.error("[subscribeToMapLayers] Error streaming layer:", error)
				activeMapLayerSubscriptions.delete(responseStream)
				unsubscribe()
			}
		}
	})

	// Send all existing layers to the new subscriber
	const existingLayers = controller.getMapLayers()
	for (const layer of existingLayers) {
		try {
			await responseStream(layer, false)
		} catch (error) {
			console.error("[subscribeToMapLayers] Error sending existing layer:", error)
			activeMapLayerSubscriptions.delete(responseStream)
			unsubscribe()
			return
		}
	}

	console.log(`[subscribeToMapLayers] Sent ${existingLayers.length} existing layers to subscriber`)
}
