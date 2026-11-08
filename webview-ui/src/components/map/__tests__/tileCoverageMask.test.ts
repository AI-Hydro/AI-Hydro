import { describe, expect, it } from "vitest"
import { US_EXTENTS } from "../basemaps"
import { coverageRectsInTile, FEATHER_PX, mercatorPixel, tileIsFullyCovered } from "../tileCoverageMask"

const tileOf = (lon: number, lat: number, z: number) => {
	const p = mercatorPixel(lon, lat, z)
	return { z, x: Math.floor(p.x / 256), y: Math.floor(p.y / 256) }
}

describe("coverage feather geometry", () => {
	it("mercator pixel: the world is 256 * 2^z wide and the equator is the middle row", () => {
		expect(mercatorPixel(-180, 0, 3).x).toBe(0)
		expect(mercatorPixel(180, 0, 3).x).toBeCloseTo(2048)
		expect(mercatorPixel(0, 0, 3).y).toBeCloseTo(1024)
	})

	it("a tile in the middle of CONUS needs no mask", () => {
		const tile = tileOf(-96, 40, 9)
		expect(tileIsFullyCovered(coverageRectsInTile(tile, US_EXTENTS))).toBe(true)
	})

	it("a tile across 50N (Lake Manitoba) is masked: the coverage edge lies inside it", () => {
		const tile = tileOf(-98.3, 50.0, 8)
		const rects = coverageRectsInTile(tile, US_EXTENTS)
		expect(rects).toHaveLength(1)
		expect(tileIsFullyCovered(rects)).toBe(false)
		expect(rects[0].top).toBeGreaterThan(-FEATHER_PX)
		expect(rects[0].top).toBeLessThan(256)
		expect(rects[0].bottom).toBeGreaterThan(256)
	})

	it("a tile wholly outside every box has no rectangle at all", () => {
		expect(coverageRectsInTile(tileOf(-98.3, 55, 8), US_EXTENTS)).toEqual([])
	})
})
