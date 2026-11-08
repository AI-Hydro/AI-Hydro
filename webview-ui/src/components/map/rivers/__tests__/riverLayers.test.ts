import { describe, expect, it } from "vitest"
import { RiverTileReader, type RiverTileSegments } from "../pmtilesRivers"
import { buildRiverLayers, firstAtOrAbove, type RiverLayerInputs } from "../riverLayers"

const reader = new RiverTileReader("https://example.test/s.pmtiles", {
	fetchImpl: async () => new Response("x", { status: 500 }),
})
const base: RiverLayerInputs = {
	theme: "light",
	zoom: 5,
	reader,
	degraded: false,
	retry: 0,
	onTileLoad: () => undefined,
	onTileError: () => undefined,
}
const ids = (input: Partial<RiverLayerInputs>) => buildRiverLayers({ ...base, ...input }).map((l) => (l as { id: string }).id)

describe("buildRiverLayers", () => {
	it("zoom below 3: bundled rivers and lakes, no streamed tile layer", () => {
		expect(ids({ zoom: 2 })).toEqual(["rivers-ne-lakes-light", "rivers-ne-rivers-light"])
	})
	it("zoom 3 to 6: streamed tiles plus the bundled lakes only (the two river generalisations never draw together)", () => {
		expect(ids({ zoom: 5 })).toEqual(["rivers-ne-lakes-light", "basemap-rivers-light-0"])
	})
	it("zoom 7 and deeper: streamed tiles alone (the base map draws lakes)", () => {
		expect(ids({ zoom: 9 })).toEqual(["basemap-rivers-light-0"])
	})
	it("degraded: bundled rivers and lakes at every zoom, and no streamed layer to keep requesting tiles", () => {
		for (const zoom of [1, 5, 9, 13])
			expect(ids({ zoom, degraded: true })).toEqual(["rivers-ne-lakes-light", "rivers-ne-rivers-light"])
	})
	it("the theme is in the ids, so a theme switch redraws", () => {
		expect(ids({ zoom: 9, theme: "dark" })).toEqual(["basemap-rivers-dark-0"])
		expect(ids({ zoom: 9, retry: 2 })).toEqual(["basemap-rivers-light-2"])
	})
	it("the streamed layer reads 512 px tiles from zoom 3 to the archive's zoom 12 and is rebuilt per order band", () => {
		const [layer] = buildRiverLayers({ ...base, zoom: 9 }) as { props: Record<string, unknown> }[]
		expect(layer.props.tileSize).toBe(512)
		expect(layer.props.minZoom).toBe(3)
		expect(layer.props.maxZoom).toBe(12)
		expect(layer.props.updateTriggers).toEqual({ renderSubLayers: ["light", 1] })
		const tile = (buildRiverLayers({ ...base, zoom: 4, theme: "dark" }) as { props: Record<string, unknown> }[])[1]
		expect(tile.props.updateTriggers).toEqual({ renderSubLayers: ["dark", 7] })
	})
	it("sub-layers keep only the segments at or above the zoom band's order, coloured and sized by order", () => {
		const segments = [1, 3, 5, 8].map((order, i) => ({
			order,
			riverId: i,
			path: [
				[0, 0],
				[1, 1],
			] as [number, number][],
		}))
		const tileLayer = (
			buildRiverLayers({ ...base, zoom: 5 }) as {
				props: { renderSubLayers: (p: unknown) => { props: Record<string, any> } }
			}[]
		)[1]
		// zoom 5 shows order 6+, so only the order-8 river remains.
		const sub = tileLayer.props.renderSubLayers({ id: "t", data: segments })
		expect(sub.props.data.map((d: { order: number }) => d.order)).toEqual([8])
		expect(sub.props.getWidth(sub.props.data[0])).toBeCloseTo(3.4)
		expect(sub.props.getColor(sub.props.data[0])).toHaveLength(4)
		expect(sub.props.widthUnits).toBe("pixels")
		// An empty tile (open ocean) draws nothing.
		expect(tileLayer.props.renderSubLayers({ id: "t", data: [] })).toBeNull()
	})
	it("no reader means the bundled tier", () => {
		expect(ids({ zoom: 9, reader: null })).toEqual(["rivers-ne-rivers-light"])
	})
})

describe("firstAtOrAbove", () => {
	const seg = (order: number) => ({ order, riverId: 0, path: [] }) as RiverTileSegments[number]
	const list = [1, 1, 2, 4, 4, 7, 9].map(seg)
	it("finds the first segment at or above an order in an ascending list", () => {
		expect(firstAtOrAbove(list, 1)).toBe(0)
		expect(firstAtOrAbove(list, 2)).toBe(2)
		expect(firstAtOrAbove(list, 3)).toBe(3)
		expect(firstAtOrAbove(list, 4)).toBe(3)
		expect(firstAtOrAbove(list, 8)).toBe(6)
		expect(firstAtOrAbove(list, 10)).toBe(7)
		expect(firstAtOrAbove([], 5)).toBe(0)
	})
})
