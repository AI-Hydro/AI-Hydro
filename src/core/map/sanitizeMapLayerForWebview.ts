import { MapLayer } from "@shared/proto/cline/map"

/** GeoJSON larger than this is stripped from gRPC payloads; webview loads from disk. */
const MAX_INLINE_GEOJSON_BYTES = 512_000

/** Inline 3D manifest JSON larger than this is stripped; webview loads from disk. */
const MAX_INLINE_MANIFEST_BYTES = 512_000

/**
 * Keep Controller/catalog payloads intact but strip multi-MB inline blobs before
 * streaming layers to the map webview (prevents OOM / blank panel on open).
 */
export function sanitizeMapLayerForWebview(layer: MapLayer): MapLayer {
	const meta = { ...(layer.metadata ?? {}) }
	let geojson = layer.geojson ?? ""
	let changed = false

	if (geojson && Buffer.byteLength(geojson, "utf8") > MAX_INLINE_GEOJSON_BYTES) {
		geojson = ""
		changed = true
	}

	if (meta.raster_path && meta.raster_data_url) {
		delete meta.raster_data_url
		changed = true
	}

	const manifestJson = meta.inundation_3d_manifest_json
	if (manifestJson) {
		const tooLarge = Buffer.byteLength(manifestJson, "utf8") > MAX_INLINE_MANIFEST_BYTES
		if (tooLarge || meta.inundation_3d_manifest_path) {
			delete meta.inundation_3d_manifest_json
			changed = true
		}
	}

	if (!changed) {
		return layer
	}

	return MapLayer.create({
		id: layer.id,
		name: layer.name,
		geojson,
		layerType: layer.layerType,
		visible: layer.visible,
		style: layer.style,
		metadata: meta,
	})
}
