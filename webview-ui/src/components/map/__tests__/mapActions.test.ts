import { describe, expect, it } from "vitest"
import type { ClickedFeature } from "../FeatureIdentifier"
import { actionLabel, actionTooltip, MAP_ACTIONS, type MapObjectKind, mapActions, objectKind } from "../mapActions"

const f = (properties: Record<string, unknown>): ClickedFeature => ({ layerId: "l", layerName: "L", properties })
const KINDS: MapObjectKind[] = ["gauge", "river", "basin", "feature", "pin", "empty"]

describe("objectKind", () => {
	it("tells a gauge, a river reach, a basin, another feature, a pin and an empty point apart", () => {
		expect(objectKind([f({ site_no: "01013500" })])).toBe("gauge")
		expect(objectKind([f({ uparea: 120 })])).toBe("river")
		expect(objectKind([f({ area_km2: 40, method: "nldi" })])).toBe("basin")
		expect(objectKind([f({ name: "x" })])).toBe("feature")
		expect(objectKind([f({ name: "x" })], true)).toBe("pin")
		expect(objectKind([])).toBe("empty")
	})
})

describe("mapActions", () => {
	it("gives the card and the menu the same actions for every kind, except the card does not list Inspect", () => {
		for (const kind of KINDS) {
			const menu = mapActions(kind, "menu").map((a) => a.id)
			const card = mapActions(kind, "card").map((a) => a.id)
			expect(card, kind).toEqual(menu.filter((id) => id !== "inspect"))
		}
	})

	it("uses one label per verb", () => {
		expect(actionLabel("ask")).toBe("Ask AI-Hydro")
		expect(actionLabel("delineate")).toBe("Delineate")
		expect(actionLabel("delineate-quick")).toBe("Delineate without chat")
		const labels = Object.values(MAP_ACTIONS).map((a) => a.label)
		expect(new Set(labels).size).toBe(labels.length)
		for (const label of labels) expect(label).not.toMatch(/with agent|Delineate here|Quick|\(no chat\)|with AI-Hydro/)
	})

	it("starts every kind with Ask, then Delineate, so the card's two primary actions are the same everywhere", () => {
		for (const kind of KINDS) {
			expect(
				mapActions(kind, "card")
					.slice(0, 2)
					.map((a) => a.id),
				kind,
			).toEqual(["ask", "delineate"])
		}
	})

	it("offers a river no shapefile, and a pin only pin actions", () => {
		expect(mapActions("river").map((a) => a.id)).not.toContain("export-shapefile")
		expect(mapActions("pin").map((a) => a.id)).toEqual(["ask", "delineate", "rename-pin", "copy-coords", "remove-pin"])
	})

	it("puts the routing note in the Delineate tooltip, not on the card", () => {
		expect(actionTooltip("delineate", undefined, { lon: -90, lat: 40 })).toMatch(/NLDI first/)
		expect(actionTooltip("delineate", f({ uparea: 90_000 }), { lon: 10, lat: 50 })).toMatch(/hybrid/)
		expect(actionTooltip("ask", undefined, { lon: -90, lat: 40 })).not.toMatch(/Routing/)
	})
})
