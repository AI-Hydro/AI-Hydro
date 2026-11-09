/**
 * River styling for the vector river layer (pure functions; no React, no deck.gl).
 *
 * Design: `docs/vision-2040/findings/hydrology-basemap-2026-11-08.md` section 3 (rules W1, Z1) and section 4
 * (style specs S1 light "research print" and S2 dark "analysis").
 *
 * The GEOGLOWS tiles carry only `riverId` and `strahlerOrder`: there is NO upstream area in them. So width, colour
 * and the zoom-band density rule all key on Strahler order, which stands in for log10(upstream area). That is a
 * proxy, not a measurement: the network is TDX-Hydro (12 m source), whose orders run higher than a 90 m network's for
 * the same river, and an order does not map to one fixed area. Docs and comments say "Strahler order", never km2 (the map has no legend for it yet).
 * (MERIT-Basins tiles with `uparea`, slice B2, will replace the proxy where they exist.)
 */

export type RiverTheme = "light" | "dark"
export type Rgb = [number, number, number]
export type Rgba = [number, number, number, number]

/** Strahler orders are clamped to this range before styling (the Mississippi, Amazon and Nile reach 9-10 in TDX-Hydro). */
export const RIVER_ORDER_MIN = 1
export const RIVER_ORDER_MAX = 10

/**
 * S1 (light): Crameri devon reversed, 0.20 to 1.0. Small reaches are pale, trunk rivers dark violet-navy.
 * S2 (dark): Crameri oslo, 0.30 to 1.0. Small reaches are dim steel blue, trunk rivers glow white.
 * Both ramps are monotone in lightness and a single hue family, so they read under colour-vision deficiency and in
 * greyscale; colour and width encode the same variable (redundant encoding).
 */
export const RIVER_RAMP: Record<RiverTheme, readonly string[]> = {
	light: ["#d5d1f6", "#b3adef", "#7389d8", "#3266a7", "#283f72", "#2c1a4c"],
	dark: ["#1a446d", "#3767a6", "#6e90c8", "#99abc9", "#c9cdd4", "#ffffff"],
}

/** Water bodies (S1 / S2). */
export const LAKE_STYLE: Record<RiverTheme, { fill: string; edge: string }> = {
	light: { fill: "#DCE6EC", edge: "#8FA9BC" },
	dark: { fill: "#0F2433", edge: "#2F6C8F" },
}

export function hexToRgb(hex: string): Rgb {
	const value = Number.parseInt(hex.replace("#", ""), 16)
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function clampOrder(order: number): number {
	if (!Number.isFinite(order)) return RIVER_ORDER_MIN
	return Math.min(RIVER_ORDER_MAX, Math.max(RIVER_ORDER_MIN, order))
}

/** Position of an order along the ramp, 0 (order 1) to 1 (order 10). */
export function orderPosition(order: number): number {
	return (clampOrder(order) - RIVER_ORDER_MIN) / (RIVER_ORDER_MAX - RIVER_ORDER_MIN)
}

/** Linear blend between the ramp's stops (the stops are already perceptually spaced). */
export function rampColor(position: number, theme: RiverTheme): Rgb {
	const stops = RIVER_RAMP[theme].map(hexToRgb)
	const scaled = Math.min(1, Math.max(0, position)) * (stops.length - 1)
	const lower = Math.min(stops.length - 2, Math.floor(scaled))
	const frac = scaled - lower
	return [0, 1, 2].map((i) => Math.round(stops[lower][i] + (stops[lower + 1][i] - stops[lower][i]) * frac)) as Rgb
}

/**
 * Opacity 0..255. Light: opaque. Dark: small reaches need about 50% or the map turns into a mat (design section 4);
 * from order 7 up the rivers are fully opaque.
 */
export function riverAlpha(order: number, theme: RiverTheme): number {
	if (theme === "light") return 255
	const t = Math.min(1, (clampOrder(order) - RIVER_ORDER_MIN) / 6)
	return Math.round(255 * (0.5 + 0.5 * t))
}

export function riverColor(order: number, theme: RiverTheme): Rgba {
	const [r, g, b] = rampColor(orderPosition(order), theme)
	return [r, g, b, riverAlpha(order, theme)]
}

/** Stroke width in CSS pixels: 0.6 px at order 1 to 4.2 px at order 10 (rule W1's 0.6 to about 4.1 px range). */
export function riverWidthPx(order: number): number {
	return 0.6 + 0.4 * (clampOrder(order) - RIVER_ORDER_MIN)
}

/**
 * Lowest Strahler order drawn at a map zoom (rule Z1's area bands, expressed as orders). Chosen from the order
 * counts of real GEOGLOWS tiles over the Mississippi basin (2026-11-09), so a 1440x900 view stays under the
 * design's 30k-segment budget (measured 13.9k drawn at CONUS zoom 4, 24k at zoom 5): z<3 order 9+, z3 8+, z4 7+, z5 6+, z6 5+, z7 4+, z8 and deeper all. The archive itself already drops
 * orders below 6 under zoom 6, below 4 under zoom 8, so the deep bands only thin what the archive sends.
 */
export function minOrderForZoom(zoom: number): number {
	const z = Math.floor(zoom)
	if (z < 3) return 9
	if (z >= 8) return RIVER_ORDER_MIN
	return 11 - z
}

/** Band index for memo keys: the layer is rebuilt only when this changes, not on every zoom tick. */
export function riverBand(zoom: number): number {
	return minOrderForZoom(zoom)
}

/**
 * Natural Earth `scalerank` (1 = largest river class, 6 = smallest kept) as a Strahler-order stand-in, so the
 * coarse offline tier uses the same ramp and widths: rank 1 -> 9, rank 6 -> 4.
 */
export function orderFromNaturalEarthRank(scalerank: number): number {
	return clampOrder(10 - scalerank)
}

/** Below this map zoom the bundled Natural Earth rivers are drawn instead of fetching GEOGLOWS tiles. */
export const VECTOR_RIVER_MIN_ZOOM = 3
/** Natural Earth lakes are drawn below this whole zoom (GEOGLOWS has no water bodies; the base map draws them beyond). */
export const NATURAL_EARTH_LAKE_ZOOM_LIMIT = 7

/** The river lines come from the bundled Natural Earth tier at this zoom (below the streamed tier's first zoom). */
/** `zoom` is the whole map zoom (Math.floor of the view zoom), so the layers rebuild only when it changes. */
export function usesBundledRivers(zoom: number, degraded: boolean): boolean {
	return degraded || zoom < VECTOR_RIVER_MIN_ZOOM
}

export function lakesVisible(zoom: number, degraded: boolean): boolean {
	return degraded || zoom < NATURAL_EARTH_LAKE_ZOOM_LIMIT
}
