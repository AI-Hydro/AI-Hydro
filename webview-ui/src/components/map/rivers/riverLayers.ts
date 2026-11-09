/**
 * deck.gl layers for the river tier of the hydrology basemap: streamed GEOGLOWS vector tiles, plus the bundled
 * Natural Earth rivers and lakes for low zoom and for when the streamed tier is unreachable.
 *
 * Which tier draws what (the design's tier plan, with the zoom switch tested in riverStyle.test.ts):
 *   - zoom < 3, or the streamed tier degraded -> Natural Earth rivers; no GEOGLOWS tile is requested;
 *   - zoom >= 3 and the streamed tier healthy -> GEOGLOWS tiles only (the two generalisations of the same river
 *     do not coincide, so they are never drawn together);
 *   - Natural Earth lakes up to zoom 6, and whenever degraded (GEOGLOWS has no water bodies).
 * No labels are drawn here: the base map carries the one set of place and water names.
 *
 * The local MERIT tier (slice B2, meritRivers.ts) is drawn above these, from the same zoom as the streamed tier. Layer order
 * and blending, bottom to top: Natural Earth lakes, Natural Earth rivers (only below zoom 3, or when the streamed tier is
 * degraded and no MERIT archive covers the view), GEOGLOWS tiles, MERIT tiles. Rule: MERIT where an archive has river
 * features in a tile, GEOGLOWS elsewhere. A GEOGLOWS tile is not drawn when a MERIT tile exists at the same z/x/y (two
 * generalisations of the same river are never drawn together), so a tile on an archive's edge shows MERIT only. There is
 * no blending: both layers are opaque and never overlap.
 */
import { TileLayer } from "@deck.gl/geo-layers"
import { PathLayer, PolygonLayer } from "@deck.gl/layers"
import { buildMeritLayer, type MeritLayerInputs, type MeritTiles } from "./meritRivers"
import { naturalEarthHydro } from "./naturalEarthHydro"
import type { RiverTileReader, RiverTileSegments } from "./pmtilesRivers"
import { GEOGLOWS_MAX_ZOOM, RIVER_TALLY_ID } from "./riverSources"
import {
	hexToRgb,
	LAKE_STYLE,
	lakesVisible,
	minOrderForZoom,
	type Rgba,
	type RiverTheme,
	riverColor,
	riverWidthPx,
	usesBundledRivers,
	VECTOR_RIVER_MIN_ZOOM,
} from "./riverStyle"

const ROUNDED_JOIN_MIN_ZOOM = 6

export interface RiverLayerInputs {
	theme: RiverTheme
	/** Map zoom. Only its band (see riverBand) matters for rebuilds, but the caller passes the live value. */
	zoom: number
	/** The streamed tier; null when the basemap has none. */
	reader: RiverTileReader | null
	/** Streamed tier unreachable: draw the bundled tier everywhere and request nothing. */
	degraded: boolean
	/** Changes with a Retry so tiles are requested afresh. */
	retry: number
	onTileLoad: () => void
	onTileError: (error: unknown) => void
	/** Local MERIT archives, when any are offered and enabled. */
	merit?: {
		tiles: MeritTiles
		/** An archive's bounds contain the view centre: the bundled rivers are then not drawn under it when degraded. */
		coversView: boolean
		onTileLoad: MeritLayerInputs["onTileLoad"]
		onViewportLoad: MeritLayerInputs["onViewportLoad"]
		onTileError: MeritLayerInputs["onTileError"]
	} | null
}

/** A streamed tile that was not fetched because a MERIT tile covers it. Not reported as loaded (it draws nothing and credits nothing). */
const COVERED_BY_MERIT: RiverTileSegments = []

/** First index whose order is at least `min` in a list sorted by ascending order. */
export function firstAtOrAbove(segments: RiverTileSegments, min: number): number {
	let lo = 0
	let hi = segments.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (segments[mid].order < min) lo = mid + 1
		else hi = mid
	}
	return lo
}

const withAlpha = (hex: string, alpha: number): Rgba => {
	const [r, g, b] = hexToRgb(hex)
	return [r, g, b, alpha]
}

export function buildRiverLayers(input: RiverLayerInputs): unknown[] {
	const layers = buildStreamedAndBundledLayers(input)
	const { merit, theme, zoom, retry } = input
	if (merit && zoom >= VECTOR_RIVER_MIN_ZOOM) {
		layers.push(
			buildMeritLayer({
				tiles: merit.tiles,
				theme,
				zoom,
				retry,
				onTileLoad: merit.onTileLoad,
				onViewportLoad: merit.onViewportLoad,
				onTileError: merit.onTileError,
			}),
		)
	}
	return layers
}

function buildStreamedAndBundledLayers(input: RiverLayerInputs): unknown[] {
	const { theme, zoom, reader, degraded, retry, merit } = input
	const layers: unknown[] = []
	const ne = naturalEarthHydro()
	const lake = LAKE_STYLE[theme]

	if (lakesVisible(zoom, degraded)) {
		layers.push(
			new PolygonLayer({
				id: `rivers-ne-lakes-${theme}`,
				data: ne.lakes,
				getPolygon: (d: [number, number][][]) => d as never,
				getFillColor: withAlpha(lake.fill, 235),
				getLineColor: withAlpha(lake.edge, 255),
				stroked: true,
				lineWidthUnits: "pixels",
				getLineWidth: 0.6,
				lineWidthMinPixels: 0.5,
				pickable: false,
			} as never),
		)
	}

	if (usesBundledRivers(zoom, degraded) || !reader) {
		// A degraded streamed tier falls back to Natural Earth; where a MERIT archive covers the view that would be a
		// second, coarser generalisation under it, so it is left out.
		if (zoom >= VECTOR_RIVER_MIN_ZOOM && merit?.coversView) return layers
		layers.push(
			new PathLayer({
				id: `rivers-ne-rivers-${theme}`,
				data: ne.rivers,
				getPath: (d: { path: [number, number][] }) => d.path,
				getColor: (d: { order: number }) => riverColor(d.order, theme),
				getWidth: (d: { order: number }) => riverWidthPx(d.order),
				widthUnits: "pixels",
				widthMinPixels: 0.5,
				capRounded: true,
				jointRounded: true,
				pickable: false,
			} as never),
		)
		return layers
	}

	const minOrder = minOrderForZoom(zoom)
	// Rounded caps and joints cost extra geometry per segment and are invisible on thin lines: only from zoom 6.
	const rounded = zoom >= ROUNDED_JOIN_MIN_ZOOM
	layers.push(
		new TileLayer({
			// The theme is in the id so a theme switch redraws (and re-credits); the reader's decoded-tile cache avoids refetching.
			id: `${RIVER_TALLY_ID}-${theme}-${retry}`,
			minZoom: VECTOR_RIVER_MIN_ZOOM,
			maxZoom: GEOGLOWS_MAX_ZOOM,
			// The archive's tiles are 512 px designs (deck's world is 512 px at zoom 0): tile z equals map zoom.
			tileSize: 512,
			getTileData: async (tile: { index: { x: number; y: number; z: number }; signal?: AbortSignal }) => {
				const { x, y, z } = tile.index
				if (merit && (await merit.tiles.covers(z, x, y, tile.signal))) return COVERED_BY_MERIT
				return reader.getTile(z, x, y, tile.signal)
			},
			onTileLoad: (tile: { content?: unknown }) => {
				if (tile.content !== COVERED_BY_MERIT) input.onTileLoad()
			},
			onTileError: input.onTileError,
			// Sublayers are rebuilt when this changes (deck regenerates cached tile layers on an updateTrigger).
			updateTriggers: { renderSubLayers: [theme, minOrder, rounded], ...(merit ? { getTileData: [merit.tiles] } : {}) },
			renderSubLayers: (props: { id: string; data?: RiverTileSegments | null }) => {
				const segments = props.data
				if (!segments || segments.length === 0) return null
				// Do not set `_pathType: "open"`: with nested [x, y] paths deck 9.3 then draws nothing (found in the screen harness).
				return new PathLayer({
					...(props as object),
					id: `${props.id}-paths`,
					data: segments.slice(firstAtOrAbove(segments, minOrder)),
					getPath: (d: { path: [number, number][] }) => d.path,
					getColor: (d: { order: number }) => riverColor(d.order, theme),
					getWidth: (d: { order: number }) => riverWidthPx(d.order),
					widthUnits: "pixels",
					widthMinPixels: 0.5,
					capRounded: rounded,
					jointRounded: rounded,
					pickable: false,
				} as never)
			},
		} as never),
	)
	return layers
}
