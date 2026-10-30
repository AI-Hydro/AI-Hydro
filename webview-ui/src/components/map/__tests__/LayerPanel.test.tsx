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

	it("the overflow menu holds the actions, and keeps tool and run ID reachable and copyable", () => {
		const writeText = vi.fn()
		Object.assign(navigator, { clipboard: { writeText } })
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for watershed_01031500/ }))
		const names = screen.getAllByRole("menuitem").map((i) => i.textContent)
		expect(names.join("|")).toMatch(
			/Zoom to layer.*Rename.*Style.*Opacity.*Details and provenance.*Copy tool name.*Copy run ID.*Move up.*Move down.*Remove layer/,
		)
		fireEvent.click(screen.getByRole("menuitem", { name: /Copy run ID/ }))
		expect(writeText).toHaveBeenCalledWith("run-7f3a.1")
		// The details view shows both values with their own copy buttons.
		fireEvent.click(screen.getByRole("button", { name: /^watershed_01031500/ }))
		fireEvent.click(screen.getByRole("button", { name: "Details" }))
		fireEvent.click(screen.getByRole("button", { name: "Provenance" }))
		fireEvent.click(screen.getByRole("button", { name: "Copy tool name" }))
		expect(writeText).toHaveBeenCalledWith("delineate_watershed")
	})

	it("Move up is disabled with its reason on the first layer of a group", () => {
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for watershed_01031500/ }))
		const up = screen.getByRole("menuitem", { name: /Move up/ })
		expect(up).toHaveAttribute("aria-disabled", "true")
		expect(up.textContent).toMatch(/Already first/)
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
})
