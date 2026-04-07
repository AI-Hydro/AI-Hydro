/**
 * Validates GeoJSON format
 */

export interface GeoJsonValidationResult {
	valid: boolean
	error?: string
}

/**
 * Validates if a parsed JSON object is valid GeoJSON
 */
export function validateGeoJSON(data: any): GeoJsonValidationResult {
	try {
		// Check if data exists
		if (!data || typeof data !== "object") {
			return { valid: false, error: "Data is not an object" }
		}

		// Check for type field
		if (!data.type || typeof data.type !== "string") {
			return { valid: false, error: 'Missing or invalid "type" field' }
		}

		const type = data.type

		// Valid GeoJSON types
		const validTypes = [
			"Point",
			"MultiPoint",
			"LineString",
			"MultiLineString",
			"Polygon",
			"MultiPolygon",
			"GeometryCollection",
			"Feature",
			"FeatureCollection",
		]

		if (!validTypes.includes(type)) {
			return { valid: false, error: `Invalid type: ${type}` }
		}

		// Validate based on type
		if (type === "FeatureCollection") {
			if (!Array.isArray(data.features)) {
				return { valid: false, error: "FeatureCollection must have features array" }
			}
		} else if (type === "Feature") {
			if (!data.geometry) {
				return { valid: false, error: "Feature must have geometry" }
			}
		} else if (type === "GeometryCollection") {
			if (!Array.isArray(data.geometries)) {
				return { valid: false, error: "GeometryCollection must have geometries array" }
			}
		} else {
			// Geometry types must have coordinates
			if (!data.coordinates) {
				return { valid: false, error: `${type} must have coordinates` }
			}
		}

		return { valid: true }
	} catch (error) {
		return { valid: false, error: `Validation error: ${error}` }
	}
}

/**
 * Checks if a file content string is valid GeoJSON
 */
export function isValidGeoJSONString(content: string): GeoJsonValidationResult {
	try {
		const parsed = JSON.parse(content)
		return validateGeoJSON(parsed)
	} catch (error) {
		return { valid: false, error: `JSON parse error: ${error}` }
	}
}
