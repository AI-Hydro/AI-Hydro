import { describe, expect, it } from "vitest"
import {
	attributionFor,
	attributionList,
	BASE_MAP_STYLES,
	CARTO_ATTRIBUTION,
	DEFAULT_BASEMAP_ID,
	extentContains,
	isKnownBaseMap,
	mapThemeFromBodyClasses,
	resolveBaseMap,
	US_EXTENT,
} from "../basemaps"

describe("basemap catalogue", () => {
	it("every entry declares a native zoom the renderer can use as TileLayer.maxZoom", () => {
		for (const style of BASE_MAP_STYLES) {
			expect(Number.isInteger(style.maxNativeZoom), style.id).toBe(true)
			expect(style.maxNativeZoom, style.id).toBeGreaterThan(0)
			expect(style.maxNativeZoom, style.id).toBeLessThanOrEqual(19)
		}
	})

	it("US-only USGS caches carry the US extent; global sources do not", () => {
		for (const id of ["usgs-topo", "usgs-imagery", "usgs-shaded-relief"]) {
			expect(BASE_MAP_STYLES.find((s) => s.id === id)?.extent).toEqual(US_EXTENT)
		}
		expect(BASE_MAP_STYLES.find((s) => s.id === "esri-imagery")?.extent).toBeUndefined()
	})

	it("has no keyed provider: no Stadia, no Mapbox, nothing needing a token", () => {
		for (const style of BASE_MAP_STYLES) {
			expect(style.url, style.id).not.toMatch(/^mapbox:|stadiamaps/)
			expect(style.id).not.toMatch(/mapbox|stadia/)
		}
	})

	it("only uses tile hosts that were already in the catalogue", () => {
		const hosts = new Set(BASE_MAP_STYLES.flatMap((s) => [s.url, s.darkUrl, ...(s.overlays ?? []).map((o) => o.url)]).filter(Boolean).map((u) => new URL(u as string).host))
		expect([...hosts].sort()).toEqual([
			"a.basemaps.cartocdn.com",
			"a.tile.openstreetmap.fr",
			"basemap.nationalmap.gov",
			"server.arcgisonline.com",
			"services.arcgisonline.com",
		])
	})
})

describe("resolveBaseMap", () => {
	it("the default is Carto no-labels per theme, with the required attribution and a hydrography overlay", () => {
		const light = resolveBaseMap(DEFAULT_BASEMAP_ID, "light")
		const dark = resolveBaseMap(DEFAULT_BASEMAP_ID, "dark")
		expect(light.url).toContain("/light_nolabels/")
		expect(dark.url).toContain("/dark_nolabels/")
		expect(light.attribution).toBe("© OpenStreetMap contributors © CARTO")
		expect(CARTO_ATTRIBUTION).toBe(light.attribution)
		expect(light.overlays.map((o) => o.id)).toEqual(["usgs-hydro"])
		expect(light.overlays[0].extent).toEqual(US_EXTENT)
	})

	it("themeless entries are the same in both themes", () => {
		expect(resolveBaseMap("esri-topo", "light").url).toBe(resolveBaseMap("esri-topo", "dark").url)
	})

	it.each(["stadia-terrain", "mapbox-dark", "", undefined, "nope"])("an unavailable id (%s) resolves to the default, never to another provider", (id) => {
		expect(resolveBaseMap(id, "dark").id).toBe(DEFAULT_BASEMAP_ID)
		expect(isKnownBaseMap(id)).toBe(false)
	})
})

describe("attribution reflects what is drawn", () => {
	const resolved = resolveBaseMap(DEFAULT_BASEMAP_ID, "dark")
	it("credits the hydrography overlay only where it covers the view", () => {
		expect(attributionFor(resolved, { lon: -90, lat: 39 })).toBe("© OpenStreetMap contributors © CARTO · Hydrography: USGS The National Map")
		expect(attributionFor(resolved, { lon: 80, lat: 25 })).toBe("© OpenStreetMap contributors © CARTO")
	})
	it("an export lists the base and every overlay", () => {
		expect(attributionList(resolved)).toEqual(["© OpenStreetMap contributors © CARTO", "Hydrography: USGS The National Map"])
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
