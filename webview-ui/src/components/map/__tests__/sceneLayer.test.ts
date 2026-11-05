import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { sceneLayerForOpen } from "../sceneLayer"

const layer = (metadata: Record<string, string>) =>
	({ id: "t", name: "t", layerType: "line", visible: true, metadata }) as MapLayer

describe("sceneLayerForOpen", () => {
	it("drops a forged _fact_keys from a scene file's layer and keeps the rest", () => {
		const out = sceneLayerForOpen(
			layer({ _run_id: "r1", tool: "gauge_flowlines", gauge_id: "01013500", _fact_keys: "gauge_id" }),
		)
		expect(out.metadata).toEqual({ _run_id: "r1", tool: "gauge_flowlines", gauge_id: "01013500" })
	})
	it("returns a layer with no stamp as it is", () => {
		const l = layer({ note: "x" })
		expect(sceneLayerForOpen(l)).toBe(l)
	})
})
