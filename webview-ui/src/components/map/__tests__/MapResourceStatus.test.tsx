import type { MapLayer } from "@shared/proto/cline/map"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { MapResourceStatus } from "../MapResourceStatus"

afterEach(cleanup)
const layers = [{ id: "a", name: "Rainfall" }] as MapLayer[]
it("exposes failed imagery and retry without implying environmental absence", () => {
	const retry = vi.fn()
	render(
		<MapResourceStatus
			layers={layers}
			onRetry={retry}
			rasterStates={{}}
			tileErrors={{ a: "HTTP 403" }}
			visibleLayerIds={new Set(["a"])}
		/>,
	)
	expect(screen.getByRole("alert")).toHaveTextContent("Rainfall: HTTP 403")
	expect(screen.getByRole("alert")).toHaveTextContent("Missing imagery is not evidence")
	fireEvent.click(screen.getByRole("button", { name: "Retry imagery" }))
	expect(retry).toHaveBeenCalledOnce()
})
it("hidden layers do not obstruct the current map", () => {
	render(
		<MapResourceStatus
			layers={layers}
			onRetry={() => {}}
			rasterStates={{ a: { status: "error", message: "bad" } }}
			tileErrors={{}}
			visibleLayerIds={new Set()}
		/>,
	)
	expect(screen.queryByRole("alert")).toBeNull()
})
it("shows renderer failures even without data layers", () => {
	render(
		<MapResourceStatus
			layers={[]}
			onRetry={() => {}}
			rasterStates={{}}
			rendererError="WebGL failed"
			tileErrors={{}}
			visibleLayerIds={new Set()}
		/>,
	)
	expect(screen.getByRole("alert")).toHaveTextContent("Map renderer: WebGL failed")
})

it("a renderer error reads as a renderer problem: Reload map renderer, no imagery wording", () => {
	const reload = vi.fn()
	const retry = vi.fn()
	render(
		<MapResourceStatus
			layers={[]}
			onReloadRenderer={reload}
			onRetry={retry}
			rasterStates={{}}
			rendererError="deck.gl: assertion failed."
			tileErrors={{}}
			visibleLayerIds={new Set()}
		/>,
	)
	const alert = screen.getByRole("alert")
	expect(alert).toHaveTextContent("Map renderer stopped")
	expect(alert).not.toHaveTextContent("Missing imagery")
	expect(screen.queryByRole("button", { name: "Retry imagery" })).toBeNull()
	fireEvent.click(screen.getByRole("button", { name: "Reload map renderer" }))
	expect(reload).toHaveBeenCalledOnce()
	expect(retry).not.toHaveBeenCalled()
})

it("an imagery error offers Retry imagery only, never the renderer button", () => {
	render(
		<MapResourceStatus
			layers={[]}
			onRetry={() => {}}
			rasterStates={{}}
			tileErrors={{ basemap: "Tile request failed (HTTP 403)" }}
			visibleLayerIds={new Set()}
		/>,
	)
	expect(screen.getByRole("alert")).toHaveTextContent("Basemap: Tile request failed (HTTP 403)")
	expect(screen.queryByRole("button", { name: "Reload map renderer" })).toBeNull()
	expect(screen.getByRole("button", { name: "Retry imagery" })).toBeTruthy()
})

it("a few missing tiles show a quiet status note, not an alert", () => {
	render(
		<MapResourceStatus
			layers={[]}
			onRetry={() => {}}
			rasterStates={{}}
			tileErrors={{}}
			tileNotes={{ basemap: "2 tiles unavailable" }}
			visibleLayerIds={new Set()}
		/>,
	)
	expect(screen.queryByRole("alert")).toBeNull()
	expect(screen.getByRole("status")).toHaveTextContent("Basemap: 2 tiles unavailable")
})

it("the alert can be dismissed, leaves a way back, and returns for a different problem", () => {
	const props = { layers: [], onRetry: () => {}, rasterStates: {}, visibleLayerIds: new Set<string>() }
	const { rerender } = render(<MapResourceStatus {...props} tileErrors={{ basemap: "Tile request failed (HTTP 403)" }} />)
	fireEvent.click(screen.getByRole("button", { name: "Dismiss map issues" }))
	expect(screen.queryByRole("alert")).toBeNull()
	fireEvent.click(screen.getByRole("button", { name: /Map issues \(1\)/ }))
	expect(screen.getByRole("alert")).toBeTruthy()
	fireEvent.click(screen.getByRole("button", { name: "Dismiss map issues" }))
	rerender(<MapResourceStatus {...props} tileErrors={{ basemap: "Tile request failed (HTTP 500)" }} />)
	expect(screen.getByRole("alert")).toHaveTextContent("HTTP 500")
})

it("names a non-layer source such as the river overlay", () => {
	render(
		<MapResourceStatus
			layers={[]}
			onRetry={() => {}}
			rasterStates={{}}
			sourceLabels={{ basemap: "Basemap", "basemap-usgs-hydro": "River overlay" }}
			tileErrors={{ "basemap-usgs-hydro": "Tile request failed (HTTP 503)" }}
			visibleLayerIds={new Set()}
		/>,
	)
	expect(screen.getByRole("alert")).toHaveTextContent("River overlay: Tile request failed (HTTP 503)")
})
