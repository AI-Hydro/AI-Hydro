import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_BASEMAP_ID } from "../basemaps"
import {
	DEFAULT_MAP_VIEW,
	initialBasemap,
	loadMapWorkspace,
	migrateWorkspace,
	sanitizePersistedViewState,
	sanitizeViewStateForDeck,
	saveMapWorkspace,
} from "../mapWorkspace"

describe("mapWorkspace viewState sanitization", () => {
	it("strips deserialized transitionInterpolator poison", () => {
		const poisoned = {
			longitude: -70,
			latitude: 45,
			zoom: 9,
			transitionDuration: 2000,
			transitionInterpolator: {},
		}
		const safe = sanitizeViewStateForDeck(poisoned as any, DEFAULT_MAP_VIEW)
		expect(safe.longitude).toBe(-70)
		expect(safe.latitude).toBe(45)
		expect(safe.zoom).toBe(9)
		expect(safe.transitionDuration).toBeUndefined()
		expect(safe.transitionInterpolator).toBeUndefined()
	})

	it("sanitizePersistedViewState keeps only camera scalars", () => {
		const safe = sanitizePersistedViewState({
			longitude: 1,
			latitude: 2,
			zoom: 3,
			pitch: 4,
			bearing: 5,
			transitionDuration: 500,
			transitionInterpolator: {},
		} as any)
		expect(safe).toEqual({
			longitude: 1,
			latitude: 2,
			zoom: 3,
			pitch: 4,
			bearing: 5,
		})
	})

	it("loadMapWorkspace rewrites poisoned transition fields from localStorage", () => {
		const key = "aihydro.map.workspace.v1"
		const poisoned = JSON.stringify({
			version: 1,
			viewState: {
				longitude: -95,
				latitude: 40,
				zoom: 4,
				transitionDuration: 2000,
				transitionInterpolator: {},
			},
		})
		localStorage.setItem(key, poisoned)
		const ws = loadMapWorkspace()
		expect(ws.viewState?.transitionInterpolator).toBeUndefined()
		expect(ws.viewState?.transitionDuration).toBeUndefined()
		const rewritten = JSON.parse(localStorage.getItem(key) || "{}")
		expect(rewritten.viewState.transitionInterpolator).toBeUndefined()
		localStorage.removeItem(key)
	})
})

describe("mapWorkspace schema v2 (basemap migration)", () => {
	const KEY = "aihydro.map.workspace.v1"
	const read = () => JSON.parse(localStorage.getItem(KEY) || "{}")
	afterEach(() => localStorage.removeItem(KEY))

	it("migrates a v1 profile ONCE: the old basemap is dropped, explicit starts false, version becomes 2", () => {
		localStorage.setItem(KEY, JSON.stringify({ version: 1, basemap: "usgs-imagery", viewState: { longitude: 1, latitude: 2, zoom: 3 } }))
		const ws = loadMapWorkspace()
		expect(ws.version).toBe(2)
		expect(ws.basemap).toBeUndefined()
		expect(ws.basemapExplicit).toBe(false)
		expect(ws.viewState?.zoom).toBe(3) // other state survives
		expect(read()).toMatchObject({ version: 2, basemapExplicit: false })
		expect(read().basemap).toBeUndefined()
		expect(initialBasemap(ws)).toEqual({ id: DEFAULT_BASEMAP_ID, explicit: false })
	})

	it("after the migration an explicit user choice always wins and survives reloads", () => {
		localStorage.setItem(KEY, JSON.stringify({ version: 1, basemap: "usgs-imagery" }))
		loadMapWorkspace() // migration
		saveMapWorkspace({ basemap: "esri-topo", basemapExplicit: true })
		const ws = loadMapWorkspace()
		expect(ws.basemap).toBe("esri-topo")
		expect(initialBasemap(ws)).toEqual({ id: "esri-topo", explicit: true })
		expect(loadMapWorkspace().basemap).toBe("esri-topo") // no second migration
	})

	it("Reset to hydrology default: clearing the explicit flag restores the default", () => {
		saveMapWorkspace({ basemap: "esri-topo", basemapExplicit: true })
		saveMapWorkspace({ basemap: undefined, basemapExplicit: false })
		expect(initialBasemap(loadMapWorkspace())).toEqual({ id: DEFAULT_BASEMAP_ID, explicit: false })
	})

	it("a v2 basemap that is not marked explicit is ignored", () => {
		localStorage.setItem(KEY, JSON.stringify({ version: 2, basemap: "esri-topo" }))
		expect(initialBasemap(loadMapWorkspace())).toEqual({ id: DEFAULT_BASEMAP_ID, explicit: false })
	})

	it("an explicit choice that is no longer in the catalogue (Stadia, Mapbox) falls back to the default", () => {
		localStorage.setItem(KEY, JSON.stringify({ version: 2, basemap: "stadia-terrain", basemapExplicit: true }))
		expect(initialBasemap(loadMapWorkspace())).toEqual({ id: DEFAULT_BASEMAP_ID, explicit: false })
	})

	it("migrateWorkspace rejects non-objects and unknown versions", () => {
		expect(migrateWorkspace(null)).toBeNull()
		expect(migrateWorkspace([])).toBeNull()
		expect(migrateWorkspace({ version: 9 })).toBeNull()
	})
})
