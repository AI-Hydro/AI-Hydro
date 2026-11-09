import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { gunzipSync } from "node:zlib"
import { MERIT_LAYER_NAMES, MERIT_LAYER_PREFIX, MERIT_MSG, MERIT_SOURCE_ID } from "@shared/map/meritTileContract"
import { Compression } from "pmtiles"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MeritArchiveRegistry } from "../../../../../../src/hosts/vscode/meritTiles"
import { attributionFor, attributionList, resolveBaseMap } from "../../basemaps"
import { buildSnapshot, evaluateReadiness } from "../../MapExport"
import { HostRangeSource, type HostTransport } from "../hostRangeSource"
import { formatUpareaKm2, isMeritLayerId, meritReachFeature } from "../meritReach"
import { buildMeritLayer, MeritTileReader, MeritTiles, meritCreditVisible } from "../meritRivers"
import { RangeFetchSource, RiverTileReader } from "../pmtilesRivers"
import { buildRiverLayers } from "../riverLayers"
import { riverColorForUparea, riverWidthPxForUparea } from "../riverStyle"
import { buildPmtiles, encodeMvtLayer, lonLatToTilePixel } from "../testing/pmtilesFixture.mjs"
import { meritExportCredits, parseArchivesMessage } from "../useMeritArchives"
import { rangeFetch } from "./rangeServer"

const decompress = async (buf: ArrayBuffer, compression: Compression) =>
	compression === Compression.Gzip ? (Uint8Array.from(gunzipSync(Buffer.from(buf))).buffer as ArrayBuffer) : buf

const ATTRIBUTION =
	"Rivers: MERIT-Basins, Lin et al. 2019, CC BY-NC-SA 4.0 (attributed per mghydro.com; exact variant unresolved)"

/** One tile (z2 x1 y1) carrying all five MERIT layers; the rivers_z11 reach has no `uparea`. */
function fiveLayerTile(z = 2, x = 1, y = 1): Uint8Array {
	const px = (lon: number, lat: number) => lonLatToTilePixel(lon, lat, z, x, y).map(Math.round) as [number, number]
	const parts = MERIT_LAYER_NAMES.map((name, i) =>
		encodeMvtLayer(name, [
			{
				props:
					i === 4
						? { comid: 72000000 + i, sorder: 1, lengthkm: 1.5 }
						: { comid: 72000000 + i, uparea: 10 ** (i + 1) * 30, sorder: 8 - i, lengthkm: 2.5 + i },
				lines: [[px(-80 + i, 30 + i), px(-70 + i, 33 + i)]],
			},
		]),
	)
	return Uint8Array.from(parts.flatMap((p) => [...p]))
}

describe("MERIT tier over the host registry", () => {
	let dir: string
	let registry: MeritArchiveRegistry
	let archiveBytes: Uint8Array
	beforeEach(async () => {
		dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "merit-wv-"))
		archiveBytes = buildPmtiles(new Map([["2/1/1", fiveLayerTile()]]), {
			minZoom: 0,
			maxZoom: 12,
			bounds: [-93, 40, -52, 62],
			gzip: false,
		})
		const sha = createHash("sha256").update(archiveBytes).digest("hex")
		fs.writeFileSync(path.join(dir, "rivers72.pmtiles"), archiveBytes)
		fs.writeFileSync(
			path.join(dir, "rivers72.pmtiles.provenance.json"),
			JSON.stringify({
				tile_schema_version: 2,
				region: "72",
				source: { name: "rivers72.db", sha256: "f".repeat(64), sha256_origin: "staging_provenance_sidecar" },
				output: { name: "rivers72.pmtiles", size_bytes: archiveBytes.length, sha256: sha },
				licence: "CC BY-NC-SA 4.0",
				citation: "Lin et al. 2019",
				attribution: ATTRIBUTION,
				licence_note: "variant unresolved",
				reaches_absent_at_max_zoom: 1,
			}),
		)
		registry = new MeritArchiveRegistry({ tilesDir: () => dir })
		await registry.scan()
	})
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

	/** The webview's channel wired straight to the host's handler. */
	const transport = (): HostTransport & { posted: unknown[] } => {
		const listeners = new Set<(d: unknown) => void>()
		const posted: unknown[] = []
		return {
			posted,
			listen: (h) => (listeners.add(h), () => listeners.delete(h)),
			post: (m) => {
				posted.push(m)
				const r = m as { requestId: string; archiveId: string; offset: number; length: number }
				void registry.readRange(r.archiveId, r.offset, r.length).then(
					({ data, etag }) =>
						listeners.forEach((l) =>
							l({ type: MERIT_MSG.rangeResult, requestId: r.requestId, ok: true, data, etag }),
						),
					(e) =>
						listeners.forEach((l) =>
							l({ type: MERIT_MSG.rangeResult, requestId: r.requestId, ok: false, error: String(e.message) }),
						),
				)
			},
		}
	}

	it("decodes all five layers, keeps null uparea as null, and sorts large rivers last", async () => {
		const offer = registry.snapshot().archives[0]
		const reader = new MeritTileReader(offer, { transport: transport(), decompress })
		const segs = await reader.getTile(2, 1, 1)
		expect(new Set(segs.map((s) => s.band))).toEqual(new Set(MERIT_LAYER_NAMES))
		expect(segs).toHaveLength(5)
		const noArea = segs.find((s) => s.band === "rivers_z11")
		expect(noArea?.uparea).toBeNull()
		expect(segs[0]).toBe(noArea) // no area sorts first
		expect(segs.slice(1).map((s) => s.uparea)).toEqual([300, 3000, 30000, 300000].slice(0, 4).sort((a, b) => a - b))
		expect(segs.every((s) => s.archiveId === "rivers72")).toBe(true)
		expect(await reader.getTile(2, 0, 0)).toEqual([]) // a tile the archive lacks
	})

	it("reads through the host in ranges and tiles read equal the bytes in the file", async () => {
		const t = transport()
		const source = new HostRangeSource("rivers72", t)
		for (const [o, l] of [
			[0, 127],
			[50, 300],
			[archiveBytes.length - 10, 10],
			[0, 16384],
		]) {
			const { data } = await source.getBytes(o, l)
			expect(Buffer.from(data).equals(Buffer.from(archiveBytes.subarray(o, o + l)))).toBe(true)
		}
		expect(source.stats.requests).toBe(4)
		// the request carries an id and numbers, never a path
		expect(Object.keys(t.posted[0] as object).sort()).toEqual(["archiveId", "length", "offset", "requestId", "type"])
	})

	it("rejects a reply longer than the range, a non-ArrayBuffer reply, an error reply, and honours abort", async () => {
		const mk = (reply: (id: string) => unknown) => {
			const listeners = new Set<(d: unknown) => void>()
			const t: HostTransport = {
				listen: (h) => (listeners.add(h), () => listeners.delete(h)),
				post: (m) => queueMicrotask(() => listeners.forEach((l) => l(reply((m as { requestId: string }).requestId)))),
			}
			return new HostRangeSource("rivers72", t)
		}
		await expect(
			mk((id) => ({ type: MERIT_MSG.rangeResult, requestId: id, ok: true, data: new ArrayBuffer(20) })).getBytes(0, 10),
		).rejects.toThrow(/longer/)
		await expect(
			mk((id) => ({
				type: MERIT_MSG.rangeResult,
				requestId: id,
				ok: true,
				data: { type: "Buffer", data: [1, 2] },
			})).getBytes(0, 10),
		).rejects.toThrow(/binary/)
		await expect(
			mk((id) => ({ type: MERIT_MSG.rangeResult, requestId: id, ok: false, error: "unknown archive" })).getBytes(0, 10),
		).rejects.toThrow(/unknown archive/)
		const never = new HostRangeSource("rivers72", { listen: () => () => undefined, post: () => undefined })
		const ctl = new AbortController()
		const p = never.getBytes(0, 10, ctl.signal)
		ctl.abort()
		await expect(p).rejects.toMatchObject({ name: "AbortError" })
	})

	it("MeritTiles picks archives by header bounds and reports coverage", async () => {
		const offer = registry.snapshot().archives[0]
		const tiles = new MeritTiles([offer], { transport: transport(), decompress })
		expect(await tiles.covers(2, 1, 1)).toBe(true)
		expect(await tiles.covers(2, 3, 0)).toBe(false) // tile outside the archive bounds: no read at all
		expect(tiles.offerById("rivers72")).toBe(offer)
	})

	it("layer order: MERIT is the last layer, with the pick prefix; GEOGLOWS draws elsewhere", async () => {
		const offer = registry.snapshot().archives[0]
		const tiles = new MeritTiles([offer], { transport: transport(), decompress })
		const merit = {
			tiles,
			coversView: true,
			onTileLoad: () => undefined,
			onViewportLoad: () => undefined,
			onTileError: () => undefined,
		}
		const base = {
			theme: "light" as const,
			zoom: 5,
			reader: null,
			degraded: false,
			retry: 0,
			onTileLoad: () => undefined,
			onTileError: () => undefined,
		}
		const ids = (zoom: number, degraded = false) =>
			buildRiverLayers({ ...base, zoom, degraded, merit }).map((l) => (l as { id: string }).id)
		expect(ids(5).at(-1)).toMatch(/^merit-rivers-/)
		expect(ids(5).every((id) => !id.startsWith(MERIT_LAYER_PREFIX) || id === ids(5).at(-1))).toBe(true)
		expect(ids(2)).toEqual(["rivers-ne-lakes-light", "rivers-ne-rivers-light"]) // below zoom 3 MERIT is not drawn
		// degraded streamed tier + MERIT covers the view: no bundled rivers under MERIT
		expect(ids(5, true)).toEqual(["rivers-ne-lakes-light", expect.stringMatching(/^merit-rivers-/)])
		const outside = buildRiverLayers({ ...base, zoom: 5, degraded: true, merit: { ...merit, coversView: false } }).map(
			(l) => (l as { id: string }).id,
		)
		expect(outside).toContain("rivers-ne-rivers-light")
	})

	it("accuracy: uparea, sorder and comid through the host source equal the values in the file", async () => {
		const offer = registry.snapshot().archives[0]
		const viaHost = await new MeritTileReader(offer, { transport: transport(), decompress }).getTile(2, 1, 1)
		const direct = await new MeritTileReader(offer, {
			decompress,
			source: {
				getKey: () => "f",
				getBytes: async (o, l) => ({ data: archiveBytes.slice(o, o + l).buffer as ArrayBuffer }),
			},
		}).getTile(2, 1, 1)
		const pick = (s: typeof viaHost) => s.map((x) => [x.comid, x.uparea, x.sorder]).sort()
		expect(pick(viaHost)).toEqual(pick(direct))
		expect(pick(viaHost)).toContainEqual([72000000, 300, 8])
	})
})

describe("MERIT 206 guard in the HTTP source", () => {
	it("refuses a 206 longer than the range asked for (an old VS Code answering with the whole file)", async () => {
		const file = new Uint8Array(5000).fill(7)
		const fetchImpl = async () =>
			new Response(file as unknown as BodyInit, { status: 206, headers: { "content-range": "bytes 0-99/5000" } })
		await expect(new RangeFetchSource("https://x.test/a", fetchImpl).getBytes(0, 100)).rejects.toThrow(
			/more bytes than asked/,
		)
		const honest = rangeFetch(file)
		expect((await new RangeFetchSource("https://x.test/a", honest.fetchImpl).getBytes(0, 100)).data.byteLength).toBe(100)
	})
})

describe("W1 width and S1/S2 colour by uparea", () => {
	it("matches the design table", () => {
		expect(riverWidthPxForUparea(25)).toBeCloseTo(0.6, 5)
		expect(riverWidthPxForUparea(1000)).toBeCloseTo(1.72, 1)
		expect(riverWidthPxForUparea(1e4)).toBeCloseTo(2.42, 1)
		expect(riverWidthPxForUparea(1e5)).toBeCloseTo(3.12, 1)
		expect(riverWidthPxForUparea(3e6)).toBeCloseTo(4.15, 1)
		expect(riverWidthPxForUparea(null)).toBeCloseTo(0.6, 5)
		expect(riverColorForUparea(25, "light").slice(0, 3)).toEqual([0xd5, 0xd1, 0xf6])
		expect(riverColorForUparea(1e6, "dark").slice(0, 3)).toEqual([255, 255, 255])
		expect(riverColorForUparea(25, "dark")[3]).toBe(128)
		expect(riverColorForUparea(1e4, "dark")[3]).toBe(255)
	})
})

describe("reach card", () => {
	const offer = parseArchivesMessage({
		type: MERIT_MSG.archives,
		archives: [
			{
				id: "rivers72",
				region: "72",
				minZoom: 0,
				maxZoom: 12,
				bounds: [-93, 40, -52, 62],
				layers: [],
				provenance: {
					sourceName: "rivers72.db",
					sourceSha256: "a".repeat(64),
					tilesName: "rivers72.pmtiles",
					tilesSha256: "b".repeat(64),
					verification: "sha256-verified",
					attribution: ATTRIBUTION,
					citation: "Lin et al. 2019",
					citationDetail: "Lin 2019 WRR",
					licenceNote: "variant unresolved",
				},
			},
		],
	})?.archives[0]
	const seg = {
		path: [
			[0, 0],
			[1, 1],
		] as [number, number][],
		comid: 72029961,
		uparea: 14479.96,
		sorder: 4,
		lengthkm: 3.35,
		band: "rivers_z0",
		archiveId: "rivers72",
	}
	it("shows the specified fields and says 'not recorded' for a null area, never 0", () => {
		const f = meritReachFeature(seg, offer)
		expect(f.layerId.startsWith(MERIT_LAYER_PREFIX)).toBe(true)
		expect(isMeritLayerId(f.layerId)).toBe(true)
		expect(f.properties).toMatchObject({
			COMID: "72029961",
			"Upstream area": "14,480 km²",
			"Strahler order": "4",
			Length: "3.35 km",
			Region: "72",
			"Source db": "rivers72.db",
			"Tiles sha256": "b".repeat(64),
			Verified: expect.stringContaining("sha256-verified"),
			Licence: ATTRIBUTION,
			"Licence note": "variant unresolved",
		})
		const none = meritReachFeature({ ...seg, uparea: null }, offer)
		expect(none.properties["Upstream area"]).toBe("not recorded")
		expect(formatUpareaKm2(null)).toBe("not recorded")
		expect(formatUpareaKm2(0)).not.toBe("not recorded") // a recorded 0 is shown as a number, not hidden
	})
})

describe("NC-SA attribution", () => {
	const resolved = resolveBaseMap("muted-hydro", "light")
	it("is added only while the merit-rivers id is in the credited set", () => {
		const centre = { lon: -73, lat: 46 }
		const without = attributionFor(resolved, centre, new Set(["rivers"]), [ATTRIBUTION])
		const withIt = attributionFor(resolved, centre, new Set(["rivers", MERIT_SOURCE_ID]), [ATTRIBUTION])
		expect(without).not.toContain("CC BY-NC-SA")
		expect(withIt).toContain("CC BY-NC-SA 4.0")
	})
	it("meritCreditVisible: needs a visible tile with features", () => {
		expect(meritCreditVisible([])).toBe(false)
		expect(meritCreditVisible([{ isVisible: true, content: [] }])).toBe(false)
		expect(meritCreditVisible([{ isVisible: false, content: [{}] }])).toBe(false)
		expect(
			meritCreditVisible([
				{ isVisible: true, content: [] },
				{ isVisible: true, content: [{}] },
			]),
		).toBe(true)
	})
	it("exports list MERIT only when the layer is enabled, with the licence flag in the manifest", () => {
		const archives = [{ provenance: { attribution: ATTRIBUTION } }] as never
		expect(meritExportCredits({ archives, enabled: false })).toEqual([])
		const credits = meritExportCredits({ archives, enabled: true })
		expect(attributionList(resolved, credits)).toContain(ATTRIBUTION)
		expect(attributionList(resolved)).not.toContain(ATTRIBUTION)
		const spec = { extentStrategy: "view" } as never
		const on = buildSnapshot(spec, { currentBasemap: "muted-hydro", meritCredits: credits } as never)
		expect(on.basemap.attribution).toContain(ATTRIBUTION)
		expect(on.basemap.nonCommercialShareAlike).toBe(true)
		expect(on.basemap.licences).toEqual(["CC BY-NC-SA 4.0"])
		const off = buildSnapshot(spec, { currentBasemap: "muted-hydro" } as never)
		expect(off.basemap.attribution).not.toContain(ATTRIBUTION)
		expect(off.basemap.nonCommercialShareAlike).toBeUndefined()
	})
})

const noopMerit = { onTileLoad: () => undefined, onViewportLoad: () => undefined, onTileError: () => undefined }

describe("stale tiles: the MERIT layer refetches when its archives change", () => {
	it("getTileData is an update trigger on the MeritTiles object", () => {
		const a = new MeritTiles([])
		const b = new MeritTiles([])
		const mk = (tiles: MeritTiles) =>
			(
				buildMeritLayer({ tiles, theme: "light", zoom: 5, retry: 0, ...noopMerit }) as {
					props: { updateTriggers: Record<string, unknown[]> }
				}
			).props
		expect(mk(a).updateTriggers.getTileData[0]).toBe(a)
		expect(mk(b).updateTriggers.getTileData[0]).toBe(b)
		expect(mk(a).updateTriggers.getTileData[0]).not.toBe(mk(b).updateTriggers.getTileData[0])
	})
})

describe("export provenance", () => {
	const offer = (verification: string) =>
		({
			id: "rivers72",
			region: "72",
			provenance: { attribution: ATTRIBUTION, tilesSha256: "b".repeat(64), sourceSha256: "a".repeat(64), verification },
		}) as never
	const run = (verification: string | null) => {
		const spec = {
			template: "report",
			dpi: 150,
			extentStrategy: "preserve-visible-extent",
			elements: { attribution: true },
		} as never
		const snap = buildSnapshot(spec, {
			currentBasemap: "muted-hydro",
			meritArchives: verification ? [offer(verification)] : [],
		} as never)
		return { snap, codes: evaluateReadiness(spec, snap, null, []).warnings.map((w) => w.code) }
	}
	it("records every enabled archive with its hashes", () => {
		expect(run("sha256-verified").snap.merit).toEqual([
			{
				id: "rivers72",
				region: "72",
				tiles_sha256: "b".repeat(64),
				source_sha256: "a".repeat(64),
				verification: "sha256-verified",
			},
		])
		expect(run(null).snap.merit).toEqual([])
	})
	it("warns while an archive is only size-matched, and when its hash check failed to run, not when verified", () => {
		expect(run("size-matched").codes).toContain("MERIT_TILES_NOT_HASH_VERIFIED")
		expect(run("sha256-check-failed").codes).toContain("MERIT_SHA256_CHECK_FAILED")
		expect(run("sha256-verified").codes).not.toContain("MERIT_TILES_NOT_HASH_VERIFIED")
		expect(run("sha256-verified").codes).not.toContain("MERIT_SHA256_CHECK_FAILED")
		expect(run(null).codes).not.toContain("MERIT_TILES_NOT_HASH_VERIFIED")
	})
})

describe("seam rule: skip the streamed tier only in interior tiles; keep it faint beneath MERIT on seams", () => {
	const seg = [
		{
			path: [
				[0, 0],
				[1, 1],
			],
			order: 5,
			riverId: 1,
		},
	] as never
	const reader = { getTile: async () => seg } as never
	const build = (covers: boolean, interior: boolean) => {
		let loaded = 0
		const tiles = { covers: async () => covers, isInterior: async () => interior } as unknown as MeritTiles
		const layers = buildRiverLayers({
			theme: "light",
			zoom: 5,
			reader,
			degraded: false,
			retry: 0,
			onTileLoad: () => loaded++,
			onTileError: () => undefined,
			merit: { tiles, coversView: true, ...noopMerit },
		}) as Array<{ id: string; props: any }>
		const streamed = layers.find((l) => l.id.startsWith("basemap-rivers"))
		return { streamed: streamed as { props: any }, loaded: () => loaded }
	}
	const idx = { index: { x: 1, y: 1, z: 5 } }
	it("no MERIT in the tile: the streamed tile is returned as is, at full opacity", async () => {
		const { streamed, loaded } = build(false, false)
		const data = await streamed.props.getTileData(idx)
		expect(data).toBe(seg)
		streamed.props.onTileLoad({ content: data })
		expect(loaded()).toBe(1)
		expect(streamed.props.renderSubLayers({ id: "t", data }).props.opacity).toBe(1)
	})
	it("interior tile (all 8 neighbours covered): the streamed tile is skipped and not reported loaded", async () => {
		const { streamed, loaded } = build(true, true)
		const data = await streamed.props.getTileData(idx)
		expect(data).toEqual([])
		streamed.props.onTileLoad({ content: data })
		expect(loaded()).toBe(0)
	})
	it("seam tile (covered, a neighbour is not): the streamed tile is kept, drawn at reduced opacity", async () => {
		const { streamed, loaded } = build(true, false)
		const data = await streamed.props.getTileData(idx)
		expect(data).toEqual(seg)
		expect(data).not.toBe(seg)
		streamed.props.onTileLoad({ content: data })
		expect(loaded()).toBe(1)
		const opacity = streamed.props.renderSubLayers({ id: "t", data }).props.opacity
		expect(opacity).toBeLessThan(1)
		expect(opacity).toBeGreaterThan(0)
	})
	it("MeritTiles.isInterior: needs MERIT in the tile and all 8 neighbours, and the world edge is never interior", async () => {
		const tileBytes = encodeMvtLayer("rivers_z0", [
			{
				props: { comid: 1, uparea: 20000, sorder: 3, lengthkm: 1 },
				lines: [
					[
						[100, 100],
						[900, 900],
					],
				],
			},
		])
		const tiles3x3 = new Map<string, Uint8Array>()
		for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) tiles3x3.set(`2/${x}/${y}`, tileBytes)
		const bytes = buildPmtiles(tiles3x3, { minZoom: 0, maxZoom: 12, bounds: [-180, -85, 180, 85], gzip: false })
		const offer = {
			id: "rivers72",
			region: "72",
			minZoom: 0,
			maxZoom: 12,
			bounds: [-180, -85, 180, 85],
			layers: [],
			provenance: {},
		} as never
		const tiles = new MeritTiles([offer], {
			decompress,
			source: { getKey: () => "f", getBytes: async (o, l) => ({ data: bytes.slice(o, o + l).buffer as ArrayBuffer }) },
		})
		expect(await tiles.covers(2, 1, 1)).toBe(true)
		expect(await tiles.isInterior(2, 1, 1)).toBe(true)
		expect(await tiles.isInterior(2, 0, 1)).toBe(false) // x = -1 wraps to tile 3, which the archive lacks
		expect(await tiles.isInterior(2, 2, 2)).toBe(false) // neighbour (3, 3) lacks MERIT
		expect(await tiles.isInterior(2, 1, 0)).toBe(false) // north edge of the world
	})
})

describe("with no MERIT archives the river layers are the 0.4.12 layers", () => {
	const base = {
		theme: "light" as const,
		reader: new RiverTileReader("https://example.test/s.pmtiles", {
			fetchImpl: async () => new Response("x", { status: 500 }),
		}),
		degraded: false,
		retry: 0,
		onTileLoad: () => undefined,
		onTileError: () => undefined,
	}
	it("merit: null changes nothing, at every zoom and in the degraded state", () => {
		for (const zoom of [1, 3, 5, 9, 13])
			for (const degraded of [false, true]) {
				const without = buildRiverLayers({ ...base, zoom, degraded }) as Array<{ id: string; props: any }>
				const withNull = buildRiverLayers({ ...base, zoom, degraded, merit: null }) as Array<{ id: string; props: any }>
				expect(withNull.map((l) => l.id)).toEqual(without.map((l) => l.id))
				expect(withNull.map((l) => l.props.updateTriggers)).toEqual(without.map((l) => l.props.updateTriggers))
				expect(withNull.some((l) => l.id.startsWith("merit-rivers-"))).toBe(false)
			}
		const streamed = (buildRiverLayers({ ...base, zoom: 5, merit: null }) as Array<{ id: string; props: any }>).find((l) =>
			l.id.startsWith("basemap-rivers"),
		)
		expect(Object.keys(streamed?.props.updateTriggers)).toEqual(["renderSubLayers"])
	})
})
