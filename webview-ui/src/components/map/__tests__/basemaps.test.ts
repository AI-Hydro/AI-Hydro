import { describe, expect, it } from "vitest"
import {
	attributionFor,
	attributionList,
	BASE_MAP_STYLES,
	basemapCoverageStatus,
	coverageNoticeText,
	DEFAULT_BASEMAP_ID,
	extentContains,
	isKnownBaseMap,
	mapThemeFromBodyClasses,
	removedBaseMapReason,
	resolveBaseMap,
	US_EXTENT,
	US_EXTENTS,
} from "../basemaps"

describe("basemap catalogue", () => {
	it("every entry declares a native zoom the renderer can use as TileLayer.maxZoom", () => {
		for (const style of BASE_MAP_STYLES) {
			expect(Number.isInteger(style.maxNativeZoom), style.id).toBe(true)
			expect(style.maxNativeZoom, style.id).toBeGreaterThan(0)
			expect(style.maxNativeZoom, style.id).toBeLessThanOrEqual(19)
		}
	})

	it("every entry declares attribution, coverage, a terms note and an https URL with z/x/y placeholders", () => {
		for (const style of BASE_MAP_STYLES) {
			expect(style.attribution?.length, style.id).toBeGreaterThan(3)
			expect(["global", "us"], style.id).toContain(style.coverage)
			expect(style.terms.length, style.id).toBeGreaterThan(20)
			for (const url of [style.url, style.darkUrl].filter(Boolean) as string[]) {
				expect(url, style.id).toMatch(/^https:\/\//)
				for (const token of ["{z}", "{x}", "{y}"]) expect(url, style.id).toContain(token)
			}
			for (const overlay of style.overlays ?? []) {
				expect(overlay.attribution.length, overlay.id).toBeGreaterThan(3)
				expect(overlay.extents?.length ?? 0, overlay.id).toBeGreaterThan(0)
			}
		}
	})

	it("ids are unique and none reuses a removed id", () => {
		const ids = BASE_MAP_STYLES.map((s) => s.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const id of ids) expect(removedBaseMapReason(id), id).toBeUndefined()
	})

	it("US-only sources carry coverage boxes; global sources do not", () => {
		for (const id of ["usgs-topo", "usgs-imagery", "usgs-shaded-relief"]) {
			const style = BASE_MAP_STYLES.find((s) => s.id === id)
			expect(style?.coverage).toBe("us")
			expect(style?.extent).toEqual(US_EXTENT)
			expect(style?.extents).toEqual(US_EXTENTS)
		}
		for (const style of BASE_MAP_STYLES.filter((s) => s.coverage === "global")) {
			expect(style.extent, style.id).toBeUndefined()
			expect(style.extents, style.id).toBeUndefined()
		}
		expect(BASE_MAP_STYLES.filter((s) => s.coverage === "us").map((s) => s.id)).toEqual(
			BASE_MAP_STYLES.filter((s) => /^usgs-/.test(s.id)).map((s) => s.id),
		)
	})

	it("has no keyed endpoint: no key/token parameters, no key-requiring provider, CARTO removed", () => {
		for (const style of BASE_MAP_STYLES) {
			const urls = [style.url, style.darkUrl, ...(style.overlays ?? []).map((o) => o.url)].filter(Boolean) as string[]
			for (const url of urls) {
				expect(url, style.id).not.toMatch(/[?&](key|apikey|api_key|access_token|token)=/i)
				expect(url, style.id).not.toMatch(/^mapbox:|stadiamaps|cartocdn|cartodb|carto\.com/)
			}
			expect(style.id).not.toMatch(/mapbox|stadia|carto/)
			expect((style as { requiresKey?: boolean }).requiresKey, style.id).toBeUndefined()
		}
	})

	it("only uses the verified keyless tile hosts", () => {
		const hosts = new Set(
			BASE_MAP_STYLES.flatMap((s) => [s.url, s.darkUrl, ...(s.overlays ?? []).map((o) => o.url)])
				.filter(Boolean)
				.map((u) => new URL(u as string).host),
		)
		expect([...hosts].sort()).toEqual([
			"a.tile.openstreetmap.fr",
			"basemap.nationalmap.gov",
			"server.arcgisonline.com",
			"services.arcgisonline.com",
		])
	})

	it("the default is global, so a user outside the US never starts on a US-only source", () => {
		expect(BASE_MAP_STYLES[0].id).toBe(DEFAULT_BASEMAP_ID)
		expect(BASE_MAP_STYLES[0].coverage).toBe("global")
	})
})

describe("coverage", () => {
	const topo = resolveBaseMap("usgs-topo", "dark")
	it("a US-only basemap is outside coverage over India and covered over the US, Alaska and Puerto Rico", () => {
		expect(basemapCoverageStatus(topo, [60, 5, 95, 35])).toBe("outside")
		expect(basemapCoverageStatus(topo, [-95, 35, -85, 42])).toBe("covered")
		expect(basemapCoverageStatus(topo, [-155, 60, -145, 68])).toBe("covered")
		expect(basemapCoverageStatus(topo, [-67, 17.8, -66, 18.5])).toBe("covered")
	})
	it("a viewport that only partly overlaps coverage is covered", () => {
		expect(basemapCoverageStatus(topo, [-135, 40, -110, 55])).toBe("covered")
	})
	it("Canada and open ocean are outside (the boxes are tighter than the bounding extent)", () => {
		expect(basemapCoverageStatus(topo, [-100, 55, -95, 58])).toBe("outside")
	})
	it("global sources always cover", () => {
		expect(basemapCoverageStatus(resolveBaseMap(DEFAULT_BASEMAP_ID, "dark"), [60, 5, 95, 35])).toBe("covered")
		expect(basemapCoverageStatus(resolveBaseMap("esri-topo", "dark"), [60, 5, 95, 35])).toBe("covered")
	})
	it("the notice names the basemap and says it is US-only", () => {
		expect(coverageNoticeText(topo)).toBe("USGS Topo covers the United States only, so no tiles are shown here.")
	})
})

describe("removed providers", () => {
	it.each(["carto-light", "carto-dark", "carto-voyager"])("%s is gone, with the API-key reason", (id) => {
		expect(isKnownBaseMap(id)).toBe(false)
		expect(removedBaseMapReason(id)).toMatch(/API key/)
		expect(resolveBaseMap(id, "dark").id).toBe(DEFAULT_BASEMAP_ID)
	})
})

describe("resolveBaseMap", () => {
	it("the default is Esri Light/Dark Gray Canvas per theme, with the required attribution and a hydrography overlay", () => {
		const light = resolveBaseMap(DEFAULT_BASEMAP_ID, "light")
		const dark = resolveBaseMap(DEFAULT_BASEMAP_ID, "dark")
		expect(light.url).toContain("/Canvas/World_Light_Gray_Base/")
		expect(dark.url).toContain("/Canvas/World_Dark_Gray_Base/")
		expect(light.attribution).toContain("Esri")
		expect(light.maxNativeZoom).toBe(16)
		expect(light.overlays.map((o) => o.id)).toEqual(["usgs-hydro"])
		expect(light.overlays[0].extent).toEqual(US_EXTENT)
	})

	it("themeless entries are the same in both themes", () => {
		expect(resolveBaseMap("esri-topo", "light").url).toBe(resolveBaseMap("esri-topo", "dark").url)
	})

	it.each(["stadia-terrain", "mapbox-dark", "carto-dark", "", undefined, "nope"])(
		"an unavailable id (%s) resolves to the default, never to another provider",
		(id) => {
			expect(resolveBaseMap(id, "dark").id).toBe(DEFAULT_BASEMAP_ID)
			expect(isKnownBaseMap(id)).toBe(false)
		},
	)
})

describe("attribution reflects what is drawn", () => {
	const resolved = resolveBaseMap(DEFAULT_BASEMAP_ID, "dark")
	it("credits the hydrography overlay only where it covers the view", () => {
		expect(attributionFor(resolved, { lon: -90, lat: 39 })).toBe(
			`${resolved.attribution} · Hydrography: USGS The National Map`,
		)
		expect(attributionFor(resolved, { lon: 80, lat: 25 })).toBe(resolved.attribution)
	})
	it("does not credit the overlay over Canada, Mexico or ocean, but does over Alaska, Hawaii and Puerto Rico", () => {
		const base = resolved.attribution
		for (const [lon, lat] of [
			[-100, 56],
			[-102, 20],
			[-140, 35],
		])
			expect(attributionFor(resolved, { lon, lat })).toBe(base)
		for (const [lon, lat] of [
			[-150, 64],
			[-157.8, 21.3],
			[-66, 18.2],
		]) {
			expect(attributionFor(resolved, { lon, lat })).toContain("USGS")
		}
	})
	it("credits the overlay only once one of its tiles has loaded", () => {
		const view = { lon: -90, lat: 39 }
		expect(attributionFor(resolved, view, new Set())).toBe(resolved.attribution)
		expect(attributionFor(resolved, view, new Set(["usgs-hydro"]))).toContain("Hydrography: USGS")
		expect(attributionFor(resolved, { lon: 80, lat: 25 }, new Set(["usgs-hydro"]))).not.toContain("USGS")
	})
	it("an export lists the base and every overlay", () => {
		expect(attributionList(resolved)).toEqual([resolved.attribution, "Hydrography: USGS The National Map"])
	})
	it("extentContains is inclusive of the edges", () => {
		expect(extentContains(US_EXTENT, -64, 15)).toBe(true)
		expect(extentContains(US_EXTENT, 0, 0)).toBe(false)
	})
})

describe("mapThemeFromBodyClasses", () => {
	it("light only for a plain light theme; dark and high-contrast (either) use the dark base", () => {
		expect(mapThemeFromBodyClasses("vscode-light")).toBe("light")
		expect(mapThemeFromBodyClasses("vscode-dark")).toBe("dark")
		expect(mapThemeFromBodyClasses("vscode-dark vscode-high-contrast")).toBe("dark")
		expect(mapThemeFromBodyClasses("vscode-light vscode-high-contrast vscode-high-contrast-light")).toBe("dark")
		expect(mapThemeFromBodyClasses("")).toBe("dark")
	})
})
