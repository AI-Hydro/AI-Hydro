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
): string =>
	JSON.stringify({
		version: 2,
		...(chrome ? { chrome } : {}),
		...(basemap ? { basemap, basemapExplicit: true } : {}),
		viewState: { longitude: center[0], latitude: center[1], zoom, pitch: 0, bearing: 0 },
		layerPanel: { showDetails },
	})
