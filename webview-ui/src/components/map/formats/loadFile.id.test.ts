import { describe, expect, it } from "vitest"
import { fileLayerId } from "./loadFile"

const idFor = (name: string, path?: string) => fileLayerId(name, { source: path ? { path } : undefined })

describe("a file layer's id", () => {
	it("keeps same-named files in different folders apart, and the same file together", () => {
		const one = idFor("watershed.geojson", "/w/g1/watershed.geojson")
		expect(one).not.toBe(idFor("watershed.geojson", "/w/g2/watershed.geojson"))
		expect(idFor("watershed.geojson", "/w/g1/./watershed.geojson")).toBe(one)
		expect(one).toMatch(/^user-watershed-[0-9a-f]{6}$/)
	})

	it("a file with no path keeps the name-only id", () => {
		expect(idFor("watershed.geojson")).toBe("user-watershed")
	})
})
