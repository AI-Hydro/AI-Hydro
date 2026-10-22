import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

// Keep track of active focus pending prompt subscriptions
const focusPendingPromptSubscriptions = new Set<StreamingResponseHandler<Empty>>()

/**
 * Subscribe to focus pending prompt events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request
 */
export async function subscribeToFocusPendingPrompt(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	focusPendingPromptSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		focusPendingPromptSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "focus_pending_prompt_subscription" }, responseStream)
	}
}

/**
 * Send a focus pending prompt event to all active subscribers
 */
export async function sendFocusPendingPromptEvent(): Promise<void> {
	// Send the event to all active subscribers
	const promises = Array.from(focusPendingPromptSubscriptions).map(async (responseStream) => {
		try {
			const event = Empty.create({})
			await responseStream(
				event,
				false, // Not the last message
			)
		} catch (error) {
			console.error("Error sending focus pending prompt event:", error)
			// Remove the subscription if there was an error
			focusPendingPromptSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}
