/**
 * Geographic format conversion types and interfaces
 */

export type GeoFormat = "geojson" | "kml" | "gpx" | "shapefile" | "topojson" | "flatgeobuf" | "wkt" | "gml"

export interface ConversionResult {
	/** Converted GeoJSON data */
	geojson: any
	/** Metadata about the conversion */
	metadata: {
		originalFormat: GeoFormat
		originalFileName?: string
		convertedAt: string
		featureCount?: number
		warnings?: string[]
	}
}

export interface ConversionOptions {
	/** Include styling information if available */
	includeStyles?: boolean
	/** Create a .geojson file on disk */
	saveToFile?: boolean
	/** Output file path (if saveToFile is true) */
	outputPath?: string
}

export class GeoConversionError extends Error {
	constructor(
		message: string,
		public readonly format: GeoFormat,
		public readonly originalError?: Error,
	) {
		super(message)
		this.name = "GeoConversionError"
	}
}
