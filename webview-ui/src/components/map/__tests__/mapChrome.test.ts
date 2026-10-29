import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import {
	defaultChromeState,
	hasTimeTaggedLayers,
	isFloodLayer,
	layoutFor,
	PANEL_WIDTH,
	panelModeFor,
	panelWidthFor,
	RAIL_WIDTH,
	toolDisabledReason,
} from "../mapChrome"

const layer = (metadata: Record<string, string> = {}): MapLayer =>
	({ id: "l", name: "l", layerType: "polygon", visible: true, geojson: "", metadata }) as MapLayer

describe("panel placement follows the map width", () => {
	it("docks from 960, floats from 600, and is a sheet below", () => {
		expect([1920, 1280, 960].map(panelModeFor)).toEqual(["docked", "docked", "docked"])
		expect([959, 800, 600].map(panelModeFor)).toEqual(["overlay", "overlay", "overlay"])
		expect([599, 400, 320].map(panelModeFor)).toEqual(["sheet", "sheet", "sheet"])
	})

	it("defaults to the rail from 800 and to collapsed below", () => {
		expect([800, 1280].map(defaultChromeState)).toEqual(["rail", "rail"])
		expect([799, 400].map(defaultChromeState)).toEqual(["collapsed", "collapsed"])
	})
})

describe("one panel width", () => {
	it("is 300 px, never more than 40% of the map, and always inside 260-380 when the map allows", () => {
		expect(PANEL_WIDTH).toMatchObject({ default: 300, min: 260, max: 380 })
		expect(panelWidthFor(1920)).toBe(300)
		expect(panelWidthFor(960)).toBe(300)
		expect(panelWidthFor(800)).toBe(300)
		// 40% of 700 is 280: the cap wins over the default.
		expect(panelWidthFor(700)).toBe(280)
		// 40% of 600 is 240, below the 260 floor: the cap still wins, so a narrow overlay cannot swallow the map.
		expect(panelWidthFor(600)).toBe(240)
		for (const w of [600, 700, 800, 960, 1280, 1920]) expect(panelWidthFor(w)).toBeLessThanOrEqual(Math.floor(w * 0.4))
	})
})

describe("layout", () => {
	it("a docked panel makes the canvas give up the panel and the rail, so the stage is the map minus both", () => {
		const open = layoutFor(1280, null, true)
		expect(open).toMatchObject({
			state: "rail",
			mode: "docked",
			panelWidth: 300,
			railReserve: RAIL_WIDTH,
			dockReserve: 300,
			stageInset: 340,
		})
		const closed = layoutFor(1280, null, false)
		expect(closed).toMatchObject({ dockReserve: 0, stageInset: RAIL_WIDTH })
	})

	it("an overlay panel never shrinks the canvas, only the rail column does", () => {
		expect(layoutFor(800, null, true)).toMatchObject({ mode: "overlay", dockReserve: 0, stageInset: RAIL_WIDTH })
	})

	it("collapsed and hidden reserve no rail; hidden also shows no panel", () => {
		expect(layoutFor(1280, "collapsed", true)).toMatchObject({
			state: "collapsed",
			railReserve: 0,
			dockReserve: 300,
			stageInset: 300,
		})
		expect(layoutFor(1280, "hidden", true)).toMatchObject({ state: "hidden", railReserve: 0, dockReserve: 0, stageInset: 0 })
	})

	it("a bottom sheet forces the rail to collapsed and takes nothing from the canvas", () => {
		expect(layoutFor(400, "rail", true)).toMatchObject({ state: "collapsed", mode: "sheet", panelWidth: 0, stageInset: 0 })
		// An explicit choice of hidden is still honoured in a sheet.
		expect(layoutFor(400, "hidden", true).state).toBe("hidden")
	})

	it("the user's choice beats the width default", () => {
		expect(layoutFor(1280, "collapsed", false).state).toBe("collapsed")
		expect(layoutFor(700, "rail", false).state).toBe("rail")
	})
})

describe("conditional tools", () => {
	it("swipe needs a layer", () => {
		expect(toolDisabledReason("swipe", [])).toMatch(/Needs a layer/)
		expect(toolDisabledReason("swipe", [layer()])).toBeUndefined()
	})

	it("time needs a time-tagged layer", () => {
		expect(toolDisabledReason("time", [layer()])).toBe("No time-tagged layers")
		expect(hasTimeTaggedLayers([layer({ time_start: "2020-01-01" })])).toBe(true)
		expect(toolDisabledReason("time", [layer({ time_start: "2020-01-01" })])).toBeUndefined()
	})

	it("flood needs a flood layer, recognised the way the old badge did", () => {
		expect(toolDisabledReason("flood", [layer()])).toBe("No flood layers")
		for (const metadata of [{ tool: "map_flood_inundation" }, { source: "HAND+SRC" }, { stage_lookup_json: "{}" }] as Record<
			string,
			string
		>[]) {
			expect(isFloodLayer(layer(metadata))).toBe(true)
			expect(toolDisabledReason("flood", [layer(metadata)])).toBeUndefined()
		}
	})
})
