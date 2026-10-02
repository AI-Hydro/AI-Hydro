import { EmptyRequest } from "@shared/proto/cline/common"
import { MapLayer } from "@shared/proto/cline/map"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from ".."

/** One ordered snapshot followed by live mutations; never interleave the two. */
export async function subscribeToMapLayers(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<MapLayer>,
	requestId?: string,
): Promise<void> {
	let active = true
	let initializing = true
	let unsubscribe = () => {}
	const pending: MapLayer[] = []
	let tail = Promise.resolve()
	const cleanup = () => {
		if (!active) return
		active = false
		pending.length = 0
		unsubscribe()
	}
	const send = (layer: MapLayer) => {
		tail = tail
			.then(async () => {
				if (active) await responseStream(layer, false)
			})
			.catch((error) => {
				console.error("[subscribeToMapLayers] stream failed:", error)
				cleanup()
			})
		return tail
	}
	unsubscribe = controller.subscribeToMapLayerUpdates((layer) => {
		if (!active) return
		if (initializing) pending.push(layer)
		else void send(layer)
	})
	if (requestId) getRequestRegistry().registerRequest(requestId, cleanup, { type: "map_layer_subscription" }, responseStream)
	const marker = (operation: string) => MapLayer.create({ id: "__map_sync__", metadata: { __operation: operation } })
	// Capture synchronously after subscribing, before any asynchronous delivery.
	const snapshot = [...controller.getMapLayers()]
	await send(marker("snapshot_start"))
	for (const layer of snapshot) await send(layer)
	await send(marker("snapshot_complete"))
	initializing = false
	for (const layer of pending.splice(0)) void send(layer)
	await tail
}
