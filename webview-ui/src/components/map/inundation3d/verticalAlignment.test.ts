import { describe, expect, it } from "vitest"
import { applyMeshVerticalOffset, terrainOffsetForManifest } from "./verticalAlignment"

describe("verticalAlignment", () => {
	it("shifts Z components only", () => {
		const shifted = applyMeshVerticalOffset({ positions: [1, 2, 10, 3, 4, 20], indices: [0, 1, 2] }, -28)
		expect(shifted.positions).toEqual([1, 2, -18, 3, 4, -8])
	})

	it("returns manifest offset for orthometric mesh", () => {
		expect(
			terrainOffsetForManifest({
				mesh_vertical_datum: "orthometric_navd88",
				terrain_vertical_offset_m: -28.5,
			}),
		).toBe(-28.5)
	})

	it("skips offset for ellipsoid mesh", () => {
		expect(
			terrainOffsetForManifest({
				mesh_vertical_datum: "ellipsoid_wgs84",
				terrain_vertical_offset_m: -28.5,
			}),
		).toBe(0)
	})
})
