import { expect, it, vi } from "vitest"
import { clusterGeoJSON, LayerClusterCache } from "../layerClusterCache"

it("invalidates equal-count replacement data and reuses unchanged source within a zoom level", () => {
	const cache = new LayerClusterCache()
	const build = vi.fn().mockReturnValueOnce("old cluster").mockReturnValueOnce("new cluster")
	expect(cache.get("a", "[1,2]", 4.1, build)).toBe("old cluster")
	expect(cache.get("a", "[1,2]", 4.8, build)).toBe("old cluster")
	expect(cache.get("a", "[3,4]", 4.8, build)).toBe("new cluster")
	expect(build).toHaveBeenCalledTimes(2)
})
it("drops removed layers and recomputes for a changed zoom", () => {
	const cache = new LayerClusterCache()
	const build = vi.fn(() => ({}))
	cache.get("a", "data", 4, build)
	cache.get("a", "data", 5, build)
	cache.retain(new Set())
	cache.get("a", "data", 5, build)
	expect(build).toHaveBeenCalledTimes(3)
})

it("preserves singleton station attributes and non-point geometry", () => {
	const station = {
		type: "Feature",
		id: "g1",
		geometry: { type: "Point", coordinates: [0, 0] },
		properties: { flow: 5, units: "m3/s" },
	}
	const river = {
		type: "Feature",
		geometry: {
			type: "LineString",
			coordinates: [
				[0, 0],
				[1, 1],
			],
		},
		properties: { name: "river" },
	}
	const output = clusterGeoJSON({ type: "FeatureCollection", features: [station, river] }, 4)
	expect(output.features).toContainEqual(station)
	expect(output.features).toContainEqual(river)
})
it("marks clusters as display-only without assigning one station's flow to the aggregate", () => {
	const features = [0.1, 0.2].map((x, i) => ({
		type: "Feature",
		id: `g${i}`,
		geometry: { type: "Point", coordinates: [x, 0.1] },
		properties: { flow: 10 + i, _clusterCount: 999 },
	}))
	const output = clusterGeoJSON({ type: "FeatureCollection", features }, 4)
	expect(output.features).toHaveLength(1)
	expect(output.features[0].properties).toEqual({
		_clustered: true,
		_clusterCount: 2,
		_clusterAggregation: "display-only",
		_clusterMemberIds: ["g0", "g1"],
	})
	expect(clusterGeoJSON({ type: "FeatureCollection", features }, 8).features).toBe(features)
})
