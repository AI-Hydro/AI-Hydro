import type { Layer } from "@deck.gl/core"
import { TerrainLayer } from "@deck.gl/geo-layers"

/** Mapzen Terrarium-encoded AWS elevation tiles (same source as Cognaterra). */
export const TERRARIUM_ELEVATION_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

export const TERRARIUM_ELEVATION_DECODER = {
	rScaler: 256,
	gScaler: 1,
	bScaler: 1 / 256,
	offset: -32768,
}

export const HILLSHADE_TEXTURE_URL =
	"https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"

export function buildInundationTerrainLayer(
	boundsWgs84: [number, number, number, number],
	options?: { visible?: boolean; meshMaxError?: number },
): Layer {
	const [west, south, east, north] = boundsWgs84
	return new TerrainLayer({
		id: "inundation-3d-terrain",
		elevationData: TERRARIUM_ELEVATION_URL,
		texture: HILLSHADE_TEXTURE_URL,
		elevationDecoder: TERRARIUM_ELEVATION_DECODER,
		bounds: [west, south, east, north],
		meshMaxError: options?.meshMaxError ?? 2,
		maxZoom: 14,
		minZoom: 0,
		material: true,
		color: [190, 180, 160],
		visible: options?.visible ?? true,
		pickable: false,
	})
}
