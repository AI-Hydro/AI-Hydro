import { describe, expect, it } from "vitest"
import {
	classifyTileHealth,
	clearTally,
	controlTileUrl,
	fingerprintBlob,
	fingerprintBytes,
	loadedSources,
	MIN_OVERLAY_SAMPLE,
	PLACEHOLDER_ADDRESS_RING,
	PLACEHOLDER_MAX_SAMPLE,
	PLACEHOLDER_MIN_TILES,
	TILE_FAILURE_RATIO,
	TilePlaceholderTracker,
	type TileTallies,
	tallyTile,
	tileErrorsFrom,
	tileNotesFrom,
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

describe("TilePlaceholderTracker", () => {
	// Real Esri World_Light_Gray_Base open-ocean tiles at z5/z6 (measured 2026-10-20): 12 of 13 share one image
	// (2419 bytes, md5 364b7bd4...). Land control tile (z3 India) is a different image.
	const OCEAN = "2419:364b7bd4"
	const LAND = "7584:169ced3d"
	const PLACEHOLDER = "2049:502fc5f6"
	const fill = (tracker: TilePlaceholderTracker, n: number, print: (i: number) => string, from = 0) => {
		for (let i = from; i < from + n; i++) tracker.record(`z5/${i}/0`, print(i))
	}

	it("open ocean is not a placeholder: 12 of 13 identical tiles stay below the identical share", () => {
		const tracker = new TilePlaceholderTracker()
		fill(tracker, 13, (i) => (i === 0 ? "1800:aaaaaaaa" : OCEAN))
		expect(tracker.dominant()).toBeUndefined()
		expect(tracker.needsControl()).toBe(false)
		expect(tracker.suspected()).toBe(false)
	})

	it("a fully uniform ocean viewport needs a control, and a different land control clears it for good", () => {
		const tracker = new TilePlaceholderTracker()
		fill(tracker, 20, () => OCEAN)
		expect(tracker.dominant()).toBe(OCEAN)
		expect(tracker.needsControl()).toBe(true)
		expect(tracker.suspected()).toBe(false) // no control yet: never claim a broken provider on sameness alone
		tracker.setControl(LAND)
		expect(tracker.suspected()).toBe(false)
		expect(tracker.needsControl()).toBe(false)
		expect(tracker.wantsFingerprint()).toBe(false) // decided: hashing stops
	})

	it("a placeholder is flagged when the land control returns the same image", () => {
		const tracker = new TilePlaceholderTracker()
		fill(tracker, PLACEHOLDER_MIN_TILES, () => PLACEHOLDER)
		expect(tracker.needsControl()).toBe(true)
		tracker.setControl(PLACEHOLDER)
		expect(tracker.suspected()).toBe(true)
		expect(tracker.needsControl()).toBe(false)
	})

	it("does not ask for a control before enough distinct tiles, and the same address repeated counts once", () => {
		const tracker = new TilePlaceholderTracker()
		fill(tracker, PLACEHOLDER_MIN_TILES - 1, () => PLACEHOLDER)
		expect(tracker.needsControl()).toBe(false)
		for (let i = 0; i < 50; i++) tracker.record("z5/0/0", PLACEHOLDER)
		expect(tracker.needsControl()).toBe(false)
	})

	it("tiles that differ never need a control, and hashing stops after the sample cap", () => {
		const tracker = new TilePlaceholderTracker()
		fill(tracker, PLACEHOLDER_MAX_SAMPLE, (i) => `100:${i}`)
		expect(tracker.dominant()).toBeUndefined()
		expect(tracker.needsControl()).toBe(false)
		expect(tracker.suspected()).toBe(false)
		expect(tracker.wantsFingerprint()).toBe(false)
	})

	it("tolerates a few legitimately different tiles among identical ones, but not many", () => {
		const few = new TilePlaceholderTracker()
		fill(few, 60, (i) => (i < 2 ? `9:${i}` : PLACEHOLDER))
		expect(few.dominant()).toBe(PLACEHOLDER)
		const many = new TilePlaceholderTracker()
		fill(many, 60, (i) => (i < 20 ? `9:${i}` : PLACEHOLDER))
		expect(many.dominant()).toBeUndefined()
	})

	it("memory is bounded: the address ring never exceeds its size", () => {
		const tracker = new TilePlaceholderTracker()
		for (let i = 0; i < 10_000; i++) tracker.record(`z9/${i}/0`, `1:${i}`)
		expect((tracker as unknown as { ring: string[] }).ring.length).toBeLessThanOrEqual(PLACEHOLDER_ADDRESS_RING)
		expect((tracker as unknown as { counts: Map<string, number> }).counts.size).toBeLessThanOrEqual(PLACEHOLDER_MAX_SAMPLE)
	})

	it("clear forgets everything and resumes sampling", () => {
		const tracker = new TilePlaceholderTracker()
		fill(tracker, 20, () => PLACEHOLDER)
		tracker.setControl(LAND)
		tracker.clear()
		expect(tracker.wantsFingerprint()).toBe(true)
		expect(tracker.dominant()).toBeUndefined()
	})

	it("controlTileUrl fills the template with the land control address", () => {
		expect(controlTileUrl("https://h/tile/{z}/{y}/{x}")).toBe("https://h/tile/3/3/5")
		expect(controlTileUrl("https://h/{z}/{x}/{y}.png")).toBe("https://h/3/5/3.png")
	})

	it("fingerprintBytes separates different content and equals itself", () => {
		expect(fingerprintBytes(new Uint8Array([1, 2, 3]))).toBe(fingerprintBytes(new Uint8Array([1, 2, 3])))
		expect(fingerprintBytes(new Uint8Array([1, 2, 3]))).not.toBe(fingerprintBytes(new Uint8Array([1, 2, 4])))
		expect(fingerprintBytes(new Uint8Array([1, 2]))).not.toBe(fingerprintBytes(new Uint8Array([1, 2, 0])))
	})

	it("fingerprintBlob is stable and distinguishes content", async () => {
		const blobOf = (bytes: number[]) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as Blob
		const a = await fingerprintBlob(blobOf([1, 2, 3]))
		expect(a).toBe(await fingerprintBlob(blobOf([1, 2, 3])))
		expect(a).not.toBe(await fingerprintBlob(blobOf([1, 2, 4])))
	})
})
