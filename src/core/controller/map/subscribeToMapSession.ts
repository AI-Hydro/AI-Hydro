import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapSessionState } from "@shared/proto/cline/map"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import type { Controller } from ".."

export async function subscribeToMapSession(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<MapSessionState>,
	requestId?: string,
): Promise<void> {
	await controller.refreshMapSessionWorkspaceRoot()
	let active = true
	let unsubscribe = () => {}
	let tail = Promise.resolve()
	const cleanup = () => {
		if (!active) return
		active = false
		unsubscribe()
	}
	const send = (state: MapSessionState) => {
		tail = tail
			.then(async () => {
				if (active) await responseStream(state, false)
			})
			.catch((error) => {
				console.error("[subscribeToMapSession] stream failed:", error)
				cleanup()
			})
	}
	// Queue initial state before subscribing, without yielding between these operations.
	send(controller.mapSessionService.buildSnapshot(controller.getMapLayers()))
	unsubscribe = controller.mapSessionService.subscribeToSession((state) => {
		if (!active) return
		const full = controller.mapSessionService.buildSnapshot(controller.getMapLayers())
		full.activeRoi = state.activeRoi ?? full.activeRoi
		full.view = state.view ?? full.view
		full.visibleLayerIds = state.visibleLayerIds ?? full.visibleLayerIds
		send(full)
	})
	if (requestId) getRequestRegistry().registerRequest(requestId, cleanup, { type: "map_session_subscription" }, responseStream)
	await tail
}
