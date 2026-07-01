import { describe, expect, it } from "vitest"
import { meshAnchorAndLocalPositions, meshTriangleCount } from "./meshCoordinates"

describe("meshCoordinates", () => {
	it("converts absolute lng/lat/z to meter offsets from anchor", () => {
		const mesh = {
			positions: [-69.5, 45.2, 300, -69.49, 45.21, 310],
			indices: [0, 1, 2],
		}
		const { anchor, positions } = meshAnchorAndLocalPositions(mesh)
		expect(anchor[0]).toBeCloseTo(-69.495, 3)
		expect(anchor[1]).toBeCloseTo(45.205, 3)
		expect(anchor[2]).toBeCloseTo(305, 3)
		expect(positions[0]).toBeLessThan(0)
		expect(positions[3]).toBeGreaterThan(0)
		expect(positions[2]).toBeCloseTo(-5, 1)
		expect(positions[5]).toBeCloseTo(5, 1)
	})

	it("counts triangles from indices", () => {
		expect(meshTriangleCount({ positions: [0, 0, 0], indices: [0, 1, 2, 0, 2, 3] })).toBe(2)
	})
})
