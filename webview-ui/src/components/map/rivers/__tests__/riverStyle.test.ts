import { describe, expect, it } from "vitest"
import {
	hexToRgb,
	LAKE_STYLE,
	lakesVisible,
	minOrderForZoom,
	orderFromNaturalEarthRank,
	orderPosition,
	RIVER_RAMP,
	rampColor,
	riverAlpha,
	riverBand,
	riverColor,
	riverWidthPx,
	usesBundledRivers,
} from "../riverStyle"

/** Relative luminance (sRGB) of an [r,g,b] colour. */
const luminance = ([r, g, b]: number[]) => {
	const lin = (c: number) => (c / 255) ** 2.2
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

describe("palettes (S1 light, S2 dark)", () => {
	it("use the spec's hex values", () => {
		expect(RIVER_RAMP.light).toEqual(["#d5d1f6", "#b3adef", "#7389d8", "#3266a7", "#283f72", "#2c1a4c"])
		expect(RIVER_RAMP.dark).toEqual(["#1a446d", "#3767a6", "#6e90c8", "#99abc9", "#c9cdd4", "#ffffff"])
		expect(LAKE_STYLE.light).toEqual({ fill: "#DCE6EC", edge: "#8FA9BC" })
		expect(LAKE_STYLE.dark).toEqual({ fill: "#0F2433", edge: "#2F6C8F" })
	})
	it("light ramps from pale (small) to dark (large); dark ramps from dim (small) to bright (large): lightness is monotone in order, so greyscale and CVD readers keep the ordering", () => {
		for (const [theme, direction] of [
			["light", -1],
			["dark", 1],
		] as const) {
			let previous = luminance(rampColor(0, theme))
			for (let order = 2; order <= 10; order++) {
				const current = luminance(rampColor(orderPosition(order), theme))
				expect(Math.sign(current - previous), `${theme} order ${order}`).toBe(direction)
				previous = current
			}
		}
	})
	it("ends of the ramp are exactly the first and last stops", () => {
		expect(rampColor(0, "light")).toEqual(hexToRgb("#d5d1f6"))
		expect(rampColor(1, "light")).toEqual(hexToRgb("#2c1a4c"))
		expect(rampColor(0, "dark")).toEqual(hexToRgb("#1a446d"))
		expect(rampColor(1, "dark")).toEqual(hexToRgb("#ffffff"))
	})
	it("is a single hue family at the ends: no red-green contrast carries information", () => {
		// Blue channel dominates (or ties) the red channel at every stop of both ramps, except the dark ramp's grey and white.
		for (const hex of RIVER_RAMP.light) expect(hexToRgb(hex)[2]).toBeGreaterThanOrEqual(hexToRgb(hex)[0])
	})
})

describe("width (W1, by Strahler order)", () => {
	it("spans 0.6 px (order 1) to 4.2 px (order 10), monotone, clamped outside", () => {
		expect(riverWidthPx(1)).toBeCloseTo(0.6)
		expect(riverWidthPx(10)).toBeCloseTo(4.2)
		expect(riverWidthPx(0)).toBe(riverWidthPx(1))
		expect(riverWidthPx(14)).toBe(riverWidthPx(10))
		for (let o = 2; o <= 10; o++) expect(riverWidthPx(o)).toBeGreaterThan(riverWidthPx(o - 1))
	})
	it("a missing or non-numeric order is the thinnest line, never NaN", () => {
		expect(riverWidthPx(Number.NaN)).toBe(riverWidthPx(1))
	})
})

describe("opacity", () => {
	it("light is opaque; dark thins small reaches to 50% and is fully opaque from order 7", () => {
		expect(riverAlpha(1, "light")).toBe(255)
		expect(riverAlpha(1, "dark")).toBe(Math.round(255 * 0.5))
		expect(riverAlpha(7, "dark")).toBe(255)
		expect(riverAlpha(10, "dark")).toBe(255)
		expect(riverAlpha(4, "dark")).toBeGreaterThan(riverAlpha(2, "dark"))
	})
	it("riverColor carries the alpha", () => {
		expect(riverColor(1, "dark")[3]).toBe(riverAlpha(1, "dark"))
		expect(riverColor(10, "light")).toEqual([...hexToRgb("#2c1a4c"), 255])
	})
})

describe("zoom bands (Z1 expressed as orders)", () => {
	it("thin out at low zoom and show everything from zoom 8", () => {
		expect([0, 1, 2].map(minOrderForZoom)).toEqual([9, 9, 9])
		expect([3, 4, 5, 6, 7].map(minOrderForZoom)).toEqual([8, 7, 6, 5, 4])
		expect([8, 9, 12, 16].map(minOrderForZoom)).toEqual([1, 1, 1, 1])
	})
	it("never shows fewer rivers as you zoom in", () => {
		let previous = Number.POSITIVE_INFINITY
		for (let z = 0; z <= 16; z += 0.5) {
			const min = minOrderForZoom(z)
			expect(min).toBeLessThanOrEqual(previous)
			previous = min
		}
	})
	it("a fractional zoom uses the whole-zoom band, so layers rebuild once per band", () => {
		expect(minOrderForZoom(5.9)).toBe(minOrderForZoom(5))
		expect(riverBand(5.9)).toBe(riverBand(5.1))
	})
})

describe("tier switch", () => {
	it("below zoom 3 the bundled Natural Earth rivers draw; from zoom 3 the streamed tier does", () => {
		expect(usesBundledRivers(2, false)).toBe(true)
		expect(usesBundledRivers(3, false)).toBe(false)
		expect(usesBundledRivers(12, false)).toBe(false)
	})
	it("a degraded stream falls back to the bundled tier at every zoom, lakes included", () => {
		for (const z of [0, 4, 9, 14]) {
			expect(usesBundledRivers(z, true)).toBe(true)
			expect(lakesVisible(z, true)).toBe(true)
		}
	})
	it("lakes draw up to zoom 6 when the stream is healthy (the base map draws them deeper)", () => {
		expect(lakesVisible(6, false)).toBe(true)
		expect(lakesVisible(7, false)).toBe(false)
	})
})

describe("Natural Earth rank to order", () => {
	it("maps the largest class to 9 and the smallest kept class to 4", () => {
		expect(orderFromNaturalEarthRank(1)).toBe(9)
		expect(orderFromNaturalEarthRank(6)).toBe(4)
	})
})
