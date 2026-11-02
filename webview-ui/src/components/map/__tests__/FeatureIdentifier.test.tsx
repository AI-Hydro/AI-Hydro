import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PLATFORM_CONFIG } from "../../../config/platform.config"
import FeatureIdentifier, { type ClickedFeature } from "../FeatureIdentifier"
import { TRACE_NATURE, type TraceLayerInfo } from "../networkTrace"

afterEach(cleanup)

const feature = (name: string): ClickedFeature => ({ layerId: name, layerName: name, properties: { name } })

describe("feature identifier card", () => {
	it("steps between features and closes with named codicon buttons, no glyph characters", () => {
		const onClose = vi.fn()
		const { container } = render(
			<FeatureIdentifier
				features={[feature("Basin A"), feature("Basin B")]}
				inspectPoint={{ lon: -69.5, lat: 45.4 }}
				mapStyle="dark"
				onClose={onClose}
			/>,
		)
		expect(screen.getByTitle("Basin A")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Next feature" }))
		expect(screen.getByTitle("Basin B")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Previous feature" }))
		expect(screen.getByTitle("Basin A")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Close inspector" }))
		expect(onClose).toHaveBeenCalled()
		expect(container.textContent ?? "").not.toMatch(/[‹›✕✏]/u)
		for (const b of container.querySelectorAll("button")) {
			expect(b.getAttribute("style") ?? "").not.toMatch(/(width|height): (1\d|2[0-3])px/)
		}
	})

	it("shows the first six properties, then Show all", () => {
		const props = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, `v${i}`]))
		render(
			<FeatureIdentifier
				features={[{ layerId: "l", layerName: "Wells", properties: props }]}
				inspectPoint={{ lon: -90, lat: 40 }}
				mapStyle="dark"
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByText("v5")).toBeInTheDocument()
		expect(screen.queryByText("v6")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Show all (9)" }))
		expect(screen.getByText("v8")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Show fewer" }))
		expect(screen.queryByText("v8")).toBeNull()
	})

	it("names the kind and the run, and Open asks the host for that run", () => {
		const postMessage = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation(() => {})
		render(
			<FeatureIdentifier
				features={[{ layerId: "g", layerName: "Gauge 01013500", properties: { site_no: "01013500" } }]}
				inspectPoint={{ lon: -68.5, lat: 47.2 }}
				layerMetadata={() => ({ tool: "locate_gauge", _run_id: "abcdef123456", study_id: "study-1" })}
				mapStyle="dark"
				onClose={vi.fn()}
			/>,
		)
		expect(document.body.textContent).toContain("Gauge · ")
		expect(screen.getByText(/locate_gauge · run abcdef12/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Open" }))
		expect(postMessage).toHaveBeenCalledWith({ type: "aihydro-map-open-run", study_id: "study-1", run_id: "abcdef123456" })
		postMessage.mockRestore()
	})

	it("says Reference, not in any run for an NWIS layer, and offers no Open", () => {
		render(
			<FeatureIdentifier
				features={[{ layerId: "r", layerName: "NWIS gauges in view", properties: { site_no: "1" } }]}
				inspectPoint={{ lon: -68.5, lat: 47.2 }}
				layerMetadata={() => ({ source: "nwis" })}
				mapStyle="dark"
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByText("Reference, not in any run")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Open" })).toBeNull()
	})

	it("offers two primary actions and the rest under ..., with the same labels as the context menu", () => {
		const onAgentAsk = vi.fn()
		const onAgentDelineate = vi.fn()
		const onQuickDelineate = vi.fn()
		render(
			<FeatureIdentifier
				features={[
					{ layerId: "l", layerName: "Wells", properties: { a: 1 }, geometry: { type: "Point", coordinates: [0, 0] } },
				]}
				inspectPoint={{ lon: -90, lat: 40 }}
				mapStyle="dark"
				onAddSelection={vi.fn()}
				onAgentAsk={onAgentAsk}
				onAgentDelineate={onAgentDelineate}
				onClose={vi.fn()}
				onQuickDelineate={onQuickDelineate}
				onSaveFeatures={vi.fn()}
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Ask AI-Hydro" }))
		fireEvent.click(screen.getByRole("button", { name: "Delineate" }))
		expect(onAgentAsk).toHaveBeenCalled()
		expect(onAgentDelineate).toHaveBeenCalled()
		// The routing badge and the quick-delineate paragraph are tooltips, not text on the card.
		expect(screen.getByRole("button", { name: "Delineate" }).getAttribute("title")).toMatch(/NLDI first/)
		expect(document.body.textContent).not.toMatch(/NLDI first|Interactive MERIT routing/)
		fireEvent.click(screen.getByRole("button", { name: "More actions for this selection" }))
		const names = screen.getAllByRole("menuitem").map((i) => i.textContent)
		expect(names).toEqual(["Delineate without chat", "Select", "Save as GeoJSON", "Save as shapefile", "Copy coordinates"])
		fireEvent.click(screen.getByRole("menuitem", { name: "Delineate without chat" }))
		expect(onQuickDelineate).toHaveBeenCalled()
	})

	it("a gauge card shows the site, name, not reported for what the layer lacks, and a USGS link", () => {
		const postMessage = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation(() => {})
		render(
			<FeatureIdentifier
				features={[
					{
						layerId: "g",
						layerName: "USGS gauges in view",
						properties: {
							site_no: "01013500",
							name: "Fish River near Fort Kent, Maine",
							label: "01013500 — Fish River",
						},
					},
				]}
				inspectPoint={{ lon: -68.5, lat: 47.2 }}
				layerMetadata={() => ({ source: "nwis" })}
				mapStyle="dark"
				onClose={vi.fn()}
			/>,
		)
		const block = screen.getByRole("group", { name: "Gauge" })
		expect(block).toHaveTextContent("USGS 01013500")
		expect(block).toHaveTextContent("Fish River near Fort Kent, Maine")
		expect(block).toHaveTextContent(/Drainage areanot reported/)
		expect(block).toHaveTextContent(/Recordnot reported/)
		// The property list does not repeat what the block shows.
		expect(screen.queryByText("01013500 — Fish River")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "USGS page" }))
		expect(postMessage).toHaveBeenCalledWith({
			type: "openExternal",
			url: "https://waterdata.usgs.gov/monitoring-location/01013500/",
		})
		postMessage.mockRestore()
	})

	it("a layer with a tool name is not called Reference, even from a reference source", () => {
		render(
			<FeatureIdentifier
				features={[{ layerId: "r", layerName: "Gauges", properties: { site_no: "1" } }]}
				inspectPoint={{ lon: -68.5, lat: 47.2 }}
				layerMetadata={() => ({ source: "nwis", tool: "fetch_gauges" })}
				mapStyle="dark"
				onClose={vi.fn()}
			/>,
		)
		expect(screen.queryByText("Reference, not in any run")).toBeNull()
		expect(screen.getByText("fetch_gauges · no run record")).toBeInTheDocument()
	})

	it("Remove layer asks first, and Escape closes the card", () => {
		const onRemoveLayer = vi.fn()
		const onClose = vi.fn()
		render(
			<FeatureIdentifier
				features={[{ layerId: "l", layerName: "Wells", properties: { a: 1 } }]}
				inspectPoint={{ lon: -90, lat: 40 }}
				mapStyle="dark"
				onAgentAsk={vi.fn()}
				onClose={onClose}
				onRemoveLayer={onRemoveLayer}
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "More actions for this selection" }))
		fireEvent.click(screen.getByRole("menuitem", { name: "Remove layer" }))
		expect(onRemoveLayer).not.toHaveBeenCalled()
		const dialog = screen.getByRole("alertdialog", { name: "Confirm removal" })
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
		expect(onRemoveLayer).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "More actions for this selection" }))
		fireEvent.click(screen.getByRole("menuitem", { name: "Remove layer" }))
		fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove layer" }))
		expect(onRemoveLayer).toHaveBeenCalledWith("l")
		fireEvent.keyDown(window, { key: "Escape" })
		expect(onClose).toHaveBeenCalled()
	})

	it("a large-basin routing warning is visible text, not only a tooltip", () => {
		render(
			<FeatureIdentifier
				features={[{ layerId: "r", layerName: "Rivers", properties: { uparea: 90000 } }]}
				inspectPoint={{ lon: 10, lat: 50 }}
				mapStyle="dark"
				onAgentDelineate={vi.fn()}
				onClose={vi.fn()}
			/>,
		)
		expect(screen.getByRole("note")).toHaveTextContent(/hybrid/i)
	})

	it("a gauge id that is not known to be USGS is shown bare, with no USGS label or link", () => {
		render(
			<FeatureIdentifier
				features={[{ layerId: "m", layerName: "Stations", properties: { site_no: "08MF005", name: "Rio Bravo" } }]}
				inspectPoint={{ lon: -100, lat: 28 }}
				layerMetadata={() => ({ source: "user" })}
				mapStyle="dark"
				onClose={vi.fn()}
			/>,
		)
		const block = screen.getByRole("group", { name: "Gauge" })
		expect(block).toHaveTextContent("Site08MF005")
		expect(block).not.toHaveTextContent("USGS")
		expect(screen.queryByRole("button", { name: "USGS page" })).toBeNull()
	})
})

describe("gauge trace block", () => {
	const gaugeFeature = (site: string): ClickedFeature[] => [
		{
			layerId: "g",
			layerName: "Gauges",
			properties: { site_no: site, name: "Test gauge" },
			geometry: { type: "Point", coordinates: [-68.5, 47.2] },
		},
	]
	const info = (over: Partial<TraceLayerInfo> = {}): TraceLayerInfo => ({
		layerId: "t1",
		layerName: "Upstream trace, 50 km, USGS-01013500 (NLDI)",
		siteNo: "01013500",
		direction: "upstream",
		distanceKm: 50,
		nFeatures: 12,
		truncated: false,
		...over,
	})
	const base = {
		inspectPoint: { lon: -68.5, lat: 47.2 },
		layerMetadata: () => ({ source: "nwis" }),
		mapStyle: "dark",
		onClose: vi.fn(),
	}

	it("asks for a trace with the typed distance and sends nothing for a bad one", () => {
		const onTrace = vi.fn()
		render(<FeatureIdentifier {...base} features={gaugeFeature("01013500")} onTrace={onTrace} />)
		fireEvent.click(screen.getByRole("button", { name: "Downstream" }))
		expect(onTrace).toHaveBeenLastCalledWith("01013500", "downstream", 50)
		fireEvent.change(screen.getByLabelText("Distance (km)"), { target: { value: "75" } })
		fireEvent.click(screen.getByRole("button", { name: "Upstream" }))
		expect(onTrace).toHaveBeenLastCalledWith("01013500", "upstream", 75)
		fireEvent.change(screen.getByLabelText("Distance (km)"), { target: { value: "250" } })
		expect(screen.getByRole("alert").textContent).toMatch(/1 to 200/)
		expect(screen.getByRole("button", { name: "Upstream" })).toBeDisabled()
		expect(onTrace).toHaveBeenCalledTimes(2)
	})

	it("offers no trace for a gauge that is not a USGS site, and says why in plain words", () => {
		const onTrace = vi.fn()
		render(<FeatureIdentifier {...base} features={gaugeFeature("08MF005")} onTrace={onTrace} />)
		expect(screen.queryByRole("button", { name: "Upstream" })).toBeNull()
		expect(screen.getByRole("note").textContent).toMatch(/needs a USGS gauge in the United States/)
	})

	it("shows the wait, that the user approves the run, and lets them stop waiting", () => {
		const stop = vi.fn()
		render(
			<FeatureIdentifier
				{...base}
				features={gaugeFeature("01013500")}
				onStopWaitingForTrace={stop}
				onTrace={vi.fn()}
				traceRequest={{ siteNo: "01013500", direction: "upstream", distanceKm: 50, seenLayerIds: [] }}
			/>,
		)
		expect(screen.getByRole("status").textContent).toMatch(/Tracing upstream, 50 km, in the chat/)
		expect(screen.getByRole("status").textContent).toMatch(/approve the tool call/)
		expect(screen.getByRole("status").textContent).toMatch(/no layer is added/)
		expect(screen.getByRole("button", { name: "Upstream" })).toBeDisabled()
		fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }))
		expect(stop).toHaveBeenCalled()
	})

	it("describes a traced layer as a network query result, with the cut when there is one", () => {
		render(
			<FeatureIdentifier
				{...base}
				features={gaugeFeature("01013500")}
				onTrace={vi.fn()}
				traces={[info({ truncated: true })]}
			/>,
		)
		const group = screen.getByRole("group", { name: /^Trace: Upstream trace/ })
		expect(within(group).getByText("50 km along the network")).toBeInTheDocument()
		expect(within(group).getByText("NLDI navigation over NHDPlus V2")).toBeInTheDocument()
		// The cut-short note exists and is drawn in the warning colour, not the muted one.
		const cut = within(group).getByText(/^Cut short: the tool keeps at most 750/)
		expect(cut.getAttribute("role")).toBe("note")
		expect(cut).toHaveStyle({ color: "#f2cc60" })
		expect(within(group).getByText(TRACE_NATURE)).toBeInTheDocument()
	})

	it("does not list another gauge's trace, and shows a clicked trace line's layer without a gauge block", () => {
		const { rerender } = render(
			<FeatureIdentifier {...base} features={gaugeFeature("09999999")} onTrace={vi.fn()} traces={[info()]} />,
		)
		expect(screen.queryByRole("group", { name: /^Trace:/ })).toBeNull()
		rerender(
			<FeatureIdentifier
				{...base}
				features={[
					{ layerId: "t1", layerName: "Upstream trace", properties: { nhdplus_comid: 5, direction: "upstream" } },
				]}
				traces={[info()]}
			/>,
		)
		expect(screen.getByRole("group", { name: /^Trace:/ })).toBeInTheDocument()
		expect(screen.queryByRole("group", { name: "Network trace" })).toBeNull()
	})
})
