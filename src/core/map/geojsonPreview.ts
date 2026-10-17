import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

export const MAP_LAYER_GEOJSON_PREVIEW_DIR = path.join(os.homedir(), ".aihydro", "map_layer_geojson_preview")

const PREVIEW_TRIGGER_FEATURES = 10_000
const PREVIEW_TRIGGER_BYTES = 4_000_000
const PREVIEW_TARGET_COORDS = 45_000
const PREVIEW_TARGET_FEATURES = 5_000

interface GeoJsonStats {
	coordCount: number
	featureCount: number
	minLon: number
	minLat: number
	maxLon: number
	maxLat: number
}

export interface GeoJsonPreviewResult {
	previewPath: string
	stats: GeoJsonStats
	previewStats: GeoJsonStats
	previewBytes: number
}

function safeLayerId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function countCoordsAndBbox(geojson: any): GeoJsonStats {
	const stats: GeoJsonStats = {
		coordCount: 0,
		featureCount: 0,
		minLon: Infinity,
		minLat: Infinity,
		maxLon: -Infinity,
		maxLat: -Infinity,
	}
	const visitCoord = (coord: unknown) => {
		if (!Array.isArray(coord) || coord.length < 2) {
			return
		}
		const lon = coord[0]
		const lat = coord[1]
		if (typeof lon !== "number" || typeof lat !== "number") {
			return
		}
		stats.coordCount++
		stats.minLon = Math.min(stats.minLon, lon)
		stats.minLat = Math.min(stats.minLat, lat)
		stats.maxLon = Math.max(stats.maxLon, lon)
		stats.maxLat = Math.max(stats.maxLat, lat)
	}
	const visitCoords = (coords: unknown, depth: number) => {
		if (!Array.isArray(coords) || coords.length === 0) {
			return
		}
		if (depth === 0) {
			visitCoord(coords)
			return
		}
		for (const item of coords) {
			visitCoords(item, depth - 1)
		}
	}
	const visitGeom = (geom: any) => {
		if (!geom) {
			return
		}
		switch (geom.type) {
			case "Point":
				visitCoords(geom.coordinates, 0)
				break
			case "MultiPoint":
			case "LineString":
				visitCoords(geom.coordinates, 1)
				break
			case "MultiLineString":
			case "Polygon":
				visitCoords(geom.coordinates, 2)
				break
			case "MultiPolygon":
				visitCoords(geom.coordinates, 3)
				break
			case "GeometryCollection":
				for (const sub of geom.geometries ?? []) {
					visitGeom(sub)
				}
				break
		}
	}
	const visitFeature = (feature: any) => {
		if (!feature?.geometry) {
			return
		}
		stats.featureCount++
		visitGeom(feature.geometry)
	}
	if (geojson?.type === "FeatureCollection") {
		for (const feature of geojson.features ?? []) {
			visitFeature(feature)
		}
	} else if (geojson?.type === "Feature") {
		visitFeature(geojson)
	} else {
		visitGeom(geojson)
	}
	if (stats.coordCount === 0) {
		stats.minLon = 0
		stats.minLat = 0
		stats.maxLon = 0
		stats.maxLat = 0
	}
	return stats
}

function snapLine(coords: any[], gridSize: number): any[] {
	const out: any[] = []
	let prevX: number | undefined
	let prevY: number | undefined
	for (const coord of coords) {
		if (!Array.isArray(coord) || coord.length < 2) {
			continue
		}
		const x = Math.round(coord[0] / gridSize)
		const y = Math.round(coord[1] / gridSize)
		if (x !== prevX || y !== prevY) {
			out.push([x * gridSize, y * gridSize])
			prevX = x
			prevY = y
		}
	}
	return out
}

function snapRing(coords: any[], gridSize: number): any[] {
	const out = snapLine(coords, gridSize)
	if (out.length > 0) {
		const first = out[0]
		const last = out[out.length - 1]
		if (first[0] !== last[0] || first[1] !== last[1]) {
			out.push(first)
		}
	}
	return out.length >= 4 ? out : []
}

function simplifyGeom(geom: any, gridSize: number): any {
	if (!geom) {
		return geom
	}
	switch (geom.type) {
		case "LineString": {
			const coordinates = snapLine(geom.coordinates ?? [], gridSize)
			return coordinates.length >= 2 ? { type: "LineString", coordinates } : null
		}
		case "MultiLineString": {
			const coordinates = (geom.coordinates ?? [])
				.map((line: any[]) => snapLine(line, gridSize))
				.filter((line: any[]) => line.length >= 2)
			return coordinates.length > 0 ? { type: "MultiLineString", coordinates } : null
		}
		case "Polygon": {
			const coordinates = (geom.coordinates ?? [])
				.map((ring: any[]) => snapRing(ring, gridSize))
				.filter((ring: any[]) => ring.length >= 4)
			return coordinates.length > 0 ? { type: "Polygon", coordinates } : null
		}
		case "MultiPolygon": {
			const coordinates = (geom.coordinates ?? [])
				.map((poly: any[]) =>
					poly.map((ring: any[]) => snapRing(ring, gridSize)).filter((ring: any[]) => ring.length >= 4),
				)
				.filter((poly: any[]) => poly.length > 0)
			return coordinates.length > 0 ? { type: "MultiPolygon", coordinates } : null
		}
		case "GeometryCollection": {
			const geometries = (geom.geometries ?? []).map((sub: any) => simplifyGeom(sub, gridSize)).filter(Boolean)
			return geometries.length > 0 ? { type: "GeometryCollection", geometries } : null
		}
		default:
			return geom
	}
}

function simplifyGeojson(geojson: any, gridSize: number, featureStride: number): any {
	if (geojson?.type === "FeatureCollection") {
		const features = (geojson.features ?? [])
			.filter((_: unknown, index: number) => index % featureStride === 0)
			.map((feature: any) => ({
				type: "Feature",
				geometry: simplifyGeom(feature.geometry, gridSize),
				properties: feature.properties ?? {},
			}))
			.filter((feature: any) => feature.geometry)
		return { type: "FeatureCollection", features }
	}
	if (geojson?.type === "Feature") {
		return {
			type: "Feature",
			geometry: simplifyGeom(geojson.geometry, gridSize),
			properties: geojson.properties ?? {},
		}
	}
	return simplifyGeom(geojson, gridSize)
}

export async function ensureGeoJsonPreviewArtifact(layerId: string, rawGeojson: string): Promise<GeoJsonPreviewResult | null> {
	const bytes = Buffer.byteLength(rawGeojson, "utf8")
	let parsed: any
	try {
		parsed = JSON.parse(rawGeojson)
	} catch {
		return null
	}
	const stats = countCoordsAndBbox(parsed)
	if (
		bytes < PREVIEW_TRIGGER_BYTES &&
		stats.featureCount < PREVIEW_TRIGGER_FEATURES &&
		stats.coordCount < PREVIEW_TARGET_COORDS * 2
	) {
		return null
	}

	const span = Math.max(stats.maxLon - stats.minLon, stats.maxLat - stats.minLat, 0.001)
	const coordRatio = Math.max(1, stats.coordCount / PREVIEW_TARGET_COORDS)
	const gridSize = Math.max((span / 12_000) * Math.sqrt(coordRatio), 1e-6)
	const featureStride = Math.max(1, Math.ceil(stats.featureCount / PREVIEW_TARGET_FEATURES))
	const preview = simplifyGeojson(parsed, gridSize, featureStride)
	const previewRaw = JSON.stringify(preview)
	const previewStats = countCoordsAndBbox(preview)

	await fs.mkdir(MAP_LAYER_GEOJSON_PREVIEW_DIR, { recursive: true })
	const previewPath = path.join(MAP_LAYER_GEOJSON_PREVIEW_DIR, `${safeLayerId(layerId)}.preview.geojson`)
	await fs.writeFile(previewPath, previewRaw, "utf8")
	return {
		previewPath,
		stats,
		previewStats,
		previewBytes: Buffer.byteLength(previewRaw, "utf8"),
	}
}
