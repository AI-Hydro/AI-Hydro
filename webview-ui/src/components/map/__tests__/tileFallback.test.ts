import { describe, expect, it, vi } from "vitest"
import {
	fillTileUrl,
	isTileNotFound,
	loadParentFallback,
	MAX_PARENT_LEVELS,
	type ParentCrop,
	ParentTileCache,
	parentCrop,
} from "../tileFallback"
import { classifyTileHealth, tallyAncestorFill, tallyTile, tileDetailsFrom, tileNotesFrom } from "../tileHealth"

const TEMPLATE = "https://example.test/hydro/tile/{z}/{y}/{x}"
const notFound = () => new Error("Tile request failed (HTTP 404)")

describe("parentCrop", () => {
	it("the direct parent and the quadrant that covers the tile", () => {
		// z13 x4651 y3007: odd x, odd y -> bottom-right quadrant of z12 x2325 y1503
		expect(parentCrop({ z: 13, x: 4651, y: 3007 }, 1)).toEqual({
			parent: { z: 12, x: 2325, y: 1503 },
			levels: 1,
			left: 0.5,
			top: 0.5,
			size: 0.5,
		})
		// even x, even y -> top-left
		expect(parentCrop({ z: 13, x: 4650, y: 3006 }, 1)).toMatchObject({ left: 0, top: 0 })
	})

	it("an ancestor several levels up crops a 1/2^n square", () => {
		const cut = parentCrop({ z: 13, x: 4651, y: 3007 }, 3) as ParentCrop
		expect(cut.parent).toEqual({ z: 10, x: 581, y: 375 })
		expect(cut.size).toBe(1 / 8)
		expect(cut.left).toBe((4651 - 581 * 8) / 8)
		expect(cut.top).toBe((3007 - 375 * 8) / 8)
	})

	it("a crop is always inside its ancestor", () => {
		for (let levels = 1; levels <= 3; levels++) {
			for (const [x, y] of [
				[0, 0],
				[7, 7],
				[4651, 3007],
			]) {
				const cut = parentCrop({ z: 13, x, y }, levels) as ParentCrop
				expect(cut.left).toBeGreaterThanOrEqual(0)
				expect(cut.top).toBeGreaterThanOrEqual(0)
				expect(cut.left + cut.size).toBeLessThanOrEqual(1)
				expect(cut.top + cut.size).toBeLessThanOrEqual(1)
			}
		}
	})

	it("is null above zoom 0 and for a non-positive level", () => {
		expect(parentCrop({ z: 1, x: 0, y: 0 }, 2)).toBeNull()
		expect(parentCrop({ z: 5, x: 3, y: 3 }, 0)).toBeNull()
	})
})

describe("fillTileUrl / isTileNotFound", () => {
	it("fills z, y and x", () => {
		expect(fillTileUrl(TEMPLATE, { z: 12, x: 2325, y: 1503 })).toBe("https://example.test/hydro/tile/12/1503/2325")
	})
	it("recognises only a 404", () => {
		expect(isTileNotFound(notFound())).toBe(true)
		expect(isTileNotFound(new Error("Tile request failed (HTTP 500)"))).toBe(false)
		expect(isTileNotFound(new Error("Tile request failed (HTTP 4040)"))).toBe(false)
		expect(isTileNotFound("HTTP 404")).toBe(false)
	})
})

describe("loadParentFallback", () => {
	const tile = { z: 13, x: 4651, y: 3007 }
	const crop = (image: string, cut: ParentCrop) => `${image}@${cut.left},${cut.top},${cut.size}`

	it("fills a z13 hole from z12 and asks for nothing else", async () => {
		const load = vi.fn(async (url: string) => {
			if (url.includes("/12/")) return "z12"
			throw notFound()
		})
		await expect(loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop })).resolves.toBe("z12@0.5,0.5,0.5")
		expect(load).toHaveBeenCalledTimes(1)
		expect(load).toHaveBeenCalledWith("https://example.test/hydro/tile/12/1503/2325")
	})

	it("walks up to the nearest ancestor that exists", async () => {
		const load = vi.fn(async (url: string) => {
			if (url.includes("/10/")) return "z10"
			throw notFound()
		})
		const result = await loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop })
		expect(result).toBe(`z10@${(4651 - 581 * 8) / 8},${(3007 - 375 * 8) / 8},0.125`)
		expect(load.mock.calls.map(([url]) => url.split("/tile/")[1].split("/")[0])).toEqual(["12", "11", "10"])
	})

	it("gives up after MAX_PARENT_LEVELS and resolves null", async () => {
		const load = vi.fn(async () => {
			throw notFound()
		})
		await expect(loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop })).resolves.toBeNull()
		expect(load).toHaveBeenCalledTimes(MAX_PARENT_LEVELS)
		expect(MAX_PARENT_LEVELS).toBe(3)
	})

	it("a failure that is not a 404 is thrown, not papered over with a coarser tile", async () => {
		const load = vi.fn(async () => {
			throw new Error("Tile request failed (HTTP 503)")
		})
		await expect(loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop })).rejects.toThrow("HTTP 503")
		expect(load).toHaveBeenCalledTimes(1)
	})

	it("stops at zoom 0", async () => {
		const load = vi.fn(async () => {
			throw notFound()
		})
		await expect(loadParentFallback({ tile: { z: 1, x: 1, y: 0 }, urlTemplate: TEMPLATE, load, crop })).resolves.toBeNull()
		expect(load).toHaveBeenCalledTimes(1)
	})
})

describe("tile health after a parent fill", () => {
	const id = "basemap-usgs-hydro"
	it("a filled 404 is a loaded tile: the overlay is ok and has no note", () => {
		let tallies = {}
		for (let i = 0; i < 15; i++) tallies = tallyTile(tallies, id, { ok: true }) // 15 z13 tiles, all filled from z12
		expect(classifyTileHealth((tallies as never)[id], { sparse: true })).toBe("ok")
		expect(tileNotesFrom(tallies)).toEqual({})
	})
	it("an unfilled 404 keeps a note that does not claim missing coverage", () => {
		let tallies = {}
		tallies = tallyTile(tallies, id, { ok: false, message: "Tile request failed (HTTP 404)" })
		expect(classifyTileHealth((tallies as never)[id], { sparse: true })).toBe("partial")
		expect(tileNotesFrom(tallies)[id]).toBe("1 tile is not available from the provider here")
	})
})

describe("parent fallback floor, sharing and gap memory", () => {
	const tile = { z: 9, x: 150, y: 190 }
	const crop = (image: string, cut: ParentCrop) => `${image}@${cut.parent.z}`

	it("never climbs above minZoom (z5-7 USGS tiles carry baked-in names)", async () => {
		const load = vi.fn(async (_url: string) => {
			throw notFound()
		})
		// z9 -> z8 is allowed, z7 and z6 are below the overlay's minZoom of 8
		await expect(loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop, minZoom: 8 })).resolves.toBeNull()
		expect(load).toHaveBeenCalledTimes(1)
		expect(load.mock.calls[0][0]).toContain("/tile/8/")
	})

	it("a tile at the floor has no ancestor to try", async () => {
		const load = vi.fn(async () => "x")
		await expect(
			loadParentFallback({ tile: { z: 8, x: 77, y: 94 }, urlTemplate: TEMPLATE, load, crop, minZoom: 8 }),
		).resolves.toBeNull()
		expect(load).not.toHaveBeenCalled()
	})

	it("sibling holes under one parent fetch it once", async () => {
		const cache = new ParentTileCache<string>()
		const load = vi.fn(async () => {
			await Promise.resolve()
			return "parent"
		})
		const siblings = [0, 1].flatMap((dx) =>
			[0, 1].map((dy) =>
				loadParentFallback({ tile: { z: 13, x: 4650 + dx, y: 3006 + dy }, urlTemplate: TEMPLATE, load, crop, cache }),
			),
		)
		await Promise.all(siblings)
		expect(load).toHaveBeenCalledTimes(1)
	})

	it("remembers a confirmed gap for a while, then asks again", async () => {
		let now = 0
		const cache = new ParentTileCache<string>(() => now)
		const load = vi.fn(async () => {
			throw notFound()
		})
		const run = () => loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop, cache, minZoom: 8 })
		await run()
		await run()
		expect(load).toHaveBeenCalledTimes(1)
		now = 61_000
		await run()
		expect(load).toHaveBeenCalledTimes(2)
	})

	it("does not remember a non-404 failure as a gap", async () => {
		const cache = new ParentTileCache<string>()
		const load = vi.fn(async () => {
			throw new Error("Tile request failed (HTTP 503)")
		})
		await expect(loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop, cache, minZoom: 8 })).rejects.toThrow()
		await expect(loadParentFallback({ tile, urlTemplate: TEMPLATE, load, crop, cache, minZoom: 8 })).rejects.toThrow()
		expect(load).toHaveBeenCalledTimes(2)
	})

	it("reports levels climbed through onFilled", async () => {
		const onFilled = vi.fn()
		const load = vi.fn(async (url: string) => {
			if (url.includes("/tile/12/")) throw notFound()
			return "z11"
		})
		await loadParentFallback({ tile: { z: 13, x: 4651, y: 3007 }, urlTemplate: TEMPLATE, load, crop, onFilled })
		expect(onFilled).toHaveBeenCalledWith(2)
	})
})

describe("ancestor fills are tile-health detail, not a note", () => {
	it("counted in details, with no note and no change of health", () => {
		const id = "basemap-usgs-hydro"
		let t = {}
		for (let i = 0; i < 4; i++) {
			t = tallyTile(t, id, { ok: true })
			t = tallyAncestorFill(t, id)
		}
		expect(tileDetailsFrom(t)[id]).toBe("4 tiles drawn from a coarser zoom because the provider has none at this zoom")
		expect(tileNotesFrom(t)).toEqual({})
		expect(classifyTileHealth((t as never)[id], { sparse: true })).toBe("ok")
	})
})
