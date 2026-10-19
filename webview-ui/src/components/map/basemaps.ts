/**
 * Basemap catalogue and resolution (pure data and functions; no React, no deck.gl).
 *
 * Every entry is a raster tile pyramid drawn by deck.gl's TileLayer. Entries carry the facts the renderer and
 * the error UI need so they are never guessed at draw time:
 *   - maxNativeZoom: the deepest level the source actually serves. TileLayer.maxZoom is set to it, so deck
 *     overzooms that level instead of requesting levels that do not exist (404).
 *   - extent: lon/lat bounds of the source. Tiles outside it are not requested (USGS caches are US only).
 *   - attribution: what the licence requires, shown for what is actually drawn.
 *
 * Tile hosts in use (all already used before this change; none added): basemap.nationalmap.gov (USGS),
 * services.arcgisonline.com and server.arcgisonline.com (Esri), a.basemaps.cartocdn.com (Carto),
 * a.tile.openstreetmap.fr (HOT). Stadia (needs an API key a vscode-webview origin cannot present) and the
 * Mapbox entries (which silently rendered a USGS style while claiming Mapbox) were removed.
 *
 * LOD STATUS: maxNativeZoom values are NOT yet verified against each service's published `tileInfo.lods`
 * (`<service>/MapServer?f=json`); no tile host was contacted when they were set (2026-10-19). USGS, Esri
 * Hillshade/Ocean and the USGS hydrography overlay use the audit's working hypothesis of 16; verify and record
 * the date before relying on them.
 */

export type BaseMapTheme = "light" | "dark"
export type Extent = [west: number, south: number, east: number, north: number]

/** Approximate US envelope for the USGS National Map caches (CONUS, Alaska, Hawaii, Puerto Rico/USVI). */
export const US_EXTENT: Extent = [-180, 15, -64, 72]

/** A transparent tile layer drawn above the base (rivers, labels). */
export interface BaseMapOverlay {
	id: string
	name: string
	url: string
	maxNativeZoom: number
	extent?: Extent
	attribution: string
}

export interface BaseMapStyle {
	id: string
	name: string
	/** Tile URL (the light variant when `darkUrl` is set). */
	url: string
	/** Tile URL for dark and high-contrast themes. */
	darkUrl?: string
	attribution?: string
	maxNativeZoom: number
	extent?: Extent
	/** Drawn above the base, below data layers. */
	overlays?: BaseMapOverlay[]
	/** One-line note shown in the Basemap panel. */
	note?: string
}

export const CARTO_ATTRIBUTION = "© OpenStreetMap contributors © CARTO"

/** USGS National Map hydrography (NHD) as transparent tiles: the emphasised river layer of the default. */
export const USGS_HYDRO_OVERLAY: BaseMapOverlay = {
	id: "usgs-hydro",
	name: "USGS hydrography",
	url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}",
	maxNativeZoom: 16,
	extent: US_EXTENT,
	attribution: "Hydrography: USGS The National Map",
}

export const DEFAULT_BASEMAP_ID = "muted-hydro"

export const BASE_MAP_STYLES: BaseMapStyle[] = [
	// ── Hydrology default: muted, label-free base so rivers and data layers carry the colour ────────────────
	{
		id: DEFAULT_BASEMAP_ID,
		name: "Hydrology default (muted)",
		url: "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
		darkUrl: "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
		attribution: CARTO_ATTRIBUTION,
		maxNativeZoom: 19,
		overlays: [USGS_HYDRO_OVERLAY],
		note: "Muted base with rivers emphasised. River emphasis uses USGS hydrography and covers the United States only.",
	},

	// ── Hydrology / Earth-science alternatives (US coverage) ───────────────────────────────────────────────
	{
		id: "usgs-topo",
		name: "USGS Topo",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
		maxNativeZoom: 16,
		extent: US_EXTENT,
		note: "United States only.",
	},
	{
		id: "usgs-imagery",
		name: "USGS Imagery",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
		maxNativeZoom: 16,
		extent: US_EXTENT,
		note: "United States only.",
	},
	{
		id: "usgs-shaded-relief",
		name: "USGS Shaded Relief",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
		maxNativeZoom: 16,
		extent: US_EXTENT,
		note: "United States only.",
	},

	// ── Esri (global, no token) ────────────────────────────────────────────────────────────────────────────
	{
		id: "esri-hillshade",
		name: "Esri Hillshade",
		url: "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: Esri, USGS, NOAA",
		maxNativeZoom: 16,
	},
	{
		id: "esri-imagery",
		name: "Esri World Imagery",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: Esri, Maxar, Earthstar Geographics, USGS",
		maxNativeZoom: 19,
	},
	{
		id: "esri-topo",
		name: "Esri World Topo",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri",
		maxNativeZoom: 19,
	},
	{
		id: "esri-ocean",
		name: "Esri Ocean",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: GEBCO, NOAA, Garmin",
		maxNativeZoom: 16,
	},

	// ── Carto (OSM-derived, CDN) ───────────────────────────────────────────────────────────────────────────
	{
		id: "carto-light",
		name: "Carto Light",
		url: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
		attribution: CARTO_ATTRIBUTION,
		maxNativeZoom: 19,
	},
	{
		id: "carto-dark",
		name: "Carto Dark",
		url: "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
		attribution: CARTO_ATTRIBUTION,
		maxNativeZoom: 19,
	},
	{
		id: "carto-voyager",
		name: "Carto Voyager",
		url: "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
		attribution: CARTO_ATTRIBUTION,
		maxNativeZoom: 19,
	},

	// ── Alternate ──────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "osm-hot",
		name: "Humanitarian OSM",
		url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
		attribution: "© OpenStreetMap contributors © HOT",
		maxNativeZoom: 19,
	},
]

export interface ResolvedBaseMap {
	/** Catalogue id actually used (the default when the requested id is unknown, e.g. a removed provider). */
	id: string
	name: string
	url: string
	maxNativeZoom: number
	extent?: Extent
	overlays: BaseMapOverlay[]
	/** Base attribution only; use `attributionFor` for what is drawn at a given view. */
	attribution: string
}

export function isKnownBaseMap(id: string | undefined): boolean {
	return !!id && BASE_MAP_STYLES.some((style) => style.id === id)
}

/**
 * Picks the catalogue entry for `id` and the tile URL for `theme`. An unknown id (a provider removed from the
 * catalogue, a corrupted save) resolves to the default instead of silently drawing something else.
 */
export function resolveBaseMap(id: string | undefined, theme: BaseMapTheme): ResolvedBaseMap {
	const style = BASE_MAP_STYLES.find((candidate) => candidate.id === id) ?? BASE_MAP_STYLES[0]
	return {
		id: style.id,
		name: style.name,
		url: theme === "dark" && style.darkUrl ? style.darkUrl : style.url,
		maxNativeZoom: style.maxNativeZoom,
		extent: style.extent,
		overlays: style.overlays ?? [],
		attribution: style.attribution ?? "",
	}
}

export function extentContains(extent: Extent, lon: number, lat: number): boolean {
	return lon >= extent[0] && lon <= extent[2] && lat >= extent[1] && lat <= extent[3]
}

/**
 * Attribution for what is actually drawn: the base, plus each overlay whose coverage includes the view centre
 * (an overlay that draws nothing here is not credited).
 */
export function attributionFor(resolved: ResolvedBaseMap, center?: { lon: number; lat: number }): string {
	const parts = resolved.attribution ? [resolved.attribution] : []
	for (const overlay of resolved.overlays) {
		const drawn = !overlay.extent || !center || extentContains(overlay.extent, center.lon, center.lat)
		if (drawn) {
			parts.push(overlay.attribution)
		}
	}
	return parts.join(" · ")
}

/** Attribution strings for an export manifest: base and every overlay (the export may span coverage). */
export function attributionList(resolved: ResolvedBaseMap): string[] {
	return [...(resolved.attribution ? [resolved.attribution] : []), ...resolved.overlays.map((overlay) => overlay.attribution)]
}

/** VS Code body classes -> map theme. Dark and every high-contrast theme use the dark base. */
export function mapThemeFromBodyClasses(classNames: string | DOMTokenList | undefined | null): BaseMapTheme {
	const classes = typeof classNames === "string" ? classNames.split(/\s+/) : Array.from(classNames ?? [])
	const isHighContrast = classes.some((name) => name === "vscode-high-contrast" || name === "vscode-high-contrast-light")
	return classes.includes("vscode-light") && !isHighContrast ? "light" : "dark"
}
