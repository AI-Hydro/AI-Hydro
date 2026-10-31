import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PLATFORM_CONFIG } from "../../../config/platform.config"
import FeatureIdentifier, { type ClickedFeature } from "../FeatureIdentifier"

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
})
