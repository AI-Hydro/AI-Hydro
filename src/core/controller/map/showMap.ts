import { Empty } from "@shared/proto/cline/common"
import type { ShowMapRequest } from "@shared/proto/cline/map"
import type { Controller } from ".."
import { sendMapButtonClickedEvent } from "../ui/subscribeToMapButtonClicked"

/**
 * Switches to map view
 */
export async function showMap(_controller: Controller, _request: ShowMapRequest): Promise<Empty> {
	console.log("[showMap] Showing map view")

	await sendMapButtonClickedEvent()

	return Empty.create()
}
