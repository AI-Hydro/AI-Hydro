import type { MapLayer } from "@shared/proto/cline/map"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { rasterCache } from "../formats/rasterCache"
import { loadMapTile, parseRasterBounds, useRasterResources } from "../useRasterResources"

const decode = vi.hoisted(() => vi.fn())
const recolor = vi.hoisted(() => vi.fn())
vi.mock("../formats/rasterCache", async (original) => ({
	...(await original<any>()),
	dataUrlToImage: decode,
	applyColormap: recolor,
}))
afterEach(() => {
	cleanup()
	rasterCache.delete("a")
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	decode.mockReset()
	recolor.mockReset()
})
const layer = (url = "old", bounds = "[0,0,1,1]") =>
	({ id: "a", layerType: "raster", metadata: { raster_data_url: url, raster_bounds: bounds } }) as unknown as MapLayer
it("rejects unordered, nonfinite and ambiguous raster bounds", () => {
	for (const bounds of ["[1,0,0,1]", "[0,0,null,1]", "[0,0,1]", "[-181,0,1,1]"])
		expect(() => parseRasterBounds(bounds)).toThrow()
})
it("old decode cannot overwrite a replacement raster", async () => {
	let resolveOld!: (value: HTMLImageElement) => void
	decode
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveOld = resolve
				}),
		)
		.mockResolvedValueOnce({ tag: "new" })
	const view = renderHook(({ layers }) => useRasterResources(layers, 0), { initialProps: { layers: [layer()] } })
	view.rerender({ layers: [layer("new")] })
	await act(async () => {})
	expect(rasterCache.get("a")?.sourceDataUrl).toBe("new")
	await act(async () => resolveOld({ tag: "old" } as unknown as HTMLImageElement))
	expect(rasterCache.get("a")?.image).toEqual({ tag: "new" })
})
it("same-ID new source invalidates old cache even before decode completes", async () => {
	rasterCache.set("a", { image: {} as HTMLImageElement, bounds: [0, 0, 1, 1], sourceDataUrl: "old", sourceBounds: "[0,0,1,1]" })
	decode.mockReturnValue(new Promise(() => {}))
	const layers = [layer("new")]
	const { result } = renderHook(() => useRasterResources(layers, 0))
	expect(rasterCache.has("a")).toBe(false)
	expect(result.current.states.a.status).toBe("loading")
})
it("decode failure is visible and retry can recover", async () => {
	decode.mockRejectedValueOnce(new Error("bad image")).mockResolvedValueOnce({})
	const layers = [layer()]
	const view = renderHook(({ retry }) => useRasterResources(layers, retry), { initialProps: { retry: 0 } })
	await act(async () => {})
	expect(view.result.current.states.a.message).toBe("bad image")
	view.rerender({ retry: 1 })
	await act(async () => {})
	expect(view.result.current.states.a).toBeUndefined()
	expect(rasterCache.has("a")).toBe(true)
})
it("missing images produce an error instead of a blank success", () => {
	const layers = [layer("")]
	const { result } = renderHook(() => useRasterResources(layers, 0))
	expect(result.current.states.a.status).toBe("error")
})
it("tile HTTP errors are not converted into empty data", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }))
	await expect(loadMapTile({ url: "https://example.invalid/tile" })).rejects.toThrow("HTTP 403")
})
it("passes cancellation through to the tile fetch", async () => {
	const signal = new AbortController().signal
	const fetch = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"))
	vi.stubGlobal("fetch", fetch)
	await expect(loadMapTile({ url: "https://example.invalid/tile", signal })).rejects.toMatchObject({ name: "AbortError" })
	expect(fetch).toHaveBeenCalledWith("https://example.invalid/tile", { signal })
})

it("failed recoloring retains raw values for retry", async () => {
	const rawPixels = { data: new Float32Array([1]), width: 1, height: 1, min: 0, max: 1 }
	rasterCache.set("a", {
		image: {} as HTMLImageElement,
		bounds: [0, 0, 1, 1],
		sourceDataUrl: "old",
		sourceBounds: "[0,0,1,1]",
		colormap: "gray",
		rawPixels,
	})
	recolor.mockRejectedValueOnce(new Error("recolor failed")).mockResolvedValueOnce({ tag: "recolored" })
	const layers = [layer()]
	const view = renderHook(({ retry }) => useRasterResources(layers, retry), { initialProps: { retry: 0 } })
	await act(async () => {})
	expect(view.result.current.states.a.status).toBe("error")
	expect(rasterCache.get("a")?.rawPixels).toBe(rawPixels)
	view.rerender({ retry: 1 })
	await act(async () => {})
	expect(rasterCache.get("a")?.colormap).toBe("viridis")
	expect(view.result.current.states.a).toBeUndefined()
})
