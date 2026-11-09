/**
 * The local MERIT-Basins river tier (basemap slice B2): decodes the host-served PMTiles archives and builds the deck layer.
 *
 * All five area-band layers are decoded (`MERIT_LAYER_NAMES`); width and colour come from `uparea` (rules W1, S1/S2 in
 * riverStyle.ts), not from Strahler order. Segments keep `comid`, `uparea`, `sorder`, `lengthkm`, the band and the
 * archive id, so a click can show them and name the file they came from. A missing `uparea` stays `null`; it is never 0.
 */
import { TileLayer } from "@deck.gl/geo-layers"
import { PathLayer } from "@deck.gl/layers"
import { MERIT_ATTR, MERIT_LAYER_NAMES, MERIT_LAYER_PREFIX, type MeritArchiveOffer } from "@shared/map/meritTileContract"
import { type Compression, type Header, PMTiles, type Source } from "pmtiles"
import { HostRangeSource, type HostTransport } from "./hostRangeSource"
import { DECODED_TILE_LIMIT, decodeMvtFeatures, type GeoJsonLikeFeature, type RangeStats } from "./pmtilesRivers"
import { GEOGLOWS_MAX_ZOOM } from "./riverSources"
import { type RiverTheme, riverColorForUparea, riverWidthPxForUparea, VECTOR_RIVER_MIN_ZOOM } from "./riverStyle"

export interface MeritSegment {
	/** [lon, lat] pairs. */
	path: [number, number][]
	comid: number
	/** Upstream area, km2; `null` when the tile has none. */
	uparea: number | null
	sorder: number | null
	lengthkm: number | null
	/** The area-band layer the reach is in (`rivers_z0` ... `rivers_z11`). */
	band: string
	archiveId: string
}

const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null)

/** Segments of one tile, ascending by `uparea` (no area first) so the large rivers are drawn last, on top at confluences. */
export function meritSegmentsFromFeatures(features: GeoJsonLikeFeature[], archiveId: string): MeritSegment[] {
	const out: MeritSegment[] = []
	for (const feature of features) {
		const geometry = feature.geometry
		if (!geometry) continue
		const props = feature.properties ?? {}
		const comid = numberOrNull(props[MERIT_ATTR.comid])
		if (comid === null) continue
		const lines =
			geometry.type === "LineString"
				? [geometry.coordinates as [number, number][]]
				: geometry.type === "MultiLineString"
					? (geometry.coordinates as [number, number][][])
					: []
		for (const path of lines) {
			if (path.length < 2) continue
			out.push({
				path,
				comid,
				uparea: numberOrNull(props[MERIT_ATTR.uparea]),
				sorder: numberOrNull(props[MERIT_ATTR.sorder]),
				lengthkm: numberOrNull(props[MERIT_ATTR.lengthkm]),
				band: typeof props.layerName === "string" ? props.layerName : "",
				archiveId,
			})
		}
	}
	return out.sort((a, b) => (a.uparea ?? -1) - (b.uparea ?? -1))
}

export interface MeritReaderOptions {
	transport?: HostTransport
	/** A different byte source (tests). */
	source?: Source
	decompress?: (buf: ArrayBuffer, compression: Compression) => Promise<ArrayBuffer>
}

/** One archive: byte reads through the host, an LRU of decoded tiles. */
export class MeritTileReader {
	readonly stats: RangeStats
	private readonly archive: PMTiles
	private readonly decoded = new Map<string, MeritSegment[]>()
	/** Reads in progress, so the layer and the coverage checks of its neighbours share one read per tile. */
	private readonly inflight = new Map<string, Promise<MeritSegment[]>>()
	constructor(
		readonly offer: MeritArchiveOffer,
		options: MeritReaderOptions = {},
	) {
		const source = options.source ?? new HostRangeSource(offer.id, options.transport)
		this.stats = (source as { stats?: RangeStats }).stats ?? { requests: 0, bytes: 0, failures: 0 }
		this.archive = new PMTiles(source, undefined, options.decompress)
	}

	header(): Promise<Header> {
		return this.archive.getHeader()
	}

	/** Segments of one tile; an empty list for a tile the archive does not hold. Failures and cancelled reads are not cached. */
	async getTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<MeritSegment[]> {
		const key = `${z}/${x}/${y}`
		const hit = this.decoded.get(key)
		if (hit) {
			this.decoded.delete(key)
			this.decoded.set(key, hit)
			return hit
		}
		let pending = this.inflight.get(key)
		if (!pending) {
			// The shared read is not tied to one caller's signal; each caller still rejects at once when its own signal aborts.
			pending = this.load(z, x, y, key).finally(() => this.inflight.delete(key))
			this.inflight.set(key, pending)
		}
		return signal ? raceAbort(pending, signal) : pending
	}

	private async load(z: number, x: number, y: number, key: string): Promise<MeritSegment[]> {
		const response = await this.archive.getZxy(z, x, y)
		const segments = response
			? meritSegmentsFromFeatures(
					await decodeMvtFeatures(response.data, { x, y, z }, MERIT_LAYER_NAMES, "layerName"),
					this.offer.id,
				)
			: []
		this.decoded.set(key, segments)
		if (this.decoded.size > DECODED_TILE_LIMIT) this.decoded.delete(this.decoded.keys().next().value as string)
		return segments
	}
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"))
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new DOMException("aborted", "AbortError"))
		signal.addEventListener("abort", onAbort, { once: true })
		promise.then(
			(v) => (signal.removeEventListener("abort", onAbort), resolve(v)),
			(e) => (signal.removeEventListener("abort", onAbort), reject(e)),
		)
	})
}

/** Lon/lat bounds [west, south, east, north] of tile (z, x, y). */
export function tileLonLatBounds(z: number, x: number, y: number): [number, number, number, number] {
	const n = 2 ** z
	const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI
	return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)]
}

const boxesIntersect = (a: readonly number[], b: readonly number[]) =>
	a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

/**
 * Every archive offered for the map. A tile is read from each archive whose header bounds touch it and the segments are
 * concatenated (a boundary tile can exist in two regional archives), so a pick always names the right archive.
 */
export class MeritTiles {
	readonly readers: MeritTileReader[]
	constructor(
		readonly offers: readonly MeritArchiveOffer[],
		options: MeritReaderOptions = {},
	) {
		this.readers = offers.map((offer) => new MeritTileReader(offer, options))
	}

	async getTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<MeritSegment[]> {
		const box = tileLonLatBounds(z, x, y)
		const parts = await Promise.all(
			this.readers
				.filter((reader) => z >= reader.offer.minZoom && boxesIntersect(reader.offer.bounds, box))
				.map((reader) => reader.getTile(z, x, y, signal)),
		)
		if (parts.length === 0) return []
		return parts.length === 1 ? parts[0] : parts.flat().sort((a, b) => (a.uparea ?? -1) - (b.uparea ?? -1))
	}

	/** True when a MERIT archive has river features in this tile. A read failure is "not covered" (the streamed tier then draws). */
	async covers(z: number, x: number, y: number, signal?: AbortSignal): Promise<boolean> {
		try {
			return (await this.getTile(z, x, y, signal)).length > 0
		} catch (error) {
			if ((error as { name?: string })?.name === "AbortError") throw error
			return false
		}
	}

	/**
	 * True when the tile and all 8 neighbours at the same zoom have MERIT features: the streamed tier can be left out of it
	 * with no river gap. A neighbour outside every archive's bounds is not read (it is simply not covered). Neighbours are
	 * read through the same decoded-tile cache the MERIT layer uses, so tiles in view cost no extra read; only the ring just
	 * outside the view does. A failed read counts as not covered (the tile then keeps a faint streamed layer beneath).
	 */
	async isInterior(z: number, x: number, y: number, signal?: AbortSignal): Promise<boolean> {
		const n = 2 ** z
		const checks: Promise<boolean>[] = []
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++) {
				const ny = y + dy
				if (ny < 0 || ny >= n) return false // the world's edge: nothing beyond it is covered
				checks.push(this.covers(z, (((x + dx) % n) + n) % n, ny, signal))
			}
		return (await Promise.all(checks)).every(Boolean)
	}

	offerById(id: string): MeritArchiveOffer | undefined {
		return this.offers.find((offer) => offer.id === id)
	}
}

/**
 * The credit is due while MERIT features are drawn in view: a loaded, visible tile with at least one segment.
 * (Over-crediting for a moment while panning is acceptable; under-crediting is not.)
 */
export function meritCreditVisible(tiles: ReadonlyArray<{ isVisible?: boolean; content?: unknown }>): boolean {
	return tiles.some((tile) => tile.isVisible !== false && Array.isArray(tile.content) && tile.content.length > 0)
}

export interface MeritLayerInputs {
	tiles: MeritTiles
	theme: RiverTheme
	zoom: number
	retry: number
	onTileLoad: (tile: { isVisible?: boolean; content?: unknown }) => void
	onViewportLoad: (tiles: Array<{ isVisible?: boolean; content?: unknown }>) => void
	onTileError: (error: unknown) => void
}

const ROUNDED_JOIN_MIN_ZOOM = 6

/** The MERIT tile layer; its id, and its sublayers' ids, start with `merit-rivers-` and the segments are pickable. */
export function buildMeritLayer(input: MeritLayerInputs): unknown {
	const { tiles, theme, zoom } = input
	const rounded = zoom >= ROUNDED_JOIN_MIN_ZOOM
	return new TileLayer({
		id: `${MERIT_LAYER_PREFIX}tiles-${theme}-${input.retry}`,
		minZoom: VECTOR_RIVER_MIN_ZOOM,
		maxZoom: GEOGLOWS_MAX_ZOOM,
		tileSize: 512,
		getTileData: (tile: { index: { x: number; y: number; z: number }; signal?: AbortSignal }) =>
			tiles.getTile(tile.index.z, tile.index.x, tile.index.y, tile.signal),
		onTileLoad: input.onTileLoad,
		onViewportLoad: input.onViewportLoad,
		onTileError: input.onTileError,
		// A rebuilt or withdrawn archive makes a new MeritTiles: refetch, so no stale tile stays on screen or in an export.
		updateTriggers: { renderSubLayers: [theme, rounded], getTileData: [tiles] },
		renderSubLayers: (props: { id: string; data?: MeritSegment[] | null }) => {
			const segments = props.data
			if (!segments || segments.length === 0) return null
			return new PathLayer({
				...(props as object),
				id: `${props.id}-paths`,
				data: segments,
				getPath: (d: MeritSegment) => d.path,
				getColor: (d: MeritSegment) => riverColorForUparea(d.uparea, theme),
				getWidth: (d: MeritSegment) => riverWidthPxForUparea(d.uparea),
				widthUnits: "pixels",
				widthMinPixels: 0.5,
				capRounded: rounded,
				jointRounded: rounded,
				pickable: true,
			} as never)
		},
	} as never)
}
