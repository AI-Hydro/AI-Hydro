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
