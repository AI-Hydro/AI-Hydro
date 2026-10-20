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
 * LOD VERIFICATION (recorded 2026-10-20; every maxNativeZoom checked against the service's published MapServer
 * JSON, `<service>/MapServer?f=json`):
 *   - USGSTopo, USGSImageryOnly, USGSShadedReliefOnly, USGSHydroCached: top-level maxScale 9027.977411, which is
 *     level 16, so 16 is correct.
 *       https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer?f=json
 *       https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=json
 *       https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer?f=json
 *       https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer?f=json
 *   - Esri Ocean/World_Ocean_Base: LODs stop at 16, so 16 is correct.
 *       https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer?f=json
 *   - Esri World_Hillshade, World_Imagery, World_Topo_Map publish no maxScale (0) and a generic LOD list to 23.
 *     The configured 16, 19 and 19 are at or below the served depth; overzoom is the safe failure mode.
 *       https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer?f=json
 *       https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer?f=json
 *       https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer?f=json
 *   Carto and HOT are slippy-map CDNs with a level-19 convention and were not part of this check.
 */

export type BaseMapTheme = "light" | "dark"
export type Extent = [west: number, south: number, east: number, north: number]

/** Approximate US envelope for the USGS National Map caches (CONUS, Alaska, Hawaii, Puerto Rico/USVI). */
export const US_EXTENT: Extent = [-180, 15, -64, 72]

/**
 * The same coverage as separate boxes: CONUS, Alaska, Hawaii, Puerto Rico/USVI. US_EXTENT also takes in Canada,
 * Mexico and open ocean, where the sparse USGS caches legitimately return 404.
 */
export const US_EXTENTS: Extent[] = [
	[-125, 24, -66.5, 50],
	[-180, 51, -129, 72],
	[-161, 18.5, -154.5, 22.5],
	[-68, 17.5, -64.5, 18.8],
]

export function extentsIntersect(a: Extent, b: Extent): boolean {
	return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/** A transparent tile layer drawn above the base (rivers, labels). */
export interface BaseMapOverlay {
	id: string
	name: string
	url: string
	maxNativeZoom: number
	/** Bounding box of `extents` (what deck.gl uses to skip tiles). */
	extent?: Extent
	/** Precise coverage boxes; a tile that intersects none of them is not requested. */
	extents?: Extent[]
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
	extents: US_EXTENTS,
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

/** True when the point lies inside the overlay's coverage (any box of `extents`, else `extent`, else anywhere). */
export function overlayCovers(overlay: BaseMapOverlay, lon: number, lat: number): boolean {
	if (overlay.extents) return overlay.extents.some((box) => extentContains(box, lon, lat))
	return !overlay.extent || extentContains(overlay.extent, lon, lat)
}

/**
 * Attribution for what is actually drawn: the base, plus each overlay whose coverage includes the view centre
 * (an overlay that draws nothing here is not credited). When `loadedOverlayIds` is given, an overlay is also
 * credited only once at least one of its tiles has actually loaded.
 */
export function attributionFor(
	resolved: ResolvedBaseMap,
	center?: { lon: number; lat: number },
	loadedOverlayIds?: ReadonlySet<string>,
): string {
	const parts = resolved.attribution ? [resolved.attribution] : []
	for (const overlay of resolved.overlays) {
		const covered = !center || overlayCovers(overlay, center.lon, center.lat)
		const loaded = !loadedOverlayIds || loadedOverlayIds.has(overlay.id)
		if (covered && loaded) {
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
