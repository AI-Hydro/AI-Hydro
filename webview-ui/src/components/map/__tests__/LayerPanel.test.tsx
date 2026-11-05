import type { MapLayer } from "@shared/proto/cline/map"
import React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const removeMapLayer = vi.fn(() => Promise.resolve({}))
const unloadMapLayer = vi.fn((_req: unknown) => Promise.resolve({ unloaded: true, settingsKept: true }))
const addWorkspaceGeoFile = vi.fn((_req: unknown) => Promise.resolve({ layerId: "workspace_new", settingsRestored: false, positionFromTop: -1 }))
const removeFromFileList = vi.fn((_req: unknown) => Promise.resolve({ changed: 1 }))
const restoreToFileList = vi.fn((_req: unknown) => Promise.resolve({ changed: 1 }))
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
// jsdom has no layout, so the virtualised tree would render nothing; the established mock renders every row.
vi.mock("react-virtuoso", () => ({
	Virtuoso: ({ data, itemContent }: any) => (
		<div>
			{data.map((d: any, i: number) => (
				<React.Fragment key={d.key ?? i}>{itemContent(i, d)}</React.Fragment>
			))}
		</div>
	),
}))
const loadEntries = vi.hoisted(() => vi.fn())
vi.mock("../formats", async (importOriginal) => ({
	...(await importOriginal<typeof import("../formats")>()),
	loadAndPushFileEntries: (...a: unknown[]) => loadEntries(...a),
}))
vi.mock("../../../context/MapContext", () => ({ useMapContext: () => context }))
vi.mock("../../../services/grpc-client", () => ({
	MapServiceClient: {
		removeMapLayer: (...a: unknown[]) => (removeMapLayer as any)(...a),
		unloadMapLayer: (...a: unknown[]) => (unloadMapLayer as any)(...a),
		addWorkspaceGeoFile: (...a: unknown[]) => (addWorkspaceGeoFile as any)(...a),
		removeFromFileList: (...a: unknown[]) => (removeFromFileList as any)(...a),
		restoreToFileList: (...a: unknown[]) => (restoreToFileList as any)(...a),
		addMapLayer: (...a: unknown[]) => (addMapLayer as any)(...a),
		clearMapLayers: vi.fn(() => Promise.resolve({})),
		listWorkspaceGeoFiles: vi.fn(() => Promise.resolve({ files: [], totalCount: 0 })),
		saveRoiToWorkspace: vi.fn(),
	},
	FileServiceClient: { openFile: vi.fn() },
}))

import { PLATFORM_CONFIG } from "../../../config/platform.config"
import { MapServiceClient } from "../../../services/grpc-client"
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

	it("Not on the map is one collapsed section below On the map; the Add menu no longer offers a second list", async () => {
		const list = MapServiceClient.listWorkspaceGeoFiles as unknown as ReturnType<typeof vi.fn>
		const f = (relativePath: string) => ({
			relativePath,
			workspaceFolder: "/w",
			folderName: "w",
			name: relativePath,
			extension: ".geojson",
			sizeBytes: 1200,
		})
		list.mockResolvedValue({ files: [f("a.geojson"), f("b.geojson")], removed: [], totalCount: 2, folderCount: 1 })
		render(<LayerPanelContent {...baseProps()} />)
		const head = await screen.findByRole("button", { name: "Not on the map · 2 files" })
		expect(head).toHaveAttribute("aria-expanded", "false")
		expect(screen.queryByRole("treeitem")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Add layer" }))
		expect(screen.queryByRole("menuitem", { name: /From this workspace/ })).toBeNull()
		list.mockResolvedValue({ files: [], removed: [], totalCount: 0, folderCount: 0 })
	})

	it("groups say what a layer is: a user file and a workspace file are both Files, a tool file in the workspace is a Result with its path in Details", () => {
		state.layers = [
			poly("t", "watershed_01013500", {
				source: "workspace",
				path: "vectors/watershed_01013500.geojson",
				workspace_folder: "/w",
			}),
			poly("u", "mine", { source: "user", tool: "", _run_id: "", source_path: "/elsewhere/mine.geojson" }),
			poly("w", "also mine", {
				source: "workspace",
				tool: "",
				_run_id: "",
				path: "vectors/b.geojson",
				workspace_folder: "/w",
			}),
		]
		render(<LayerPanelContent {...baseProps()} />)
		expect(screen.queryByRole("button", { name: /Loaded by you|Workspace files/ })).toBeNull()
		const files = screen.getByRole("region", { name: "Files" })
		expect(within(files).getAllByRole("listitem")).toHaveLength(2)
		const results = screen.getByRole("region", { name: "Results" })
		expect(within(results).getByText("watershed_01013500")).toBeInTheDocument()
		fireEvent.click(within(results).getByRole("button", { name: /^watershed_01013500/ }))
		fireEvent.click(screen.getByRole("button", { name: "Details" }))
		fireEvent.click(screen.getByRole("button", { name: "Provenance" }))
		expect(screen.getByText("vectors/watershed_01013500.geojson")).toBeInTheDocument()
	})

	it("groups by origin, and a group collapses", () => {
		render(<LayerPanelContent {...baseProps()} />)
		expect(screen.getByRole("button", { name: /Results/ })).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByRole("button", { name: /^Files/ })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /Results/ }))
		expect(screen.getByRole("button", { name: /Results/ })).toHaveAttribute("aria-expanded", "false")
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

	it("Add file asks the host's picker, so the file arrives with its path", () => {
		const postMessage = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation(() => {})
		const { container } = render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: "Add layer" }))
		fireEvent.click(screen.getByRole("menuitem", { name: /Add file/ }))
		expect(postMessage).toHaveBeenCalledWith({ type: "aihydro-map-add-file-command" })
		expect(container.querySelector('input[type="file"]')).toBeNull()
		postMessage.mockRestore()
	})

	it("Reload source loads the file by the absolute path the host found it at, not the relative spelling", async () => {
		loadEntries.mockResolvedValue({ loaded: 1, skipped: 0, errors: [] })
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["{}"])) })),
		)
		const postMessage = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation((message: any) => {
			if (message.type === "aihydro-resolve-file-uri") {
				expect(message.workspaceFolder).toBe("/proj")
				expect(message.kind).toBe("project")
				window.dispatchEvent(
					new MessageEvent("message", {
						data: {
							type: "aihydro-resolve-file-uri-result",
							requestId: message.requestId,
							ok: true,
							uri: "vscode-resource://x",
							name: "a.geojson",
							path: "/proj/a.geojson",
						},
					}),
				)
			}
		})
		state.layers = [
			poly("w", "a.geojson", { source: "workspace", path: "a.geojson", workspace_folder: "/proj", tool: "", _run_id: "" }),
		]
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(screen.getByRole("button", { name: /^Actions for a\.geojson/ }))
		fireEvent.click(screen.getByRole("menuitem", { name: "Reload source" }))
		await waitFor(() => expect(loadEntries).toHaveBeenCalledTimes(1))
		expect(loadEntries.mock.calls[0][0][0].source.path).toBe("/proj/a.geojson")
		postMessage.mockRestore()
		vi.unstubAllGlobals()
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

	it("does not call a vector Limited because its geometry is drawn from disk", () => {
		state.layers = [
			poly("a", "flowlines", { provenance_path: "/p.json" }),
			poly("b", "catchments", { provenance_path: "/q.json" }),
		].map((l) => ({ ...l, geojson: "" }))
		const { container } = render(<LayerPanelContent {...baseProps()} />)
		expect(container.textContent ?? "").not.toMatch(/Limited layer/)
		expect(container.querySelectorAll(".map-layer-group__note").length).toBe(0)
	})

	it("says Limited layer once for the group, never per row, and never drops a real warning", () => {
		// A layer type nothing here knows is the one honest case.
		state.layers = [
			poly("a", "flowlines", { provenance_path: "" }),
			poly("b", "catchments", { _run_id: "run-3.1", provenance_path: "" }),
		].map((l) => ({ ...l, layerType: "mystery_kind", geojson: "" }))
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
		fireEvent.click(screen.getByRole("button", { name: /Results/ }))
		expect(screen.getByRole("img", { name: "1 layer with warnings" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: /Results/ }))
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

describe("Not on the map (project files)", () => {
	const list = MapServiceClient.listWorkspaceGeoFiles as unknown as ReturnType<typeof vi.fn>
	const file = (relativePath: string, sizeBytes = 2000) => ({
		relativePath,
		workspaceFolder: "/w",
		folderName: "w",
		name: relativePath.split("/").pop(),
		extension: ".geojson",
		sizeBytes,
	})
	const answer = (files: ReturnType<typeof file>[], removed: unknown[] = []) =>
		list.mockResolvedValue({ files, removed, totalCount: files.length, folderCount: 1 })
	const openSection = async (header: string | RegExp) => {
		const head = await screen.findByRole("button", { name: header })
		// With nothing on the map the section opens by itself; with layers it starts closed.
		if (head.getAttribute("aria-expanded") === "false") fireEvent.click(head)
		await screen.findAllByRole("treeitem")
	}
	beforeEach(() => {
		localStorage.clear()
		state.layers = []
		for (const m of [unloadMapLayer, addWorkspaceGeoFile, removeFromFileList, restoreToFileList]) m.mockClear()
	})
	afterEach(() => {
		list.mockResolvedValue({ files: [], totalCount: 0 })
	})

	it("Load asks the host for exactly that file, says where the row went, and offers Zoom to", async () => {
		answer([file("data/a.geojson"), file("b.geojson")])
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/^Not on the map · 2 files/)
		fireEvent.click(screen.getByRole("button", { name: "Load b.geojson" }))
		await waitFor(() => expect(addWorkspaceGeoFile).toHaveBeenCalledOnce())
		expect(addWorkspaceGeoFile.mock.calls[0][0]).toMatchObject({ relativePath: "b.geojson", workspaceFolder: "/w" })
		expect(await screen.findByText(/Loaded b.geojson\. It moved up to On the map\./)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Zoom to" })).toBeInTheDocument()
		expect(screen.getAllByRole("treeitem").length).toBeGreaterThan(0)
	})

	it("a loaded file is its layer row under On the map and is not listed below; Unload uses the unload route, says where it went, and offers Undo", async () => {
		state.layers = [poly("L1", "a.geojson", { source: "workspace", tool: "", _run_id: "", path: "a.geojson", workspace_folder: "/w" })]
		answer([file("a.geojson"), file("b.geojson")])
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 1 file/)
		// Each file once: a.geojson is the layer row, only b.geojson is under Not on the map.
		expect(screen.queryByRole("button", { name: "Load a.geojson" })).toBeNull()
		expect(screen.getByRole("button", { name: "Load b.geojson" })).toBeInTheDocument()
		expect(screen.queryByRole("img", { name: "Loaded" })).toBeNull()
		expect(document.querySelectorAll('[data-layer-id="L1"]')).toHaveLength(1)
		fireEvent.click(screen.getByRole("button", { name: "Actions for a.geojson" }))
		fireEvent.click(await screen.findByRole("menuitem", { name: "Unload" }))
		await waitFor(() => expect(unloadMapLayer).toHaveBeenCalledOnce())
		expect(unloadMapLayer.mock.calls[0][0]).toMatchObject({ layerId: "L1" })
		expect(removeMapLayer).not.toHaveBeenCalled()
		expect(await screen.findByText(/Unloaded a.geojson\. It is now under Not on the map\. The file stays on disk\./)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument()
		// The row moved down: it is listed now, marked for a moment, and its layer row is gone.
		const moved = await screen.findByRole("button", { name: "Load a.geojson" })
		expect(moved.closest("[data-just-moved]")).not.toBeNull()
		expect(document.querySelector('[data-layer-id="L1"]')).toBeNull()
		// Keyboard focus follows the row to its new place.
		await waitFor(() => expect(moved).toHaveFocus())
	})

	it("a project file's row on the map shows its folder path on hover and offers Unload and Unload and remove from list", async () => {
		state.layers = [poly("L1", "a.geojson", { source: "workspace", tool: "", _run_id: "", path: "data/a.geojson", workspace_folder: "/w" })]
		answer([file("data/a.geojson")])
		render(<LayerPanelContent {...baseProps()} />)
		await screen.findByRole("button", { name: /Not on the map · 0 files/ })
		expect(screen.getByRole("button", { name: /^a.geojson/ }).getAttribute("title")).toContain("data/a.geojson")
	})

	it("Remove from list tells the host, says the file stays on disk, and Undo puts it back", async () => {
		answer([file("a.geojson")])
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map/)
		fireEvent.click(screen.getByRole("button", { name: "Actions for a.geojson" }))
		const item = await screen.findByRole("menuitem", { name: "Remove from list" })
		expect(item.getAttribute("title")).toMatch(/on this machine/)
		answer([], [{ relativePath: "a.geojson", workspaceFolder: "/w", folderName: "w", name: "a.geojson", kind: "file", removedAt: 1 }])
		fireEvent.click(item)
		await waitFor(() => expect(removeFromFileList).toHaveBeenCalledOnce())
		expect(removeFromFileList.mock.calls[0][0]).toMatchObject({ entries: [{ workspaceFolder: "/w", relativePath: "a.geojson", kind: "file" }] })
		expect(await screen.findByText(/Removed a.geojson from this list\. The file stays on disk\./)).toBeInTheDocument()
		expect(await screen.findByRole("button", { name: /Removed from list \(1\)/ })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Undo" }))
		await waitFor(() => expect(restoreToFileList).toHaveBeenCalledOnce())
	})

	it("a file above the large-load threshold asks first, and loads only after Load is confirmed", async () => {
		answer([file("big.geojson", 48_000_000)])
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map/)
		fireEvent.click(screen.getByRole("button", { name: "Load big.geojson" }))
		const dialog = await screen.findByRole("alertdialog", { name: "Confirm large load" })
		expect(dialog.textContent).toMatch(/48 MB/)
		expect(addWorkspaceGeoFile).not.toHaveBeenCalled()
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
		expect(addWorkspaceGeoFile).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Load big.geojson" }))
		fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Load" }))
		await waitFor(() => expect(addWorkspaceGeoFile).toHaveBeenCalledOnce())
	})

	it("a failed load keeps the row and offers Retry with the reason", async () => {
		addWorkspaceGeoFile.mockRejectedValueOnce(new Error("Unexpected token"))
		answer([file("bad.geojson")])
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map/)
		fireEvent.click(screen.getByRole("button", { name: "Load bad.geojson" }))
		expect(await screen.findByRole("button", { name: "Retry loading bad.geojson" })).toBeInTheDocument()
		expect(screen.getByRole("img", { name: /Could not load bad.geojson: Unexpected token/ })).toBeInTheDocument()
	})

	it("with more than ten files a filter appears, and Remove N matches hides only the unloaded matches", async () => {
		state.layers = [poly("L1", "huc_00.geojson", { source: "workspace", tool: "", _run_id: "", path: "huc_00.geojson", workspace_folder: "/w" })]
		const files = Array.from({ length: 13 }, (_, i) => file(`huc_${String(i).padStart(2, "0")}.geojson`))
		answer(files)
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 12 files/)
		fireEvent.change(screen.getByRole("searchbox", { name: "Filter project files" }), { target: { value: "huc_0" } })
		fireEvent.click(await screen.findByRole("button", { name: "Remove 9 matches" }))
		await waitFor(() => expect(removeFromFileList).toHaveBeenCalledOnce())
		const sent = (removeFromFileList.mock.calls[0][0] as { entries: { relativePath: string }[] }).entries
		expect(sent).toHaveLength(9)
		expect(sent.map((e) => e.relativePath)).not.toContain("huc_00.geojson")
	})

	it("the section says what the scan skipped and when it stopped, and is empty-honest", async () => {
		list.mockResolvedValue({
			files: [file("a.geojson")],
			removed: [],
			totalCount: 1,
			foldersSkipped: 3,
			skippedNames: [".git", ".aihydro", "node_modules"],
			symlinksFound: 2,
			symlinksSkipped: 1,
			truncated: true,
			folderCount: 1,
		})
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 1\+ file/)
		expect(screen.getByText("3 folders skipped")).toBeInTheDocument()
		expect(screen.getByText(/Removing files from the list does not bring in the ones beyond the limit/)).toBeInTheDocument()
		expect(screen.getByText(/2 symlinks, 1 outside the folder and not listed/)).toBeInTheDocument()
	})

	it("Unload and remove from list is on a file row of the map; a layer with no file only offers Remove layer", async () => {
		state.layers = [
			poly("L1", "a.geojson", { source: "workspace", tool: "", _run_id: "", path: "a.geojson", workspace_folder: "/w" }),
			poly("L2", "inline", { source: "agent", tool: "", _run_id: "" }),
		]
		answer([file("a.geojson")])
		render(<LayerPanelContent {...baseProps()} />)
		await screen.findByRole("button", { name: /Not on the map · 0 files/ })
		fireEvent.click(screen.getByRole("button", { name: "Actions for a.geojson" }))
		expect(await screen.findByRole("menuitem", { name: "Unload" })).toBeInTheDocument()
		expect(screen.queryByRole("menuitem", { name: /Remove layer/ })).toBeNull()
		fireEvent.click(screen.getByRole("menuitem", { name: "Unload and remove from list" }))
		await waitFor(() => expect(unloadMapLayer).toHaveBeenCalledOnce())
		await waitFor(() => expect(removeFromFileList).toHaveBeenCalledOnce())
		cleanup()
		render(<LayerPanelContent {...baseProps()} />)
		fireEvent.click(await screen.findByRole("button", { name: "Actions for inline" }))
		expect(await screen.findByRole("menuitem", { name: /Remove layer/ })).toBeInTheDocument()
		expect(screen.queryByRole("menuitem", { name: /^Unload/ })).toBeNull()
	})

	const fileIn = (relativePath: string, workspaceFolder: string, folderName: string, extension = ".geojson") => ({
		relativePath,
		workspaceFolder,
		folderName,
		name: relativePath.split("/").pop(),
		extension,
		sizeBytes: 2000,
	})

	it("after Load, once the layer arrives, its row is marked, scrolled to and focused, and the status says where it went", async () => {
		answer([file("b.geojson")])
		const props = baseProps()
		const { rerender } = render(<LayerPanelContent {...props} />)
		await openSection(/Not on the map · 1 file/)
		fireEvent.click(screen.getByRole("button", { name: "Load b.geojson" }))
		await screen.findByText(/It moved up to On the map\./)
		state.layers = [...state.layers, poly("workspace_new", "b.geojson", { source: "workspace", tool: "", _run_id: "", path: "b.geojson", workspace_folder: "/w" })]
		rerender(<LayerPanelContent {...baseProps()} />)
		const row = document.querySelector('[data-layer-id="workspace_new"]') as HTMLElement
		expect(row).not.toBeNull()
		expect(row.hasAttribute("data-just-moved")).toBe(true)
		await waitFor(() => expect(within(row).getByRole("button", { name: /^b.geojson/ })).toHaveFocus())
	})

	it("a GeoTIFF is parsed by the map panel: Load asks it, and when the layer arrives it gets the same status, mark and Zoom to", async () => {
		const post = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation(() => {})
		list.mockResolvedValue({ files: [fileIn("dem.tif", "/w", "w", ".tif")], removed: [], totalCount: 1, folderCount: 1 })
		const { rerender } = render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 1 file/)
		fireEvent.click(screen.getByRole("button", { name: "Load dem.tif" }))
		expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: "aihydro-map-load-project-file", relativePath: "dem.tif" }))
		expect(addWorkspaceGeoFile).not.toHaveBeenCalled()
		state.layers = [...state.layers, { ...poly("tif-1", "dem.tif", { source: "user", tool: "", _run_id: "", source_path: "/w/dem.tif" }), layerType: "raster" } as MapLayer]
		rerender(<LayerPanelContent {...baseProps()} />)
		expect(await screen.findByText(/Loaded dem.tif\. It moved up to On the map\./)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Zoom to" })).toBeInTheDocument()
		expect(document.querySelector('[data-layer-id="tif-1"]')?.hasAttribute("data-just-moved")).toBe(true)
		post.mockRestore()
	})

	it("multi-root: loading one folder's file leaves the same relative path in the other folder listed", async () => {
		state.layers = [poly("L1", "basin.geojson", { source: "workspace", tool: "", _run_id: "", path: "data/basin.geojson", source_path: "/one/data/basin.geojson", workspace_folder: "/one" })]
		list.mockResolvedValue({
			files: [fileIn("data/basin.geojson", "/one", "one"), fileIn("data/basin.geojson", "/two", "two")],
			removed: [],
			totalCount: 2,
			folderCount: 2,
		})
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 1 file/)
		expect(screen.getAllByRole("button", { name: "Load data/basin.geojson" })).toHaveLength(1)
		fireEvent.click(screen.getByRole("button", { name: "Load data/basin.geojson" }))
		await waitFor(() => expect(addWorkspaceGeoFile).toHaveBeenCalledOnce())
		expect(addWorkspaceGeoFile.mock.calls[0][0]).toMatchObject({ workspaceFolder: "/two" })
	})

	it("multi-root: a legacy layer with only a relative path does not hide a same-named file in another folder", async () => {
		state.layers = [poly("L0", "basin", { source: "workspace", tool: "", _run_id: "", path: "data/basin.geojson" })]
		list.mockResolvedValue({
			files: [fileIn("data/basin.geojson", "/one", "one"), fileIn("data/basin.geojson", "/two", "two")],
			removed: [],
			totalCount: 2,
			folderCount: 2,
		})
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 2 files/)
		expect(screen.getAllByRole("button", { name: "Load data/basin.geojson" })).toHaveLength(2)
	})

	it("two layers made from one file: the file is not listed, and unloading one of them does not list it", async () => {
		const meta = { source: "workspace", tool: "", _run_id: "", path: "a.geojson", source_path: "/w/a.geojson", workspace_folder: "/w" }
		state.layers = [poly("L1", "a.geojson", meta), poly("L2", "a copy", meta)]
		answer([file("a.geojson"), file("b.geojson")])
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 1 file/)
		expect(screen.queryByRole("button", { name: "Load a.geojson" })).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Actions for a copy" }))
		fireEvent.click(await screen.findByRole("menuitem", { name: "Unload" }))
		await waitFor(() => expect(unloadMapLayer).toHaveBeenCalledOnce())
		await screen.findByText(/Unloaded a copy/)
		expect(screen.queryByRole("button", { name: "Load a.geojson" })).toBeNull()
		expect(document.querySelector('[data-layer-id="L1"]')).not.toBeNull()
	})

	it("Unload while a filter is typed clears the filter, so the moved row is visible and focused", async () => {
		state.layers = [poly("L1", "huc_00.geojson", { source: "workspace", tool: "", _run_id: "", path: "huc_00.geojson", workspace_folder: "/w" })]
		answer(Array.from({ length: 13 }, (_, i) => file(`huc_${String(i).padStart(2, "0")}.geojson`)))
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map · 12 files/)
		const box = screen.getByRole("searchbox", { name: "Filter project files" })
		fireEvent.change(box, { target: { value: "zzz" } })
		expect(screen.queryByRole("button", { name: /^Load huc_/ })).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Actions for huc_00.geojson" }))
		fireEvent.click(await screen.findByRole("menuitem", { name: "Unload" }))
		const moved = await screen.findByRole("button", { name: "Load huc_00.geojson" })
		expect((screen.getByRole("searchbox", { name: "Filter project files" }) as HTMLInputElement).value).toBe("")
		await waitFor(() => expect(moved).toHaveFocus())
	})

	it("says what the skipped folders are in a tooltip", async () => {
		list.mockResolvedValue({ files: [file("a.geojson")], removed: [], totalCount: 1, foldersSkipped: 2, skippedNames: [".git", ".aihydro"], folderCount: 1 })
		render(<LayerPanelContent {...baseProps()} />)
		await openSection(/Not on the map/)
		const tip = screen.getByText("2 folders skipped").getAttribute("title") ?? ""
		expect(tip).toMatch(/\.git, \.aihydro/)
		expect(tip).toMatch(/on purpose/)
		expect(tip).toMatch(/files\.exclude/)
	})
})
