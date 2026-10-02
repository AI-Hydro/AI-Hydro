import { version as uuidVersion, validate as validateUuid } from "uuid"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { ProtoBusClient } from "../grpc-client-base"

class TestProtoBusClient extends ProtoBusClient {
	static override serviceName = "test.Service"
}

describe("ProtoBusClient request identity", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("uses a UUID v4 to correlate a unary response", async () => {
		const postMessage = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation(() => undefined)
		const responsePromise = TestProtoBusClient.makeUnaryRequest(
			"GetValue",
			{ value: "request" },
			(request) => request,
			(response) => response as { value: string },
		)

		expect(postMessage).toHaveBeenCalledOnce()
		const request = postMessage.mock.calls[0][0]
		const requestId = request.grpc_request.request_id

		expect(validateUuid(requestId)).toBe(true)
		expect(uuidVersion(requestId)).toBe(4)

		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "grpc_response",
					grpc_response: {
						request_id: requestId,
						message: { value: "response" },
						is_streaming: false,
					},
				},
			}),
		)

		await expect(responsePromise).resolves.toEqual({ value: "response" })
	})
})
