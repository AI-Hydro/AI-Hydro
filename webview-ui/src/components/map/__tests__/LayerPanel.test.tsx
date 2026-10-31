import type { MapLayer } from "@shared/proto/cline/map"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const removeMapLayer = vi.fn(() => Promise.resolve({}))
const addMapLayer = vi.fn(() => Promise.resolve({}))
const state: { layers: MapLayer[] } = { layers: [] }
const context = {
	get layers() {
		return state.layers
	},
	restoreState: { hydrating: false, olderCount: 0 },
	addLayer: vi.fn((l: MapLayer) => state.layers.push(l)),
	removeLayer: vi.fn((id: string) => {
		state.layers = state.layers.filter((l) => l.id !== id)
	}),
	clearLayers: vi.fn(),
	restoreOlderLayers: vi.fn(),
}
vi.mock("../../../context/MapContext", () => ({ useMapContext: () => context }))
vi.mock("../../../services/grpc-client", () => ({
	MapServiceClient: {
		removeMapLayer: (...a: unknown[]) => (removeMapLayer as any)(...a),
		addMapLayer: (...a: unknown[]) => (addMapLayer as any)(...a),
		clearMapLayers: vi.fn(() => Promise.resolve({})),
		listWorkspaceGeoFiles: vi.fn(() => Promise.resolve({ files: [], totalCount: 0 })),
		saveRoiToWorkspace: vi.fn(),
	},
	FileServiceClient: { openFile: vi.fn() },
}))

import { PLATFORM_CONFIG } from "../../../config/platform.config"
import { LayerPanelContent } from "../LayerPanel"

const poly = (id: string, name: string, metadata: Record<string, string> = {}): MapLayer =>
	({
		id,
		name,
		layerType: "polygon",
		visible: true,
		geojson: '{"type":"FeatureCollection","features":[]}',
		metadata: { tool: "delineate_watershed", _run_id: "run-7f3a.1", provenance_path: "/p.json", ...metadata },
	}) as unknown as MapLayer

const baseProps = () => ({
	onVisibilityChange: vi.fn(),
	onOpacityChange: vi.fn(),
	visibleLayerIds: new Set(state.layers.map((l) => l.id)),
	layerOrder: [] as string[],
	onReorder: vi.fn(),
})

beforeEach(() => {
	localStorage.clear()
	state.layers = [
		poly("a", "watershed_01031500_basin_boundary_nldi_merit_snap_v2_long"),
		poly("b", "gauge", { source: "user", tool: "", _run_id: "" }),
	]
	removeMapLayer.mockClear()
	addMapLayer.mockClear()
})
afterEach(cleanup)

describe("LayerPanel", () => {
	it("is one row per layer with the full name reachable, and no emoji, status chips or per-row delete", () => {
		const { container } = render(<LayerPanelContent {...baseProps()} />)
		const rows = container.querySelectorAll("li.map-layer-row")
		expect(rows.length).toBe(2)
		expect(
			screen
				.getByRole("button", { name: /^watershed_01031500_basin_boundary_nldi_merit_snap_v2_long/ })
				.getAttribute("title"),
		).toContain("watershed_01031500_basin_boundary_nldi_merit_snap_v2_long")
		expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u)
		expect(screen.queryByText("Analysis output")).toBeNull()
		expect(screen.queryByTitle("Remove layer")).toBeNull()
		// The opacity slider is not open on every row.
		expect(container.querySelectorAll('input[type="range"]').length).toBe(0)
	})

	it("groups by origin, and a group collapses", () => {
		render(<LayerPanelContent {...baseProps()} />)
		expect(screen.getByRole("button", { name: /Tool output/ })).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByRole("button", { name: /Loaded by you/ })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /Tool output/ }))
		expect(screen.getByRole("button", { name: /Tool output/ })).toHaveAttribute("aria-expanded", "false")
		expect(document.querySelector('[data-layer-id="a"]')).toBeNull()
	})

	it("selecting a row reveals its opacity and style; selecting again closes it", () => {
		const props = baseProps()
		render(<LayerPanelContent {...props} />)
		fireEvent.click(screen.getByRole("button", { name: /^watershed_01031500/ }))
		const settings = screen.getByRole("group", { name: /^Settings for watershed_01031500/ })
		fireEvent.change(within(settings).getByRole("slider"), { target: { value: "0.5" } })
		expect(props.onOpacityChange).toHaveBeenCalledWith("a", 0.5)
		expect(within(settings).getByRole("button", { name: "Style" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /^watershed_01031500/ }))
		expect(screen.queryByRole("group", { name: /^Settings for/ })).toBeNull()
	})

	it("the row menu is nine items or fewer; style, opacity, attributes, details and copy sit in the drawer, two clicks away", () => {
		const writeText = vi.fn()
		Object.assign(navigator, { clipboard: { writeText } })
		// The fullest layer: a vector with a source path and a provenance record.
		state.layers = [
			poly("a", "watershed_01031500", { source_path: "/w/a.geojson" }),
			poly("b", "gauge", { source: "user", tool: "", _run_id: "" }),
		]
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for watershed_01031500/ }))
		const names = screen.getAllByRole("menuitem").map((i) => i.textContent)
		expect(names.length).toBeLessThanOrEqual(9)
		expect(names.join("|")).toMatch(/Zoom to layer.*Rename.*Save as….*Move up.*Move down.*Remove layer/)
		for (const gone of [/Style/, /Opacity/, /Attribute table/, /Details/, /Copy tool name/, /Copy run ID/, /Cluster/]) {
			expect(names.some((n) => gone.test(n ?? ""))).toBe(false)
		}
		fireEvent.keyDown(document.body, { key: "Escape" })
		fireEvent.click(document.body)
		// Click 1 opens the row; click 2 opens Details, where the run and tool copy.
		fireEvent.click(screen.getByRole("button", { name: /^watershed_01031500/ }))
		const settings = screen.getByRole("group", { name: /^Settings for watershed_01031500/ })
		for (const chip of ["Style", "Attributes", "Details"]) {
			expect(within(settings).getByRole("button", { name: chip })).toBeInTheDocument()
		}
		expect(within(settings).getByRole("slider")).toBeInTheDocument()
		fireEvent.click(within(settings).getByRole("button", { name: "Details" }))
		fireEvent.click(screen.getByRole("button", { name: "Copy run ID" }))
		expect(writeText).toHaveBeenCalledWith("run-7f3a.1")
		fireEvent.click(screen.getByRole("button", { name: "Copy tool name" }))
		expect(writeText).toHaveBeenCalledWith("delineate_watershed")
	})

	it("Open run is a menu item and a Details button only when the layer names its study and run, and it asks the host", () => {
		const postMessage = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation(() => {})
		state.layers = [
			poly("a", "with run", { source_path: "/w/a.geojson", study_id: "study-1" }),
			poly("b", "no study", { _run_id: "run-9.1" }),
		]
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for no study/ }))
		expect(screen.queryByRole("menuitem", { name: "Open run" })).toBeNull()
		fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
		fireEvent.click(screen.getByRole("button", { name: /^Actions for with run/ }))
		expect(within(screen.getByRole("menu")).getAllByRole("menuitem").length).toBeLessThanOrEqual(9)
		fireEvent.click(screen.getByRole("menuitem", { name: "Open run" }))
		expect(postMessage).toHaveBeenCalledWith({ type: "aihydro-map-open-run", study_id: "study-1", run_id: "run-7f3a.1" })
		postMessage.mockClear()
		fireEvent.click(screen.getByRole("button", { name: /^with run/ }))
		fireEvent.click(screen.getByRole("button", { name: "Details" }))
		fireEvent.click(screen.getByRole("button", { name: "Provenance" }))
		fireEvent.click(screen.getByRole("button", { name: "Open run" }))
		expect(postMessage).toHaveBeenCalledTimes(1)
		postMessage.mockRestore()
	})

	it("a reference layer with no study open sits under Reference data and says it is not in any run", () => {
		state.layers = [poly("g", "NWIS gauges", { source: "nwis", tool: "", _run_id: "", provenance_path: "" })]
		render(<LayerPanelContent {...baseProps()} />)
		expect(screen.getByRole("button", { name: /Reference data/ })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /^Other/ })).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: /^NWIS gauges/ }))
		fireEvent.click(screen.getByRole("button", { name: "Details" }))
		fireEvent.click(screen.getByRole("button", { name: "Provenance" }))
		expect(screen.getByText(/Reference, not in any run/)).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Open run" })).toBeNull()
	})

	it("a Show on map request selects that row and opens its details, again on a new request", () => {
		state.layers = [poly("a", "first"), poly("b", "second", { _run_id: "run-2.1" })]
		const props = { ...baseProps(), focusLayerRequest: { layerId: "b", nonce: 1 } }
		const { rerender } = render(<LayerPanelContent {...props} />)
		expect(screen.getByRole("group", { name: /^Settings for second/ })).toBeInTheDocument()
		expect(screen.queryByRole("group", { name: /^Settings for first/ })).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: /^first/ }))
		expect(screen.getByRole("group", { name: /^Settings for first/ })).toBeInTheDocument()
		rerender(<LayerPanelContent {...props} focusLayerRequest={{ layerId: "b", nonce: 2 }} />)
		expect(screen.getByRole("group", { name: /^Settings for second/ })).toBeInTheDocument()
	})

	it("Save as… offers a workspace file and a GeoJSON download in the drawer", () => {
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for watershed_01031500/ }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Save as…/ }))
		const save = screen.getByRole("group", { name: "Save as" })
		expect(within(save).getByRole("button", { name: /Workspace file/ })).toBeInTheDocument()
		expect(within(save).getByRole("button", { name: /GeoJSON download/ })).toBeInTheDocument()
	})

	it("Cluster points is a Style option for point layers, not a menu item", () => {
		state.layers = [{ ...poly("p", "wells"), layerType: "point" } as MapLayer]
		const onClusterToggle = vi.fn()
		render(<LayerPanelContent {...baseProps()} onClusterToggle={onClusterToggle} />)
		fireEvent.click(screen.getByRole("button", { name: /^wells/ }))
		fireEvent.click(screen.getByRole("button", { name: "Style" }))
		fireEvent.click(screen.getByRole("checkbox", { name: "Cluster points" }))
		expect(onClusterToggle).toHaveBeenCalledWith("p", true)
	})

	it("Provenance shows the recorded rows, then one Not recorded line", () => {
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^watershed_01031500/ }))
		fireEvent.click(screen.getByRole("button", { name: "Details" }))
		fireEvent.click(screen.getByRole("button", { name: "Provenance" }))
		expect(screen.getByText(/^Not recorded: /)).toHaveTextContent(/Units.*CRS.*Citation/)
		expect(screen.queryByText("Metadata fields")).toBeNull()
		expect(screen.queryByText("Run ID")).toBeNull()
		expect(screen.queryByText("Path")).toBeNull()
	})

	it("Move up is disabled with its reason on the layer on top of the map", () => {
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for gauge/ }))
		const up = screen.getByRole("menuitem", { name: /Move up/ })
		expect(up).toHaveAttribute("aria-disabled", "true")
		expect(up.textContent).toMatch(/Already on top of the map/)
	})

	it("removing a layer is one menu action with Undo, and Undo puts it back through the host", async () => {
		const props = baseProps()
		const { rerender } = render(<LayerPanelContent {...props} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for gauge/ }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Remove layer/ }))
		await waitFor(() => expect(removeMapLayer).toHaveBeenCalledTimes(1))
		rerender(<LayerPanelContent {...props} />)
		const undo = await screen.findByRole("button", { name: "Undo" })
		fireEvent.click(undo)
		await waitFor(() => expect(addMapLayer).toHaveBeenCalledTimes(1))
		expect(context.addLayer).toHaveBeenCalled()
	})

	it("flags duplicates of the same run and offers one-click removal after confirming", async () => {
		state.layers = [poly("a", "watershed"), poly("b", "watershed"), poly("c", "gauge", { _run_id: "run-2.1" })]
		render(<LayerPanelContent {...baseProps()} />)
		expect(screen.getAllByRole("img", { name: /^Duplicate/ }).length).toBe(2)
		fireEvent.click(screen.getByRole("button", { name: "Remove duplicates" }))
		expect(screen.getByRole("alertdialog")).toHaveTextContent("Remove 1 duplicate layer?")
		fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }))
		await waitFor(() => expect(removeMapLayer).toHaveBeenCalledTimes(1))
	})

	it("says Limited layer once for the group, never per row, and never drops a real warning", () => {
		state.layers = [
			poly("a", "flowlines", { provenance_path: "" }),
			poly("b", "catchments", { _run_id: "run-3.1", provenance_path: "" }),
		].map((l) => ({ ...l, geojson: "" }))
		const { container } = render(<LayerPanelContent {...baseProps()} />)
		expect(container.querySelectorAll(".map-layer-group__note").length).toBe(1)
		expect(container.querySelector(".map-layer-group__note")?.textContent).toMatch(/Limited layer/)
		// Missing provenance on both rows is a warning, so each row still carries its own.
		expect(container.querySelectorAll(".map-layer-flag--warn").length).toBe(2)
	})

	it("shows every warning in Details, readable without hover", () => {
		state.layers = [
			poly("a", "big", {
				display_mode: "preview",
				preview_feature_count: "10",
				original_feature_count: "500",
				simplified: "true",
				source_status: "source_changed",
			}),
		]
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Warning for big/ }))
		const list = screen.getByRole("list", { name: "Warnings" })
		expect(list).toHaveTextContent("Rendering a preview: 10 of 500")
		expect(list).toHaveTextContent("Auto-simplified")
		expect(list).toHaveTextContent("source file changed")
	})

	it("Rename from the menu leaves the name field focused after the menu's focus timer", async () => {
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for watershed_01031500/ }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }))
		const input = screen.getByRole("textbox", { name: "Layer display name" })
		await new Promise((r) => setTimeout(r, 30))
		expect(document.activeElement).toBe(input)
	})

	it("scrolling inside the open menu keeps it open; scrolling elsewhere closes it", () => {
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for gauge/ }))
		const menu = screen.getByRole("menu")
		fireEvent.scroll(menu)
		expect(screen.getByRole("menu")).toBeInTheDocument()
		fireEvent.scroll(document.body)
		expect(screen.queryByRole("menu")).toBeNull()
	})

	it("Undo gives back opacity and clustering, and back-to-back removals each stay undoable", async () => {
		state.layers = [poly("a", "one"), poly("b", "two", { _run_id: "run-2.1" })]
		const props = { ...baseProps(), layerOpacities: { a: 0.4 }, clusterLayerIds: new Set(["a"]), onClusterToggle: vi.fn() }
		const { rerender } = render(<LayerPanelContent {...props} />)
		const remove = async (name: string) => {
			fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }))
			fireEvent.click(screen.getByRole("menuitem", { name: /Remove layer/ }))
			await waitFor(() => expect(state.layers.find((l) => l.name === name)).toBeUndefined())
			rerender(<LayerPanelContent {...props} />)
		}
		await remove("one")
		await remove("two")
		fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
		await waitFor(() => expect(addMapLayer).toHaveBeenCalledTimes(1))
		rerender(<LayerPanelContent {...props} />)
		fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
		await waitFor(() => expect(addMapLayer).toHaveBeenCalledTimes(2))
		expect(props.onOpacityChange).toHaveBeenCalledWith("a", 0.4)
		expect(props.onClusterToggle).toHaveBeenCalledWith("a", true)
	})

	it("a layer the host refuses to remove stays in the list", async () => {
		removeMapLayer.mockImplementationOnce(() => Promise.reject(new Error("no")))
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for gauge/ }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Remove layer/ }))
		await screen.findByText(/Could not remove the layer/)
		expect(state.layers.map((l) => l.id)).toContain("b")
	})

	it("a collapsed group still counts its warnings, and Move down crosses groups", () => {
		state.layers = [poly("a", "x", { provenance_path: "" }), poly("b", "y", { source: "user", tool: "", _run_id: "" })]
		const props = baseProps()
		render(<LayerPanelContent {...props} />)
		fireEvent.click(screen.getByRole("button", { name: /Tool output/ }))
		expect(screen.getByRole("img", { name: "1 layer with warnings" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /Tool output/ }))
		fireEvent.click(screen.getByRole("button", { name: /^Actions for x/ }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Move up/ }))
		expect(props.onReorder).toHaveBeenCalledWith(["b", "a"])
	})

	it("reads like a GIS legend: the top row is the layer on top of the map", () => {
		state.layers = [poly("a", "bottom"), poly("b", "middle", { _run_id: "r2" }), poly("c", "top", { _run_id: "r3" })]
		const props = { ...baseProps(), layerOrder: ["a", "b", "c"] }
		render(<LayerPanelContent {...props} />)
		const rows = Array.from(document.querySelectorAll("li.map-layer-row")).map((r) => r.getAttribute("data-layer-id"))
		expect(rows).toEqual(["c", "b", "a"])
		// Move up on the middle row moves it toward the top of the map: it becomes the LAST id in draw order.
		fireEvent.click(screen.getByRole("button", { name: /^Actions for middle/ }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Move up/ }))
		expect(props.onReorder).toHaveBeenCalledWith(["a", "c", "b"])
	})
})
