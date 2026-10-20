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
 * Known US-coverage gap: the USGS boxes below do not include the western Aleutians (west of the antimeridian,
 * positive longitudes) or the Northwestern Hawaiian Islands (about 23-28N, 161-178W). A view of only those
 * places reports "outside coverage" even though a few USGS tiles may exist there.
 *
 * Tile hosts in use: basemap.nationalmap.gov (USGS), services.arcgisonline.com and server.arcgisonline.com
 * (Esri). Removed because they need an API key a vscode-webview origin cannot
 * present or that we do not hold: Stadia, Mapbox, and (2026-10-20) CARTO. Humanitarian OSM (OpenStreetMap France) was also
 * removed: its usage page (https://www.openstreetmap.fr/usage/) limits use to non-profit sites and apps that send an
 * identifying user-agent, which a vscode-webview cannot do. CARTO's keyless endpoints now answer
 * every request, at every location and style, with one identical "API KEY REQUIRED" watermark tile (verified
 * 2026-10-20: same bytes for light/dark/voyager at India and US tiles), so a catalogue entry would silently
 * draw a watermark map. No CARTO key setting exists, so the entries are removed rather than gated.
 *
 * KEYLESS RULE: no entry may need a key. `basemaps.test.ts` enforces it (no `requiresKey`, no key-bearing URL
 * parameters, every entry declares coverage, maxNativeZoom, attribution and a terms note). A provider that
 * starts returning placeholders later is caught at runtime by `TilePlaceholderTracker` (tileHealth.ts).
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

/** `global` sources serve the whole world; `us` sources serve the United States only (USGS National Map). */
export type BasemapCoverage = "global" | "us"

export interface BaseMapStyle {
	id: string
	name: string
	/** Where the source serves tiles. US-only sources must also carry `extents`. */
	coverage: BasemapCoverage
	/** Usage terms / policy note for this source (what was verified, and when). */
	terms: string
	/** Precise coverage boxes; the viewport is "outside coverage" when it intersects none of them. */
	extents?: Extent[]
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

/**
 * Ids that were in earlier catalogues and are gone for good, with the reason (shown once when a saved choice is
 * migrated to the default).
 */
export const REMOVED_BASEMAPS: Record<string, string> = {
	"carto-light": "CARTO now requires an API key",
	"carto-dark": "CARTO now requires an API key",
	"carto-voyager": "CARTO now requires an API key",
	"stadia-terrain": "Stadia requires an API key",
	"mapbox-dark": "Mapbox requires an access token",
	"osm-hot":
		"its OpenStreetMap France usage policy needs an identifying user-agent and non-profit use, which this app cannot guarantee",
}

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

const ESRI_CANVAS_ATTRIBUTION = "Sources: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community"
const ESRI_TERMS =
	"Esri ArcGIS Online tile service. Tiles are served without a key (verified by request, 2026-10-20). Esri's item pages say the content is licensed under the Esri Master License Agreement; whether the agreement permits keyless use in this application was NOT verified (Product-Specific Terms E300 do not address keyless tile services). Attribution is shown. World Light/Dark Gray Base are in mature support, retiring December 2029."
const USGS_TERMS =
	"USGS The National Map: public-domain data, no key; credit USGS. Detailed tiles exist for the United States only."

export const BASE_MAP_STYLES: BaseMapStyle[] = [
	// ── Hydrology default: muted, label-free base so rivers and data layers carry the colour ────────────────
	{
		id: DEFAULT_BASEMAP_ID,
		name: "Hydrology default (muted)",
		coverage: "global",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
		darkUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
		attribution: ESRI_CANVAS_ATTRIBUTION,
		maxNativeZoom: 16,
		overlays: [USGS_HYDRO_OVERLAY],
		terms: ESRI_TERMS,
		note: "Esri Light/Dark Gray Canvas (global, muted) with rivers emphasised. River emphasis uses USGS hydrography and covers the United States only.",
	},

	// ── Hydrology / Earth-science alternatives (US coverage) ───────────────────────────────────────────────
	{
		id: "usgs-topo",
		name: "USGS Topo",
		coverage: "us",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
		maxNativeZoom: 16,
		extent: US_EXTENT,
		extents: US_EXTENTS,
		terms: USGS_TERMS,
		note: "United States only.",
	},
	{
		id: "usgs-imagery",
		name: "USGS Imagery",
		coverage: "us",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
		maxNativeZoom: 16,
		extent: US_EXTENT,
		extents: US_EXTENTS,
		terms: USGS_TERMS,
		note: "United States only.",
	},
	{
		id: "usgs-shaded-relief",
		name: "USGS Shaded Relief",
		coverage: "us",
		url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}",
		attribution: "USGS The National Map",
		maxNativeZoom: 16,
		extent: US_EXTENT,
		extents: US_EXTENTS,
		terms: USGS_TERMS,
		note: "United States only.",
	},

	// ── Esri (global, no token) ────────────────────────────────────────────────────────────────────────────
	{
		id: "esri-hillshade",
		name: "Esri Hillshade",
		coverage: "global",
		url: "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: Esri, USGS, NOAA",
		maxNativeZoom: 16,
		terms: ESRI_TERMS,
	},
	{
		id: "esri-imagery",
		name: "Esri World Imagery",
		coverage: "global",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: Esri, Maxar, Earthstar Geographics, USGS",
		maxNativeZoom: 19,
		terms: ESRI_TERMS,
	},
	{
		id: "esri-topo",
		name: "Esri World Topo",
		coverage: "global",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri",
		maxNativeZoom: 19,
		terms: ESRI_TERMS,
	},
	{
		id: "esri-ocean",
		name: "Esri Ocean",
		coverage: "global",
		url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
		attribution: "© Esri — Sources: GEBCO, NOAA, Garmin",
		maxNativeZoom: 16,
		terms: ESRI_TERMS,
	},
]

export interface ResolvedBaseMap {
	/** Catalogue id actually used (the default when the requested id is unknown, e.g. a removed provider). */
	id: string
	name: string
	url: string
	maxNativeZoom: number
	extent?: Extent
	extents?: Extent[]
	coverage: BasemapCoverage
	overlays: BaseMapOverlay[]
	/** Base attribution only; use `attributionFor` for what is drawn at a given view. */
	attribution: string
}

/** Why a saved id is gone (a removed provider), or undefined when it is unknown for another reason / still valid. */
export function removedBaseMapReason(id: string | undefined): string | undefined {
	return id && !isKnownBaseMap(id) ? REMOVED_BASEMAPS[id] : undefined
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
		extents: style.extents,
		coverage: style.coverage,
		overlays: style.overlays ?? [],
		attribution: style.attribution ?? "",
	}
}

export type CoverageStatus = "covered" | "outside"

/**
 * Whether the viewport can show tiles from the basemap. Global sources always cover; a US-only source is
 * "outside" when the viewport intersects none of its coverage boxes. Pure; the UI turns "outside" into a notice.
 */
export function basemapCoverageStatus(
	resolved: Pick<ResolvedBaseMap, "coverage" | "extents" | "extent">,
	viewport: Extent,
): CoverageStatus {
	if (resolved.coverage === "global") return "covered"
	const boxes = resolved.extents ?? (resolved.extent ? [resolved.extent] : [])
	if (boxes.length === 0) return "covered"
	const views = normalizeViewportLongitudes(viewport)
	return boxes.some((box) => views.some((view) => extentsIntersect(box, view))) ? "covered" : "outside"
}

/**
 * The viewport as boxes inside [-180, 180]. deck.gl reports unwrapped longitudes once the user pans past the
 * antimeridian (for example 190 for 170W), and a view wider than the world covers every longitude. A view that
 * crosses +-180 becomes two boxes.
 */
export function normalizeViewportLongitudes([west, south, east, north]: Extent): Extent[] {
	if (east - west >= 360) return [[-180, south, 180, north]]
	const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180
	const w = wrap(west)
	const e = w + (east - west)
	return e <= 180
		? [[w, south, e, north]]
		: [
				[w, south, 180, north],
				[-180, south, e - 360, north],
			]
}

/** The message for an "outside" viewport. */
export function coverageNoticeText(resolved: Pick<ResolvedBaseMap, "name" | "coverage">): string {
	return `${resolved.name} covers the United States only, so no tiles are shown here.`
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
