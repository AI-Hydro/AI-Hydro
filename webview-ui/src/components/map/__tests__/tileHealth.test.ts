import { describe, expect, it } from "vitest"
import {
	classifyTileHealth,
	clearTally,
	loadedSources,
	MIN_OVERLAY_SAMPLE,
	TILE_FAILURE_RATIO,
	tallyTile,
	tileErrorsFrom,
	tileNotesFrom,
	type TileTallies,
} from "../tileHealth"

const run = (loaded: number, failed: number, message = "Tile request failed (HTTP 404)"): TileTallies => {
	let t: TileTallies = {}
	for (let i = 0; i < loaded; i++) t = tallyTile(t, "basemap", { ok: true })
	for (let i = 0; i < failed; i++) t = tallyTile(t, "basemap", { ok: false, message })
	return t
}

describe("tile health classification", () => {
	it("2 of 200 tiles returning 404 is a note, not an alert", () => {
		const t = run(198, 2)
		expect(classifyTileHealth(t.basemap)).toBe("partial")
		expect(tileErrorsFrom(t)).toEqual({})
		expect(tileNotesFrom(t).basemap).toBe("2 tiles unavailable (2 with no coverage at that location)")
	})

	it("100% failing is a failure (alert) with the last error", () => {
		const t = run(0, 6, "Tile request failed (HTTP 403)")
		expect(classifyTileHealth(t.basemap)).toBe("failed")
		expect(tileErrorsFrom(t).basemap).toBe("Tile request failed (HTTP 403)")
		expect(tileNotesFrom(t)).toEqual({})
	})

	it("crosses to failed exactly at the failure ratio and recovers as tiles load", () => {
		expect(classifyTileHealth(run(3, 1).basemap)).toBe("failed") // 25%
		expect(TILE_FAILURE_RATIO).toBe(0.25)
		expect(classifyTileHealth(run(4, 1).basemap)).toBe("partial") // 20%
		expect(classifyTileHealth(run(30, 1).basemap)).toBe("partial")
	})

	it("a single missing tile is a note, one miss does not raise a permanent alert", () => {
		expect(classifyTileHealth(run(40, 1).basemap)).toBe("partial")
		expect(tileNotesFrom(run(40, 1))).toEqual({ basemap: "1 tile unavailable (1 with no coverage at that location)" })
	})

	it("non-404 failures are not described as coverage gaps", () => {
		expect(tileNotesFrom(run(50, 2, "Tile request failed (HTTP 503)")).basemap).toBe("2 tiles unavailable")
	})

	it("nothing failed is ok", () => {
		expect(classifyTileHealth(run(10, 0).basemap)).toBe("ok")
		expect(classifyTileHealth(undefined)).toBe("ok")
	})

	it("switching basemap clears the previous basemap's tally so no old error remains", () => {
		const before = run(0, 5, "Tile request failed (HTTP 404)")
		expect(tileErrorsFrom(before).basemap).toBeDefined()
		const after = clearTally(before, "basemap")
		expect(tileErrorsFrom(after)).toEqual({})
		expect(clearTally(after, "basemap")).toBe(after)
	})
})

describe("sparse overlay sources", () => {
	const overlayRun = (
		loaded: number,
		failed: number,
		notFound: number,
		message = "Tile request failed (HTTP 500)",
	): TileTallies => {
		let t: TileTallies = {}
		for (let i = 0; i < loaded; i++) t = tallyTile(t, "basemap-usgs-hydro", { ok: true })
		for (let i = 0; i < notFound; i++)
			t = tallyTile(t, "basemap-usgs-hydro", { ok: false, message: "Tile request failed (HTTP 404)" })
		for (let i = 0; i < failed - notFound; i++) t = tallyTile(t, "basemap-usgs-hydro", { ok: false, message })
		return t
	}

	it("404s never fail an overlay, even when nothing loaded", () => {
		const t = overlayRun(0, 40, 40)
		expect(classifyTileHealth(t["basemap-usgs-hydro"], { sparse: true })).toBe("partial")
		expect(tileErrorsFrom(t)).toEqual({})
		expect(tileNotesFrom(t)["basemap-usgs-hydro"]).toContain("no coverage")
	})

	it("the same 404-only tally on the base map (not sparse) still fails", () => {
		expect(classifyTileHealth(run(0, 6).basemap)).toBe("failed")
	})

	it("needs a minimum sample before real failures classify as failed", () => {
		expect(MIN_OVERLAY_SAMPLE).toBe(8)
		expect(classifyTileHealth(overlayRun(0, 7, 0)["basemap-usgs-hydro"], { sparse: true })).toBe("partial")
		expect(classifyTileHealth(overlayRun(0, 8, 0)["basemap-usgs-hydro"], { sparse: true })).toBe("failed")
		expect(tileErrorsFrom(overlayRun(0, 8, 0))["basemap-usgs-hydro"]).toBe("Tile request failed (HTTP 500)")
	})

	it("404s do not dilute or inflate the ratio of real failures", () => {
		// 10 loaded + 3 real failures = 23%: partial, regardless of 50 not-found tiles
		expect(classifyTileHealth(overlayRun(10, 53, 50)["basemap-usgs-hydro"], { sparse: true })).toBe("partial")
		// 6 loaded + 4 real failures = 40%: failed
		expect(classifyTileHealth(overlayRun(6, 54, 50)["basemap-usgs-hydro"], { sparse: true })).toBe("failed")
	})

	it("loadedSources lists only sources that drew a tile", () => {
		expect([...loadedSources(overlayRun(2, 0, 0))]).toEqual(["basemap-usgs-hydro"])
		expect(loadedSources(overlayRun(0, 5, 5)).size).toBe(0)
	})
})
