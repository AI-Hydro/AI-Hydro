import { describe, expect, it } from "vitest"
import { naturalEarthHydro } from "../naturalEarthHydro"

describe("bundled Natural Earth hydrography", () => {
	const { rivers, lakes } = naturalEarthHydro()

	it("holds the 1:50m rivers and lakes the build script wrote", () => {
		expect(rivers.length).toBeGreaterThan(500)
		expect(lakes.length).toBeGreaterThan(300)
	})
	it("every vertex is a valid lon/lat and every line has two or more", () => {
		for (const river of rivers) {
			expect(river.path.length).toBeGreaterThanOrEqual(2)
			for (const [lon, lat] of river.path) {
				expect(lon).toBeGreaterThanOrEqual(-180)
				expect(lon).toBeLessThanOrEqual(180)
				expect(lat).toBeGreaterThanOrEqual(-90)
				expect(lat).toBeLessThanOrEqual(90)
			}
		}
	})
	it("larger rivers sort last so they draw on top", () => {
		const orders = rivers.map((r) => r.order)
		expect(orders).toEqual([...orders].sort((a, b) => a - b))
		expect(Math.max(...orders)).toBe(9)
	})
	it("contains the Mississippi and the Great Lakes (spot check by location)", () => {
		const near = (lon: number, lat: number, tol = 0.6) =>
			rivers.some((r) => r.path.some(([x, y]) => Math.abs(x - lon) < tol && Math.abs(y - lat) < tol))
		expect(near(-90.2, 38.7)).toBe(true) // Mississippi at St. Louis
		const lakeContains = (lon: number, lat: number) =>
			lakes.some((rings) => {
				const ring = rings[0]
				let inside = false
				for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
					const [xi, yi] = ring[i]
					const [xj, yj] = ring[j]
					if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
				}
				return inside
			})
		expect(lakeContains(-87.5, 47.7)).toBe(true) // Lake Superior
		expect(lakeContains(-90.2, 38.7)).toBe(false) // St. Louis is not in a lake
	})
	it("is decoded once", () => {
		expect(naturalEarthHydro()).toBe(naturalEarthHydro())
	})
})
