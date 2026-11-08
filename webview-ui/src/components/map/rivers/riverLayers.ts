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
 */
import { TileLayer } from "@deck.gl/geo-layers"
import { PathLayer, PolygonLayer } from "@deck.gl/layers"
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
}

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
	const { theme, zoom, reader, degraded, retry } = input
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
	layers.push(
		new TileLayer({
			// The theme is in the id so a theme switch redraws (and re-credits) from the already cached bytes.
			id: `${RIVER_TALLY_ID}-${theme}-${retry}`,
			minZoom: VECTOR_RIVER_MIN_ZOOM,
			maxZoom: GEOGLOWS_MAX_ZOOM,
			// The archive's tiles are 512 px designs (deck's world is 512 px at zoom 0): tile z equals map zoom.
			tileSize: 512,
			getTileData: (tile: { index: { x: number; y: number; z: number }; signal?: AbortSignal }) =>
				reader.getTile(tile.index.z, tile.index.x, tile.index.y, tile.signal),
			onTileLoad: input.onTileLoad,
			onTileError: input.onTileError,
			// Sublayers are rebuilt when this changes (deck regenerates cached tile layers on an updateTrigger).
			updateTriggers: { renderSubLayers: [theme, minOrder] },
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
					capRounded: true,
					jointRounded: true,
					pickable: false,
				} as never)
			},
		} as never),
	)
	return layers
}
