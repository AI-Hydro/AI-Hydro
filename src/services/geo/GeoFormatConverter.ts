/**
 * Geographic Format Converter Service
 * Converts various geo data formats to GeoJSON for map visualization
 * Inspired by geo-data-viewer, adapted for AI-Hydro architecture
 */

import * as togeojson from "@mapbox/togeojson"
import { DOMParser } from "@xmldom/xmldom"
import * as flatgeobuf from "flatgeobuf/lib/mjs/geojson"
import shp, { combine, parseDbf, parseShp } from "shpjs"
import * as topojson from "topojson-client"
import type { ConversionOptions, ConversionResult, GeoFormat } from "./types"
import { GeoConversionError } from "./types"

export class GeoFormatConverter {
	/**
	 * Convert KML format to GeoJSON
	 * @param kmlContent KML file content as string
	 * @param options Conversion options
	 */
	async convertKml(kmlContent: string, options: ConversionOptions = {}): Promise<ConversionResult> {
		try {
			// Parse KML XML
			const kml = new DOMParser().parseFromString(kmlContent, "text/xml")

			// Convert to GeoJSON with optional styling
			const geojson = togeojson.kml(kml, {
				styles: options.includeStyles ?? true,
			})

			return this.createResult(geojson, "kml", options)
		} catch (error) {
			throw new GeoConversionError(
				`Failed to convert KML: ${error instanceof Error ? error.message : "Unknown error"}`,
				"kml",
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Convert GPX format to GeoJSON
	 * @param gpxContent GPX file content as string
	 * @param options Conversion options
	 */
	async convertGpx(gpxContent: string, options: ConversionOptions = {}): Promise<ConversionResult> {
		try {
			// Parse GPX XML
			const gpx = new DOMParser().parseFromString(gpxContent, "text/xml")

			// Convert to GeoJSON with optional styling
			const geojson = togeojson.gpx(gpx, {
				styles: options.includeStyles ?? true,
			})

			return this.createResult(geojson, "gpx", options)
		} catch (error) {
			throw new GeoConversionError(
				`Failed to convert GPX: ${error instanceof Error ? error.message : "Unknown error"}`,
				"gpx",
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Convert TopoJSON format to GeoJSON
	 * @param topojsonContent TopoJSON file content as string
	 * @param options Conversion options
	 */
	async convertTopojson(topojsonContent: string, options: ConversionOptions = {}): Promise<ConversionResult> {
		try {
			// Parse TopoJSON
			const data = JSON.parse(topojsonContent)

			// Validate it's actually TopoJSON
			if (data.type !== "Topology") {
				throw new Error('Invalid TopoJSON: missing type="Topology"')
			}

			// Get the first object from the topology
			const objectKeys = Object.keys(data.objects)
			if (objectKeys.length === 0) {
				throw new Error("TopoJSON has no objects to convert")
			}

			// Convert to GeoJSON feature collection
			const geojson = topojson.feature(data, data.objects[objectKeys[0]])

			return this.createResult(geojson, "topojson", options)
		} catch (error) {
			throw new GeoConversionError(
				`Failed to convert TopoJSON: ${error instanceof Error ? error.message : "Unknown error"}`,
				"topojson",
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Convert Shapefile to GeoJSON
	 * Accepts either:
	 * - An object with {shp, shx, dbf, prj} buffers (preferred)
	 * - Just the shp Buffer (limited functionality)
	 */
	async convertShapefile(
		shapefileData: Buffer | { shp: Buffer; shx: Buffer; dbf: Buffer; prj?: string },
		options: ConversionOptions = {},
	): Promise<ConversionResult> {
		try {
			let geojson: any

			if (Buffer.isBuffer(shapefileData)) {
				// Single buffer - assume it's a ZIP file containing all components
				geojson = await shp(shapefileData)
			} else {
				// Object with separate components - parse each and combine
				const shpData = parseShp(shapefileData.shp, shapefileData.prj)
				const dbfData = parseDbf(shapefileData.dbf)
				geojson = combine([shpData, dbfData])
			}

			return this.createResult(geojson, "shapefile", options)
		} catch (error) {
			throw new GeoConversionError(
				`Failed to convert Shapefile: ${error instanceof Error ? error.message : "Unknown error"}`,
				"shapefile",
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Convert FlatGeobuf to GeoJSON
	 * @param fgbBuffer FlatGeobuf file buffer
	 * @param options Conversion options
	 */
	async convertFlatgeobuf(fgbBuffer: Buffer, options: ConversionOptions = {}): Promise<ConversionResult> {
		try {
			// Deserialize FlatGeobuf to GeoJSON
			const geojson = flatgeobuf.deserialize(new Uint8Array(fgbBuffer))

			return this.createResult(geojson, "flatgeobuf", options)
		} catch (error) {
			throw new GeoConversionError(
				`Failed to convert FlatGeobuf: ${error instanceof Error ? error.message : "Unknown error"}`,
				"flatgeobuf",
				error instanceof Error ? error : undefined,
			)
		}
	}

	/**
	 * Auto-detect format and convert to GeoJSON
	 * @param content File content (string or Buffer)
	 * @param fileExtension File extension (e.g., '.kml', '.gpx')
	 * @param options Conversion options
	 */
	async convert(content: string | Buffer, fileExtension: string, options: ConversionOptions = {}): Promise<ConversionResult> {
		const ext = fileExtension.toLowerCase()

		switch (ext) {
			case ".kml":
				return this.convertKml(content as string, options)

			case ".gpx":
				return this.convertGpx(content as string, options)

			case ".topojson":
			case ".topo.json":
				return this.convertTopojson(content as string, options)

			case ".fgb":
				return this.convertFlatgeobuf(content as Buffer, options)

			case ".shp":
				// Shapefile conversion - requires buffer input or object
				return this.convertShapefile(content as any, options)

			case ".geojson":
			case ".json":
				// Already GeoJSON, just parse and validate
				try {
					const geojson = JSON.parse(content as string)
					return this.createResult(geojson, "geojson", options)
				} catch (error) {
					throw new GeoConversionError(
						`Failed to parse GeoJSON: ${error instanceof Error ? error.message : "Unknown error"}`,
						"geojson",
						error instanceof Error ? error : undefined,
					)
				}

			default:
				throw new GeoConversionError(`Unsupported format: ${ext}`, "geojson")
		}
	}

	/**
	 * Check if a file extension is supported for conversion
	 */
	isSupported(fileExtension: string): boolean {
		const ext = fileExtension.toLowerCase()
		return [
			".geojson",
			".json",
			".kml",
			".gpx",
			".topojson",
			".topo.json",
			".fgb",
			".shp", // Note: shapefiles require additional files (.dbf, .prj)
		].includes(ext)
	}

	/**
	 * Get the format type from file extension
	 */
	getFormat(fileExtension: string): GeoFormat {
		const ext = fileExtension.toLowerCase()

		if (ext === ".kml") return "kml"
		if (ext === ".gpx") return "gpx"
		if (ext === ".topojson" || ext === ".topo.json") return "topojson"
		if (ext === ".fgb") return "flatgeobuf"
		if (ext === ".shp") return "shapefile"

		return "geojson"
	}

	/**
	 * Create a standardized conversion result
	 */
	private createResult(geojson: any, originalFormat: GeoFormat, options: ConversionOptions): ConversionResult {
		// Count features if it's a FeatureCollection
		let featureCount: number | undefined
		if (geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
			featureCount = geojson.features.length
		}

		return {
			geojson,
			metadata: {
				originalFormat,
				originalFileName: options.outputPath,
				convertedAt: new Date().toISOString(),
				featureCount,
				warnings: [],
			},
		}
	}
}

// Export singleton instance
export const geoFormatConverter = new GeoFormatConverter()
