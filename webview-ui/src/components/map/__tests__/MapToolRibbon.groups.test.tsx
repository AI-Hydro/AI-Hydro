import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
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

describe("MapToolRibbon single active panel", () => {
	const lit = () =>
		within(screen.getByRole("navigation", { name: "Map tools" }))
			.getAllByRole("button")
			.filter((b) => b.getAttribute("aria-pressed") === "true")
			.map((b) => b.getAttribute("aria-label"))

	it("never lights two items: opening another tool replaces the first", () => {
		setWidth(1280)
		render(<MapToolRibbon {...props} />)
		fireEvent.click(screen.getByRole("button", { name: "Search" }))
		expect(lit()).toEqual(["Search"])
		fireEvent.click(screen.getByRole("button", { name: "Transect profile" }))
		expect(lit()).toEqual(["Transect profile"])
		fireEvent.click(screen.getByRole("button", { name: "Transect profile" }))
		expect(lit()).toEqual([])
	})

	it("leaving Measure or Draw ends that mode, so nothing keeps running behind another panel", () => {
		setWidth(1280)
		const onMeasureModeChange = vi.fn()
		const onDrawModeChange = vi.fn()
		render(<MapToolRibbon {...props} onDrawModeChange={onDrawModeChange} onMeasureModeChange={onMeasureModeChange} />)
		fireEvent.click(screen.getByRole("button", { name: "Measure" }))
		fireEvent.click(screen.getByRole("button", { name: "Search" }))
		expect(onMeasureModeChange).toHaveBeenCalledWith(null)
		fireEvent.click(screen.getByRole("button", { name: "Draw geometry" }))
		fireEvent.click(screen.getByRole("button", { name: "Close panel" }))
		expect(onDrawModeChange).toHaveBeenCalledWith(null)
	})

	it("is controlled by MapView: the open panel comes from activeTool and changes are reported", () => {
		setWidth(1280)
		const onActiveToolChange = vi.fn()
		const { rerender } = render(<MapToolRibbon {...props} activeTool="search" onActiveToolChange={onActiveToolChange} />)
		expect(lit()).toEqual(["Search"])
		fireEvent.click(screen.getByRole("button", { name: "Export snapshot" }))
		expect(onActiveToolChange).toHaveBeenCalledWith("export")
		expect(lit()).toEqual(["Search"]) // still the parent's value until it changes it
		rerender(<MapToolRibbon {...props} activeTool="export" onActiveToolChange={onActiveToolChange} />)
		expect(lit()).toEqual(["Export snapshot"])
	})
})

describe("MapToolRibbon layer badge", () => {
	it("counts visible layers only and the tooltip says N visible · M hidden", () => {
		setWidth(1280)
		render(<MapToolRibbon {...props} layerCount={99} visibleLayerCount={3} />)
		const button = screen.getByRole("button", { name: /^Layer manager/ })
		expect(button).toHaveAttribute("title", "Layer manager (3 visible · 96 hidden)")
		expect(button.querySelector(".map-ribbon-badge")?.textContent).toBe("3")
	})

	it("shows 0 visible rather than the host total when everything is hidden", () => {
		setWidth(1280)
		render(<MapToolRibbon {...props} layerCount={120} visibleLayerCount={0} />)
		expect(screen.getByRole("button", { name: /^Layer manager/ }).querySelector(".map-ribbon-badge")?.textContent).toBe("0")
	})

	it("has no badge when the host holds no layers", () => {
		setWidth(1280)
		render(<MapToolRibbon {...props} layerCount={0} visibleLayerCount={0} />)
		expect(screen.getByRole("button", { name: "Layer manager" }).querySelector(".map-ribbon-badge")).toBeNull()
	})
})

describe("MapToolRibbon basemap panel", () => {
	it("offers Reset to hydrology default once the user has chosen a basemap", () => {
		setWidth(1280)
		const reset = vi.fn()
		render(
			<MapToolRibbon {...props} activeTool="basemap" basemapExplicit currentBasemap="esri-topo" onBasemapReset={reset} />,
		)
		fireEvent.click(screen.getByRole("button", { name: "Reset to hydrology default" }))
		expect(reset).toHaveBeenCalledOnce()
	})

	it("disables the reset while the hydrology default is in use", () => {
		setWidth(1280)
		render(<MapToolRibbon {...props} activeTool="basemap" currentBasemap="muted-hydro" onBasemapReset={() => {}} />)
		expect(screen.getByRole("button", { name: "Reset to hydrology default" })).toBeDisabled()
	})

	it("lists no Mapbox or Stadia entry", () => {
		setWidth(1280)
		render(<MapToolRibbon {...props} activeTool="basemap" onBasemapReset={() => {}} />)
		const panel = document.querySelector(".map-ribbon-panel") as HTMLElement
		expect(panel.textContent).not.toMatch(/Mapbox|Stadia/)
		expect(panel.textContent).toContain("Hydrology default (muted)")
	})
})
