import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MapToolRibbon } from "../MapToolRibbon"

const props: any = {
	layerCount: 2,
	layers: [],
	visibleLayerIds: new Set<string>(),
	layerOrder: [],
	mapStyle: "dark",
	currentBasemap: "usgs-topo",
	onBasemapChange: vi.fn(),
	onVisibilityChange: vi.fn(),
	onZoomToLayer: vi.fn(),
	onReorder: vi.fn(),
	viewState: { longitude: 0, latitude: 0, zoom: 3 },
	layerOpacities: {},
	getMapCanvas: () => null,
	renderIssues: [],
	rasterRevision: 0,
}

const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: w })
afterEach(() => {
	cleanup()
	setWidth(1024)
})

describe("MapToolRibbon grouping", () => {
	it("has the five labelled groups with codicon buttons and no emoji", () => {
		setWidth(1280)
		const { container } = render(<MapToolRibbon {...props} />)
		const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))
		expect(groups).toEqual(["Layers & basemap", "Navigate & search", "Measure & analyse", "Time & compare", "Export"])
		expect(container.textContent ?? "").not.toMatch(/\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u)
		for (const b of within(screen.getByRole("navigation", { name: "Map tools" })).getAllByRole("button")) {
			expect(b.querySelector(".codicon")).not.toBeNull()
			expect(b.getAttribute("aria-label")).toBeTruthy()
		}
	})

	it("shows text labels at 800px and wider, icon-only with aria-labels below", () => {
		setWidth(1280)
		const wide = render(<MapToolRibbon {...props} />)
		expect(screen.getByRole("button", { name: "Export snapshot" })).toHaveTextContent("Export")
		wide.unmount()
		setWidth(600)
		render(<MapToolRibbon {...props} />)
		const narrow = screen.getByRole("button", { name: "Export snapshot" })
		expect(narrow.textContent).toBe("")
		expect(narrow).toHaveAttribute("title", "Export snapshot")
	})
})
