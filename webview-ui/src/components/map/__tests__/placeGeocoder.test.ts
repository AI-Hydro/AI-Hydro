import { describe, expect, it, vi } from "vitest"
import { collectHydroSearchProblems } from "../hydroSearchProblems"
import { createPlaceGeocoder, NOMINATIM_MIN_INTERVAL_MS, normalizeQuery } from "../placeGeocoder"

const okResponse = (rows: unknown[]) => ({ ok: true, status: 200, json: async () => rows }) as unknown as Response

function makeGeocoder(
	rows: unknown[] = [{ display_name: "Fish River, AL", lat: "30.5", lon: "-87.8", boundingbox: ["30", "31", "-88", "-87"] }],
) {
	let t = 1_000_000
	const fetchFn = vi.fn(async () => okResponse(rows))
	const sleeps: number[] = []
	const geocoder = createPlaceGeocoder({
		fetchFn: fetchFn as unknown as typeof fetch,
		now: () => t,
		sleep: async (ms) => {
			sleeps.push(ms)
			t += ms
		},
	})
	return { geocoder, fetchFn, sleeps, advance: (ms: number) => (t += ms) }
}

describe("placeGeocoder (Nominatim usage policy)", () => {
	it("makes no network request until search() is called (no per-keystroke geocoding)", () => {
		const { fetchFn } = makeGeocoder()
		expect(fetchFn).not.toHaveBeenCalled()
	})

	it("ignores queries shorter than two characters", async () => {
		const { geocoder, fetchFn } = makeGeocoder()
		expect(await geocoder.search(" f ")).toEqual([])
		expect(fetchFn).not.toHaveBeenCalled()
	})

	it("caches by normalised query", async () => {
		const { geocoder, fetchFn } = makeGeocoder()
		const first = await geocoder.search("Fish  River")
		const second = await geocoder.search("fish river ")
		expect(second).toBe(first)
		expect(fetchFn).toHaveBeenCalledTimes(1)
		expect(normalizeQuery("  Fish   River ")).toBe("fish river")
	})

	it("coalesces identical in-flight searches", async () => {
		const { geocoder, fetchFn } = makeGeocoder()
		await Promise.all([geocoder.search("fish river"), geocoder.search("Fish River")])
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it("spaces distinct requests at least one second apart", async () => {
		const { geocoder, fetchFn, sleeps } = makeGeocoder()
		await Promise.all([geocoder.search("fish river"), geocoder.search("wabash river"), geocoder.search("rapid creek")])
		expect(fetchFn).toHaveBeenCalledTimes(3)
		expect(sleeps.length).toBe(2)
		for (const ms of sleeps) {
			expect(ms).toBeGreaterThanOrEqual(NOMINATIM_MIN_INTERVAL_MS - 1)
		}
	})

	it("does not send a User-Agent header (not settable from a webview) and maps bbox", async () => {
		const { geocoder, fetchFn } = makeGeocoder()
		const hits = await geocoder.search("fish river")
		const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
		expect(Object.keys(init.headers as Record<string, string>)).not.toContain("User-Agent")
		expect(hits[0]).toMatchObject({ label: "Fish River, AL", lat: 30.5, lon: -87.8, bbox: [-88, 30, -87, 31] })
	})

	it("an aborted first caller does not fail a second caller sharing the in-flight request", async () => {
		const { geocoder, fetchFn } = makeGeocoder()
		const first = new AbortController()
		const p1 = geocoder.search("fish river", first.signal)
		const p2 = geocoder.search("fish river", new AbortController().signal)
		first.abort()
		await expect(p1).rejects.toThrow(/Aborted/)
		await expect(p2).resolves.toHaveLength(1)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it("surfaces HTTP errors and does not cache them", async () => {
		const fetchFn = vi.fn(async () => ({ ok: false, status: 429, json: async () => [] }) as unknown as Response)
		const geocoder = createPlaceGeocoder({ fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {} })
		await expect(geocoder.search("fish river")).rejects.toThrow(/429/)
		await expect(geocoder.search("fish river")).rejects.toThrow(/429/)
		expect(fetchFn).toHaveBeenCalledTimes(2)
	})
})

describe("collectHydroSearchProblems", () => {
	it("reports the server's problems list instead of an empty result", () => {
		expect(
			collectHydroSearchProblems({
				ok: true,
				result: { hits: [], problems: ["nwis timeout", { source: "nid", message: "HTTP 503" }, { code: "X" }] },
			}),
		).toEqual(["nwis timeout", "nid: HTTP 503", "X"])
	})
	it("reports a failed command", () => {
		expect(collectHydroSearchProblems({ ok: false, error: "Hydro command timed out" })).toEqual(["Hydro command timed out"])
	})
	it("is empty for a clean empty result", () => {
		expect(collectHydroSearchProblems({ ok: true, result: { hits: [] } })).toEqual([])
	})
})
