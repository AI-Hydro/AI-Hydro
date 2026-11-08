/**
 * Reads river tiles from a remote PMTiles archive (GEOGLOWS v2 `streams.pmtiles`) with HTTP range requests.
 *
 * No worker and no CDN: the tile bytes come through `fetch` (the webview CSP already allows `connect-src https:`;
 * no host was added for GEOGLOWS) and are decoded on the main thread by `@loaders.gl/mvt` (the non-worker
 * `MVTLoader`, so nothing is fetched from a CDN and offline use is not broken by a worker script).
 *
 * Only tile requests leave the machine: byte ranges of a public file. No workspace or user content is sent; the host
 * can see the byte ranges (tile coordinates), the IP address and the user agent.
 *
 * A tile the archive does not contain (open ocean) is an empty tile, not an error. A missing archive (HTTP 404 on
 * the file) is worded "status 404", not "HTTP 404", so tile health counts it as a real failure and not as a
 * "no tile here" coverage gap.
 */
import { MVTLoader } from "@loaders.gl/mvt"
import { type Compression, type Header, PMTiles, type RangeResponse, type Source } from "pmtiles"
import { STREAMS_LAYER } from "./riverSources"

export interface RangeStats {
	/** Range requests answered (any status). */
	requests: number
	/** Response body bytes received. */
	bytes: number
	/** Requests that failed (network error or non-success status). */
	failures: number
}

export function newRangeStats(): RangeStats {
	return { requests: 0, bytes: 0, failures: 0 }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * A pmtiles `Source` over `fetch` with a `Range` header. Differences from the library's `FetchSource`: the fetch
 * function and counters are injectable (tests run with no network; the map reports bytes), and a server that
 * answers 200 to a range request is refused without reading the body (it would be the whole archive, GBs).
 */
export class RangeFetchSource implements Source {
	private etag: string | undefined
	constructor(
		private readonly url: string,
		private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
		readonly stats: RangeStats = newRangeStats(),
	) {}

	getKey(): string {
		return this.url
	}

	async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
		this.stats.requests += 1
		let response: Response
		try {
			response = await this.fetchImpl(this.url, {
				signal,
				headers: { Range: `bytes=${offset}-${offset + length - 1}` },
			})
		} catch (error) {
			if ((error as { name?: string })?.name !== "AbortError") this.stats.failures += 1
			throw error
		}
		if (response.status === 404) {
			this.stats.failures += 1
			throw new Error("River tile archive not found (status 404). The file may have moved.")
		}
		const declared = Number(response.headers.get("content-length"))
		if (response.status === 200 && !(Number.isFinite(declared) && declared > 0 && declared <= offset + length)) {
			// The server ignored the Range header; do not download the archive.
			void response.body?.cancel().catch(() => undefined)
			this.stats.failures += 1
			throw new Error("River tile server does not support byte ranges, so the archive is not downloaded.")
		}
		if (!response.ok) {
			this.stats.failures += 1
			throw new Error(`River tile request failed (status ${response.status})`)
		}
		const data = await response.arrayBuffer()
		this.stats.bytes += data.byteLength
		const etag = response.headers.get("etag") ?? undefined
		if (etag) {
			if (this.etag && this.etag !== etag) {
				this.stats.failures += 1
				throw new Error("The river archive changed while the map was open. Choose Retry to reload it.")
			}
			this.etag = etag
		}
		return { data, etag, cacheControl: response.headers.get("cache-control") ?? undefined }
	}
}

/** One decoded river segment. `path` is [lon, lat] pairs. */
export interface RiverSegment {
	path: [number, number][]
	order: number
	/** GEOGLOWS river id (LINKNO), kept for picking and later discharge joins. */
	riverId: number
}

/** Segments of one tile, sorted by ascending order so larger rivers are drawn last (on top at confluences). */
export type RiverTileSegments = RiverSegment[]

interface GeoJsonLikeFeature {
	geometry: { type: string; coordinates: unknown } | null
	properties?: Record<string, unknown>
}

export function segmentsFromFeatures(features: GeoJsonLikeFeature[]): RiverTileSegments {
	const out: RiverSegment[] = []
	for (const feature of features) {
		const geometry = feature.geometry
		if (!geometry) continue
		const order = Number(feature.properties?.strahlerOrder)
		if (!Number.isFinite(order)) continue
		const riverId = Number(feature.properties?.riverId ?? 0)
		const lines =
			geometry.type === "LineString"
				? [geometry.coordinates as [number, number][]]
				: geometry.type === "MultiLineString"
					? (geometry.coordinates as [number, number][][])
					: []
		for (const path of lines) if (path.length >= 2) out.push({ path, order, riverId })
	}
	return out.sort((a, b) => a.order - b.order)
}

/** Decodes MVT bytes (already decompressed) into river segments in lon/lat. */
export async function decodeRiverTile(
	bytes: ArrayBuffer,
	index: { x: number; y: number; z: number },
): Promise<RiverTileSegments> {
	const parsed = (await MVTLoader.parse(bytes, {
		mvt: { shape: "geojson", coordinates: "wgs84", tileIndex: index, layers: [STREAMS_LAYER] },
	} as never)) as unknown as GeoJsonLikeFeature[]
	return segmentsFromFeatures(parsed)
}

export interface RiverTileReaderOptions {
	fetchImpl?: FetchLike
	/** Replaces the library's DecompressionStream-based decompression (tests; very old webviews). */
	decompress?: (buf: ArrayBuffer, compression: Compression) => Promise<ArrayBuffer>
}

/** Decoded tiles kept per reader (a CONUS view at zoom 5 holds about 24k segments; 128 tiles is a few tens of MB at most). */
export const DECODED_TILE_LIMIT = 128

export class RiverTileReader {
	readonly stats: RangeStats
	private readonly archive: PMTiles
	private readonly decoded = new Map<string, RiverTileSegments>()
	constructor(
		readonly url: string,
		options: RiverTileReaderOptions = {},
	) {
		const source = new RangeFetchSource(url, options.fetchImpl)
		this.stats = source.stats
		this.archive = new PMTiles(source, undefined, options.decompress)
	}

	/** Archive header: zoom range and bounds. Rejects (and keeps rejecting) when the archive cannot be reached. */
	header(): Promise<Header> {
		return this.archive.getHeader()
	}

	/**
	 * Segments of one tile; an empty list for a tile the archive does not contain (open ocean, no rivers).
	 * The last DECODED_TILE_LIMIT tiles are kept, so a theme switch (which rebuilds the deck layer) or a pan back
	 * does not fetch and decode them again. Failures and cancelled reads are not cached.
	 */
	async getTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<RiverTileSegments> {
		const key = `${z}/${x}/${y}`
		const hit = this.decoded.get(key)
		if (hit) {
			this.decoded.delete(key)
			this.decoded.set(key, hit)
			return hit
		}
		const response = await this.archive.getZxy(z, x, y, signal)
		const segments = response ? await decodeRiverTile(response.data, { x, y, z }) : []
		this.decoded.set(key, segments)
		if (this.decoded.size > DECODED_TILE_LIMIT) this.decoded.delete(this.decoded.keys().next().value as string)
		return segments
	}
}
