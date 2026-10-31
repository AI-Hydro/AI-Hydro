/**
 * Synthetic map layers typed against the generated MapLayer proto. Geometry is
 * invented (a hand-drawn polygon, a point and a few lines) and carries
 * metadata.source_status = "synthetic" so exports can never pass as real data.
 */
import type { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"

const style = (over: Partial<MapLayerStyle>): MapLayerStyle => ({
	color: "#1f78b4",
	opacity: 1,
	strokeWidth: 2,
	strokeColor: "#1f78b4",
	fillColor: "#1f78b4",
	fillOpacity: 0.25,
	weight: 2,
	...over,
})

const CENTER: [number, number] = [-90.0, 39.0]

export const basinPolygon: MapLayer = {
	id: "fx-basin",
	name: "Synthetic basin SYN-00000001",
	layerType: "polygon",
	visible: true,
	geojson: JSON.stringify({
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: { name: "Synthetic basin", source_status: "synthetic" },
				geometry: {
					type: "Polygon",
					coordinates: [
						[
							[-90.35, 38.8],
							[-89.85, 38.75],
							[-89.6, 39.05],
							[-89.8, 39.3],
							[-90.25, 39.25],
							[-90.4, 39.0],
							[-90.35, 38.8],
						],
					],
				},
			},
		],
	}),
	style: style({ fillOpacity: 0.18 }),
	metadata: {
		source_status: "synthetic",
		tool: "delineate_watershed",
		_run_id: "fx-run-0001",
		provenance_path: "/fixture/provenance/fx-run-0001.json",
		time_start: "2020-01-01",
		time_end: "2020-12-31",
	},
}

export const gaugePoint: MapLayer = {
	id: "fx-gauge",
	name: "Synthetic gauge SYN-00000001",
	layerType: "point",
	visible: true,
	geojson: JSON.stringify({
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: { site: "SYN-00000001", source_status: "synthetic" },
				geometry: { type: "Point", coordinates: [-89.9, 38.85] },
			},
		],
	}),
	style: style({ color: "#d95f02", fillColor: "#d95f02", strokeColor: "#ffffff", fillOpacity: 1 }),
	metadata: {
		source_status: "synthetic",
		tool: "locate_gauge",
		_run_id: "fx-run-0002",
		study_id: "fx-study",
		provenance_path: "/fixture/provenance/fx-run-0002.json",
		time_start: "2021-01-01",
		time_end: "2021-12-31",
	},
}

export const riverLines: MapLayer = {
	id: "fx-rivers",
	name: "Synthetic river lines",
	layerType: "line",
	visible: true,
	geojson: JSON.stringify({
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties: { order: 3 },
				geometry: {
					type: "LineString",
					coordinates: [
						[-90.3, 39.2],
						[-90.1, 39.05],
						[-89.95, 38.9],
						[-89.9, 38.85],
					],
				},
			},
			{
				type: "Feature",
				properties: { order: 2 },
				geometry: {
					type: "LineString",
					coordinates: [
						[-89.7, 39.0],
						[-89.82, 38.93],
						[-89.9, 38.85],
					],
				},
			},
		],
	}),
	style: style({ color: "#1f78b4", strokeColor: "#1f78b4", strokeWidth: 3, fillOpacity: 0 }),
	// No provenance_path while `tool` is set: the layer panel shows MISSING_PROVENANCE.
	metadata: { source_status: "synthetic", tool: "extract_rivers", source: "tool" },
}

/** Small gradient PNG, built in the page so no binary is committed. */
export function gradientPngDataUrl(): string {
	// jsdom (registry unit test) has no canvas; the browser harness always does.
	if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return "data:image/png;base64,"
	const canvas = document.createElement("canvas")
	canvas.width = 32
	canvas.height = 32
	const ctx = canvas.getContext("2d")
	if (!ctx) return ""
	for (let y = 0; y < 32; y++) {
		for (let x = 0; x < 32; x++) {
			const v = Math.round(((x + y) / 62) * 255)
			ctx.fillStyle = `rgb(${v},${v},${v})`
			ctx.fillRect(x, y, 1, 1)
		}
	}
	return canvas.toDataURL("image/png")
}

export function rasterLayer(): MapLayer {
	return {
		id: "fx-raster",
		name: "Synthetic raster",
		layerType: "raster",
		visible: true,
		geojson: "",
		style: undefined,
		metadata: {
			source_status: "synthetic",
			raster_data_url: gradientPngDataUrl(),
			raster_bounds: JSON.stringify([-90.5, 38.6, -89.4, 39.4]),
			raster_colormap: "viridis",
			units: "synthetic units",
			min: "0",
			max: "255",
			tool: "fixture_raster",
			provenance_path: "/fixture/provenance/fx-run-0004.json",
		},
	}
}

/** A reference layer (NWIS gauges in view) with no study open: no tool, no run. */
export const referenceGauges: MapLayer = {
	id: "fx-ref-gauges",
	name: "NWIS gauges in view",
	layerType: "point",
	visible: true,
	geojson: gaugePoint.geojson,
	style: gaugePoint.style,
	metadata: { source: "nwis", style_preset: "gauge", feature_count: "1", source_status: "synthetic" },
}

export const featureLayers = (): MapLayer[] => [rasterLayer(), basinPolygon, riverLines, gaugePoint]

/** localStorage payload so the camera frames the synthetic geometry deterministically. */
export const MAP_STORAGE_KEY = "aihydro.map.workspace.v1"
/** Schema v2: a basemap is only honoured when `basemapExplicit` is true (the user picked it). */
export const framedWorkspace = (
	basemap?: string,
	showDetails = false,
	center: [number, number] = CENTER,
	zoom = 8.5,
	/** The user's saved chrome state; omitted, the map width picks the default. */
	chrome?: "collapsed" | "rail" | "hidden",
	/** Extra saved workspace fields, e.g. `panelSizes` for a panel the user already resized. */
	extra: Record<string, unknown> = {},
): string =>
	JSON.stringify({
		version: 2,
		...extra,
		...(chrome ? { chrome } : {}),
		...(basemap ? { basemap, basemapExplicit: true } : {}),
		viewState: { longitude: center[0], latitude: center[1], zoom, pitch: 0, bearing: 0 },
		layerPanel: { showDetails },
	})

/**
 * Pins as the host would return them for the open project. The first sits at the centre of the fitted view (the
 * extent centre of `featureLayers()`), so a right-click on the canvas centre lands on it at every width.
 */
const VIEW_CENTER: [number, number] = [-89.95, 39.0]
export const fixturePins = (): Record<string, unknown>[] =>
	[
		{ id: "fx-pin-1", name: "Outlet candidate", notes: "Upstream of the bridge. Check the NLDI snap.", at: VIEW_CENTER },
		{ id: "fx-pin-2", name: "Pin 2", notes: "", at: [-89.82, 39.12] },
		{ id: "fx-pin-3", name: "Low-water crossing", notes: "", at: [-90.12, 38.92] },
	].map(({ id, name, notes, at }) => ({
		id,
		name,
		notes,
		aiPrompt: "",
		color: "#f97316",
		type: "point",
		geometry: { type: "Point", coordinates: at },
		tags: [],
		images: [],
		collectionIds: [],
		status: "open",
		priority: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	}))

// ── Layers panel states (polish-map) ────────────────────────────────────────

const polygonLayer = (
	id: string,
	name: string,
	metadata: Record<string, string>,
	fill = "#1f78b4",
	geojson = basinPolygon.geojson,
): MapLayer => ({
	id,
	name,
	layerType: "polygon",
	visible: true,
	geojson,
	style: style({ color: fill, fillColor: fill, strokeColor: fill, fillOpacity: 0.2 }),
	metadata: { source_status: "synthetic", ...metadata },
})

/** Names as the owner saw them truncated: tool output named from the gauge, the method and the run. */
export const longNameLayers = (): MapLayer[] => [
	polygonLayer("ln-1", "watershed_01031500_basin_boundary_nldi_merit_snap_v2", {
		tool: "delineate_watershed",
		_run_id: "run-7f3a9c.1",
		provenance_path: "/fixture/provenance/ln-1.json",
	}),
	polygonLayer(
		"ln-2",
		"watershed_01031500_basin_boundary_nldi_merit_snap_v2_buffered_5km_for_climate_extraction",
		{ tool: "delineate_watershed", _run_id: "run-7f3a9c.2", provenance_path: "/fixture/provenance/ln-2.json" },
		"#33a02c",
	),
	{ ...gaugePoint, id: "ln-3", name: "USGS 01031500 Piscataquis River near Dover-Foxcroft, Maine (gauge)" },
]

/**
 * Layers restored from earlier sessions: the same delineation twice (same run, same source), plus a layer whose geometry
 * is not loaded, so AI-Hydro can only show it ("Limited layer"). Every one of them sits in the Results group.
 */
export const restoredLayers = (): MapLayer[] => {
	const restored = { _hydrated: "1", _hydrated_of: "6" }
	const basin = (id: string) =>
		polygonLayer(id, "watershed_01031500", {
			tool: "delineate_watershed",
			_run_id: "run-7f3a9c.1",
			provenance_path: "/fixture/provenance/run-7f3a9c.json",
			...restored,
		})
	const limited = (id: string, name: string) => ({
		...polygonLayer(id, name, { tool: "extract_rivers", _run_id: "run-2b44d0.1", ...restored }, "#e31a1c", ""),
	})
	return [
		basin("rs-1"),
		basin("rs-2"),
		basin("rs-3"),
		limited("rs-4", "flowlines_01031500"),
		limited("rs-5", "catchments_01031500"),
	]
}

/** A busy session: tool output, workspace files and files the user loaded, with one duplicated run. */
export const manyLayers = (): MapLayer[] => {
	const tool = (i: number, name: string, over: Record<string, string> = {}, id = `ml-t${i}`) =>
		polygonLayer(
			id,
			name,
			{
				tool: "delineate_watershed",
				_run_id: `run-${i}a1f.1`,
				provenance_path: `/fixture/provenance/ml-t${i}.json`,
				...over,
			},
			["#1f78b4", "#33a02c", "#e31a1c", "#ff7f00", "#6a3d9a"][i % 5],
		)
	const file = (i: number, source: "workspace" | "user", name: string) =>
		polygonLayer(
			`ml-${source[0]}${i}`,
			name,
			{ source, path: `data/${name}.geojson` },
			["#a6cee3", "#b2df8a", "#fb9a99"][i % 3],
		)
	return [
		tool(0, "watershed_01031500"),
		tool(1, "watershed_01013500"),
		tool(2, "watershed_01022500"),
		tool(2, "watershed_01022500", {}, "ml-t2-restored"),
		tool(3, "basin_clip_01047000"),
		rasterLayer(),
		file(0, "workspace", "huc8_boundaries"),
		file(1, "workspace", "study_area"),
		file(2, "workspace", "stations_snapped"),
		file(0, "user", "my_sites"),
		file(1, "user", "dams_nid_subset"),
	]
}

/** Two sketches (an area and a line) as the host returns them next to the pins: the tracker cards in the Draw panel. */
export const fixtureSketches = (): Record<string, unknown>[] =>
	[
		{
			id: "fx-sketch-1",
			name: "Study area",
			notes: "Outer boundary of the low-flow study.",
			type: "polygon",
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[-90.2, 38.85],
						[-89.7, 38.85],
						[-89.7, 39.2],
						[-90.2, 39.2],
						[-90.2, 38.85],
					],
				],
			},
			status: "in_progress",
			priority: "high",
			tags: ["low-flow", "draft"],
		},
		{
			id: "fx-sketch-2",
			name: "Transect to gauge",
			notes: "",
			type: "line",
			geometry: {
				type: "LineString",
				coordinates: [
					[-90.1, 38.9],
					[-89.9, 38.85],
				],
			},
			status: "open",
			priority: null,
			tags: [],
		},
	].map((s) => ({
		aiPrompt: "",
		color: "#2d9f6f",
		images: [],
		collectionIds: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...s,
	}))

/** One saved transect, in the key the Transect panel reads. */
export const TRANSECTS_STORAGE_KEY = "aihydro.map.transects.v1"
export const fixtureTransectsJson = (): string =>
	JSON.stringify([
		{
			id: "fx-transect-1",
			name: "Gauge to outlet",
			notes: "Check the bank slope.",
			aiPrompt: "",
			geometry: {
				type: "LineString",
				coordinates: [
					[-90.2, 38.9],
					[-89.95, 38.95],
					[-89.8, 39.05],
				],
			},
			color: "#f97316",
			tags: [],
			collectionIds: [],
			status: "open",
			priority: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
	])
