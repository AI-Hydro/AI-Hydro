import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sendHydroMapCommand = vi.fn()
const geocoderSearch = vi.fn()

vi.mock("../mapHydrologyBridge", () => ({ sendHydroMapCommand: (...a: unknown[]) => sendHydroMapCommand(...a) }))
vi.mock("../placeGeocoder", () => ({ placeGeocoder: { search: (...a: unknown[]) => geocoderSearch(...a) } }))
vi.mock("../mapWorkspace", () => ({ loadMapWorkspace: () => ({ bookmarks: [] }), saveMapWorkspace: vi.fn() }))

import { SearchBar } from "../SearchBar"

const type = (value: string) => {
	if (!screen.queryByLabelText(/Search places, coordinates, gauges, or dams/i)) {
		render(<SearchBar embedded />)
	}
	const input = screen.getByLabelText(/Search places, coordinates, gauges, or dams/i)
	fireEvent.change(input, { target: { value } })
	return input
}

const flush = async (ms = 450) => {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

describe("SearchBar", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		sendHydroMapCommand.mockReset()
		geocoderSearch.mockReset()
		sendHydroMapCommand.mockResolvedValue({ ok: true, result: { hits: [] } })
		geocoderSearch.mockResolvedValue([])
	})
	afterEach(() => vi.useRealTimers())

	it("never geocodes place names while typing", async () => {
		type("f")
		type("fi")
		type("fish")
		type("fish river")
		await flush(2000)
		expect(geocoderSearch).not.toHaveBeenCalled()
	})

	it("geocodes once on Enter and again on the Search button", async () => {
		geocoderSearch.mockResolvedValue([{ label: "Fish River, AL", lat: 30.5, lon: -87.8 }])
		const input = type("fish river")
		await flush()
		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" })
		})
		expect(geocoderSearch).toHaveBeenCalledTimes(1)
		expect(screen.getByText("Fish River, AL")).toBeTruthy()
		expect(screen.getByText(/OpenStreetMap contributors/)).toBeTruthy()
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Search place names" }))
		})
		expect(geocoderSearch).toHaveBeenCalledTimes(2)
	})

	it("does not contain the old hard-coded gauge list", async () => {
		type("01031500")
		await flush()
		expect(screen.queryByText(/Mattawamkeag/)).toBeNull()
	})

	it("surfaces the server's problems list instead of silently showing nothing", async () => {
		sendHydroMapCommand.mockResolvedValue({ ok: true, result: { hits: [], problems: ["USGS site service HTTP 503"] } })
		type("wabash")
		await flush()
		const notice = screen.getByTestId("map-search-notice")
		expect(notice.textContent).toContain("USGS lookup incomplete")
		expect(notice.textContent).toContain("HTTP 503")
	})

	it("reports a failed hydrology command as an outage", async () => {
		sendHydroMapCommand.mockResolvedValue({ ok: false, error: "Hydro command timed out" })
		type("wabash")
		await flush()
		expect(screen.getByTestId("map-search-notice").textContent).toContain("Hydro command timed out")
	})

	it("discards a stale hydrology response when a newer query has started", async () => {
		let resolveFirst: (v: unknown) => void = () => {}
		sendHydroMapCommand.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
		sendHydroMapCommand.mockResolvedValueOnce({
			ok: true,
			result: { hits: [{ label: "NEW 02", lat: 1, lon: 2, source: "gauge", meta: { gauge_id: "02" } }] },
		})
		type("first")
		await flush()
		type("second")
		await flush()
		await act(async () => {
			resolveFirst({ ok: true, result: { hits: [{ label: "OLD 01", lat: 1, lon: 2, source: "gauge", meta: { gauge_id: "01" } }] } })
		})
		expect(screen.queryByText("OLD 01")).toBeNull()
		expect(screen.getByText("NEW 02")).toBeTruthy()
	})
})
