import { describe, expect, it } from "vitest"
import { classifyTileHealth, clearTally, TILE_FAILURE_RATIO, tallyTile, tileErrorsFrom, tileNotesFrom, type TileTallies } from "../tileHealth"

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
