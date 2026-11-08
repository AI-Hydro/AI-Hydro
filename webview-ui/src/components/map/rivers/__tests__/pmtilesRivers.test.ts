import { gunzipSync } from "node:zlib"
import { Compression, tileIdToZxy, zxyToTileId } from "pmtiles"
import { describe, expect, it } from "vitest"
import { RangeFetchSource, RiverTileReader, segmentsFromFeatures } from "../pmtilesRivers"
import { buildPmtiles, encodeMvtLayer, lonLatToTilePixel, tileIdOf } from "../testing/pmtilesFixture.mjs"
import { rangeFetch } from "./rangeServer"

const decompress = async (buf: ArrayBuffer, compression: Compression) =>
	compression === Compression.Gzip ? (Uint8Array.from(gunzipSync(Buffer.from(buf))).buffer as ArrayBuffer) : buf

/** Two rivers in tile z2/x1/y1 (lon -90..0, lat 0..66): a trunk (order 8) and a small stream (order 2). */
function tileBytes(z: number, x: number, y: number) {
	const px = (lon: number, lat: number) => lonLatToTilePixel(lon, lat, z, x, y).map(Math.round) as [number, number]
	return encodeMvtLayer("streams", [
		{ props: { riverId: 11, strahlerOrder: 8 }, lines: [[px(-80, 30), px(-60, 35), px(-40, 33)]] },
		{ props: { riverId: 12, strahlerOrder: 2 }, lines: [[px(-70, 20), px(-65, 25)]] },
	])
}

const archive = (gzip: boolean) => buildPmtiles(new Map([["2/1/1", tileBytes(2, 1, 1)]]), { minZoom: 0, maxZoom: 5, gzip })

describe("fixture writer is spec-correct", () => {
	it("tile ids match the pmtiles library's Hilbert ids", () => {
		for (const [z, x, y] of [
			[0, 0, 0],
			[1, 1, 0],
			[2, 1, 1],
			[5, 17, 11],
			[12, 1024, 1550],
		]) {
			expect(tileIdOf(z, x, y)).toBe(zxyToTileId(z, x, y))
			expect(tileIdToZxy(tileIdOf(z, x, y))).toEqual([z, x, y])
		}
	})
})

describe("a large archive with leaf directories", () => {
	it("finds tiles through the root and leaf directories (as the 2.9M-entry GEOGLOWS archive is read)", async () => {
		const tiles = new Map<string, Uint8Array>()
		// 1,024 tiles at z5 (a 32 x 32 grid), each holding one river whose riverId is the tile's column * 100 + row.
		for (let x = 0; x < 32; x++)
			for (let y = 0; y < 32; y++) {
				tiles.set(
					`5/${x}/${y}`,
					encodeMvtLayer("streams", [
						{
							props: { riverId: x * 100 + y, strahlerOrder: 6 },
							lines: [
								[
									[100, 100],
									[900, 900],
								],
							],
						},
					]),
				)
			}
		for (const gzip of [false, true]) {
			const server = rangeFetch(buildPmtiles(tiles, { minZoom: 5, maxZoom: 5, gzip }))
			const reader = new RiverTileReader("https://example.test/big.pmtiles", { fetchImpl: server.fetchImpl, decompress })
			for (const [x, y] of [
				[0, 0],
				[17, 3],
				[31, 31],
			])
				expect((await reader.getTile(5, x, y)).map((seg) => seg.riverId)).toEqual([x * 100 + y])
			// The root directory fits the first 16 KiB read, as the spec requires.
			expect(server.calls[0].range).toBe("bytes=0-16383")
		}
	})
})

describe("RiverTileReader over range requests", () => {
	for (const gzip of [false, true]) {
		it(`reads a tile and decodes lon/lat segments sorted by order (${gzip ? "gzip" : "uncompressed"} archive)`, async () => {
			const server = rangeFetch(archive(gzip))
			const reader = new RiverTileReader("https://example.test/streams.pmtiles", {
				fetchImpl: server.fetchImpl,
				decompress,
			})
			const segments = await reader.getTile(2, 1, 1)
			expect(segments.map((s) => [s.riverId, s.order])).toEqual([
				[12, 2],
				[11, 8],
			])
			// Decoded coordinates are lon/lat (within a tile-pixel of the input), not tile pixels.
			const trunk = segments[1].path
			expect(trunk).toHaveLength(3)
			expect(trunk[0][0]).toBeCloseTo(-80, 1)
			expect(trunk[0][1]).toBeCloseTo(30, 1)
			expect(trunk[2][0]).toBeCloseTo(-40, 1)
			// Only byte ranges were requested, never the whole file.
			expect(server.calls.length).toBeGreaterThan(0)
			expect(server.calls.every((c) => /^bytes=\d+-\d+$/.test(c.range ?? ""))).toBe(true)
			expect(reader.stats.requests).toBe(server.calls.length)
			expect(reader.stats.bytes).toBeGreaterThan(0)
			expect(reader.stats.failures).toBe(0)
		})
	}

	it("reports the archive's zoom range from the header", async () => {
		const reader = new RiverTileReader("https://example.test/s.pmtiles", { fetchImpl: rangeFetch(archive(false)).fetchImpl })
		const header = await reader.header()
		expect([header.minZoom, header.maxZoom]).toEqual([0, 5])
	})

	it("a tile the archive does not contain is an empty tile, not an error", async () => {
		const reader = new RiverTileReader("https://example.test/s.pmtiles", { fetchImpl: rangeFetch(archive(false)).fetchImpl })
		expect(await reader.getTile(2, 3, 3)).toEqual([])
		expect(reader.stats.failures).toBe(0)
	})

	it("an offline fetch fails the tile (so tile health can count it) and is counted", async () => {
		const reader = new RiverTileReader("https://example.test/s.pmtiles", {
			fetchImpl: rangeFetch(archive(false), { offline: true }).fetchImpl,
		})
		await expect(reader.getTile(2, 1, 1)).rejects.toThrow("Failed to fetch")
		expect(reader.stats.failures).toBeGreaterThan(0)
	})

	it("a moved archive (404) reads 'status 404', which tile health does not mistake for a missing tile", async () => {
		const reader = new RiverTileReader("https://example.test/s.pmtiles", {
			fetchImpl: rangeFetch(archive(false), { status: 404 }).fetchImpl,
		})
		const error = await reader.getTile(2, 1, 1).catch((e: Error) => e)
		expect((error as Error).message).toMatch(/not found \(status 404\)/)
		expect((error as Error).message).not.toMatch(/HTTP 404/)
	})

	it("a cancelled tile request rejects with AbortError and is not counted as a failure", async () => {
		const reader = new RiverTileReader("https://example.test/s.pmtiles", { fetchImpl: rangeFetch(archive(false)).fetchImpl })
		const controller = new AbortController()
		controller.abort()
		await expect(reader.getTile(2, 1, 1, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
		expect(reader.stats.failures).toBe(0)
	})
})

describe("RangeFetchSource guards", () => {
	it("refuses a server that ignores Range (it would send the whole archive)", async () => {
		const file = new Uint8Array(100_000)
		const source = new RangeFetchSource("https://example.test/s.pmtiles", rangeFetch(file, { honourRange: false }).fetchImpl)
		await expect(source.getBytes(0, 16384)).rejects.toThrow(/does not support byte ranges/)
		expect(source.stats.bytes).toBe(0)
		expect(source.stats.failures).toBe(1)
	})

	it("accepts a 200 that is exactly the requested range (a file smaller than the first read)", async () => {
		const file = new Uint8Array(1000)
		const source = new RangeFetchSource("https://example.test/s.pmtiles", rangeFetch(file, { honourRange: false }).fetchImpl)
		const response = await source.getBytes(0, 16384)
		expect(response.data.byteLength).toBe(1000)
	})

	it("stops when the archive changes under an open map (ETag differs)", async () => {
		let n = 0
		const file = new Uint8Array(5000)
		const source = new RangeFetchSource(
			"https://example.test/s.pmtiles",
			rangeFetch(file, { etag: () => `"v${n++}"` }).fetchImpl,
		)
		await source.getBytes(0, 100)
		await expect(source.getBytes(100, 100)).rejects.toThrow(/archive changed/)
	})

	it("reports a server error status", async () => {
		const source = new RangeFetchSource(
			"https://example.test/s.pmtiles",
			rangeFetch(new Uint8Array(10), { status: 503 }).fetchImpl,
		)
		await expect(source.getBytes(0, 10)).rejects.toThrow(/status 503/)
	})
})

describe("segmentsFromFeatures", () => {
	it("keeps lines, splits multilines, drops features without a numeric order and sorts ascending", () => {
		const line = (n: number): [number, number][] => [
			[n, 0],
			[n + 1, 1],
		]
		const out = segmentsFromFeatures([
			{ geometry: { type: "LineString", coordinates: line(0) }, properties: { strahlerOrder: 5, riverId: 1 } },
			{
				geometry: { type: "MultiLineString", coordinates: [line(2), line(4)] },
				properties: { strahlerOrder: 3, riverId: 2 },
			},
			{ geometry: { type: "Point", coordinates: [0, 0] }, properties: { strahlerOrder: 9 } },
			{ geometry: { type: "LineString", coordinates: line(8) }, properties: {} },
			{ geometry: null, properties: { strahlerOrder: 4 } },
		])
		expect(out.map((s) => [s.riverId, s.order])).toEqual([
			[2, 3],
			[2, 3],
			[1, 5],
		])
	})
})
