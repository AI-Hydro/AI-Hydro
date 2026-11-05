import type { MapLayer } from "@shared/proto/cline/map"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { AttributeTable } from "../layerPanelParts"

afterEach(cleanup)

const layerOf = (geojson: string) =>
	({ id: "x", name: "x", layerType: "polygon", visible: true, geojson, metadata: {} }) as unknown as MapLayer

describe("AttributeTable", () => {
	it("says a bare geometry has no attributes, not that the layer has no features", () => {
		render(
			<AttributeTable
				border="#444"
				fg="#ccc"
				layer={layerOf('{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}')}
			/>,
		)
		expect(screen.getByText("This file has geometry but no attributes.")).toBeInTheDocument()
		expect(screen.queryByText("No features in this layer.")).toBeNull()
	})

	it("still says no features for an empty collection", () => {
		render(<AttributeTable border="#444" fg="#ccc" layer={layerOf('{"type":"FeatureCollection","features":[]}')} />)
		expect(screen.getByText("No features in this layer.")).toBeInTheDocument()
	})
})
