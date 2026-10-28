import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const post = vi.hoisted(() => vi.fn())
vi.mock("../../../config/platform.config", () => ({ PLATFORM_CONFIG: { postMessage: post } }))

import { askAgentAboutMap, askAgentToDelineate, mapLayerStudyHint } from "../mapAgentBridge"

const ctx = { lat: 45, lon: -69.5, studyHint: { sessionId: "try", artifactPath: "/w/ws.geojson" } }

/** Answer the bridge's request the way the host does. */
function replyWith(result: Record<string, unknown>) {
	post.mockImplementation((msg: { requestId: string }) => {
		queueMicrotask(() =>
			window.dispatchEvent(
				new MessageEvent("message", { data: { type: "aihydro-map-agent-result", requestId: msg.requestId, ...result } }),
			),
		)
	})
}

describe("map agent launch (X0-2)", () => {
	beforeEach(() => post.mockReset())
	afterEach(() => vi.restoreAllMocks())

	it("sends the clicked layer's study keys and the user's question to the host, not inside the prompt", async () => {
		replyWith({ ok: true })
		await askAgentAboutMap(ctx, "  why so small? ")
		const msg = post.mock.calls[0][0]
		expect(msg.type).toBe("aihydro-map-agent-task")
		expect(msg.launch).toEqual({ sessionId: "try", artifactPath: "/w/ws.geojson", userQuestion: "why so small?" })
		expect(msg.prompt).not.toContain("/w/ws.geojson")
	})

	it("sends no launch when the layer carries no study keys", async () => {
		replyWith({ ok: true })
		await askAgentToDelineate({ lat: 45, lon: -69.5 })
		expect("launch" in post.mock.calls[0][0]).toBe(false)
	})

	it("reports that the user kept the running chat", async () => {
		replyWith({ ok: false, cancelled: true, error: "Kept the current chat." })
		const r = await askAgentToDelineate(ctx)
		expect(r).toMatchObject({ ok: false, cancelled: true })
	})

	it("reads the study keys from layer metadata", () => {
		expect(mapLayerStudyHint({ metadata: { session_id: " try ", source_path: "/w/a.geojson" } })).toEqual({
			sessionId: "try",
			artifactPath: "/w/a.geojson",
		})
		expect(mapLayerStudyHint({ metadata: { path: "/w/b.tif" } })).toEqual({ artifactPath: "/w/b.tif" })
		expect(mapLayerStudyHint({ metadata: {} })).toBeUndefined()
		expect(mapLayerStudyHint(undefined)).toBeUndefined()
	})
})
