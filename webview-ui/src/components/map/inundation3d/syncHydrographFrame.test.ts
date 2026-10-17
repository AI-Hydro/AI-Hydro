import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { hydrographFrameVisibilityUpdates, maxHydrographFrameIndex } from "./syncHydrographFrame"

const hydroLayer = (id: string, frame: number): MapLayer =>
	({
		id,
		name: id,
		layerType: "polygon",
		metadata: {
			tool: "map_flood_inundation_hydrograph",
			hydrograph_frame: String(frame),
		},
	}) as unknown as MapLayer

describe("syncHydrographFrame", () => {
	it("returns visibility updates for non-matching frames", () => {
		const layers = [hydroLayer("a", 0), hydroLayer("b", 1)]
		const visible = new Set(["a", "b"])
		const updates = hydrographFrameVisibilityUpdates(layers, 0, visible)
		expect(updates).toEqual([{ layerId: "b", visible: false }])
	})

	it("finds max frame index", () => {
		const layers = [hydroLayer("a", 0), hydroLayer("b", 3)]
		expect(maxHydrographFrameIndex(layers)).toBe(3)
	})
})
