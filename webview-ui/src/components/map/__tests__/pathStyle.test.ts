import { GeoJsonLayer, PathLayer } from "@deck.gl/layers"
import { describe, expect, it } from "vitest"
import { DASH_EXTENSION, DASHED } from "../pathStyle"

describe("dashed lines", () => {
	it("a PathLayer with PathStyleExtension carries getDashArray (a bare dashArray prop would be ignored)", () => {
		const layer = new PathLayer({
			id: "p",
			data: [],
			getPath: (d: any) => d,
			extensions: [DASH_EXTENSION],
			getDashArray: DASHED,
		} as any)
		expect((layer.props as any).getDashArray).toEqual([6, 4])
		expect(layer.props.extensions).toContain(DASH_EXTENSION)
	})

	it("a GeoJsonLayer with the extension keeps dashJustified and the dash pattern", () => {
		const layer = new GeoJsonLayer({
			id: "g",
			data: { type: "FeatureCollection", features: [] },
			extensions: [DASH_EXTENSION],
			getDashArray: DASHED,
			dashJustified: true,
		} as any)
		expect((layer.props as any).getDashArray).toEqual([6, 4])
		expect((layer.props as any).dashJustified).toBe(true)
	})

	it("the extension is configured for dashes", () => {
		expect((DASH_EXTENSION as any).opts?.dash).toBe(true)
	})
})
