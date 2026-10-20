/**
 * Hydrate the Controller's in-memory map layers from the persisted catalog.
 *
 * Called once on Controller startup so that Python-pushed layers (rasters,
 * flood extents, 3D manifests) survive VS Code window reloads.
 *
 * Hydration sources (in priority order):
 *   1. raster_path → PNG read from disk, base64-encoded into raster_data_url
 *   2. inundation_3d_manifest_path → manifest + mesh JSON inlined via buildInundation3dLayerFromPath
 *   3. geojson_cache_path → GeoJSON read from the geojson cache file
 *   4. workspace_path → GeoJSON / shapefile read from the workspace source
 *
 * Any layer that cannot be reconstructed is skipped silently so a missing
 * PNG or corrupt cache never blocks extension startup.
 */

import type { Controller } from "@core/controller"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as path from "path"
import { ensureGeoJsonPreviewArtifact } from "./geojsonPreview"
import { buildInundation3dLayerFromPath } from "./inundation3dLayer"
import { type MapLayerCatalogEntry, readMapLayerCatalog } from "./mapLayerCatalog"
import { selectCatalogEntriesToRestore } from "./restoreSelection"

async function readFileToBase64(filePath: string): Promise<string | null> {
	try {
		const buf = await fs.readFile(filePath)
		return `data:image/png;base64,${buf.toString("base64")}`
	} catch {
		return null
	}
}

async function buildRasterLayerFromEntry(entry: MapLayerCatalogEntry): Promise<MapLayer | null> {
	if (!entry.raster_path) {
		return null
	}
	return MapLayer.create({
		id: entry.id,
		name: entry.name,
		geojson: "",
		layerType: "raster",
		visible: entry.visible,
		metadata: {
			...(entry.metadata_snapshot ?? {}),
			raster_bounds: entry.raster_bounds,
			raster_path: entry.raster_path,
			raster_colormap: entry.raster_colormap || "viridis",
			raster_opacity: entry.raster_opacity || "0.75",
			_hydrated: "1",
		},
	})
}

async function buildVectorLayerFromEntry(entry: MapLayerCatalogEntry): Promise<MapLayer | null> {
	const sourcePath = entry.geojson_cache_path || entry.workspace_path
	if (!sourcePath) {
		return null
	}
	const meta = { ...(entry.metadata_snapshot ?? {}) }
	if (!meta.display_geojson_path) {
		try {
			const resolvedSourcePath = path.isAbsolute(sourcePath)
				? sourcePath
				: aihydroPath("map_layer_geojson_cache", sourcePath)
			const raw = await fs.readFile(resolvedSourcePath, "utf8")
			const preview = await ensureGeoJsonPreviewArtifact(entry.id, raw)
			if (preview) {
				meta.display_geojson_path = preview.previewPath
				meta.display_mode = "preview"
				meta.original_feature_count = String(preview.stats.featureCount)
				meta.preview_feature_count = String(preview.previewStats.featureCount)
				meta.original_coord_count = String(preview.stats.coordCount)
				meta.preview_coord_count = String(preview.previewStats.coordCount)
				meta.preview_bytes = String(preview.previewBytes)
			}
		} catch {
			/* preview is an optimization; never block hydration */
		}
	}
	const style = entry.style ?? {}
	return MapLayer.create({
		id: entry.id,
		name: entry.name,
		geojson: "",
		layerType: entry.layer_type || "polygon",
		visible: entry.visible,
		style: MapLayerStyle.create({
			fillColor: (style.fillColor as string) ?? "#0066CC",
			fillOpacity: (style.fillOpacity as number) ?? 0.3,
			color: (style.color as string) ?? "#003399",
			strokeColor: (style.strokeColor as string) ?? "#003399",
			strokeWidth: (style.strokeWidth as number) ?? 2,
			weight: (style.weight as number) ?? 2,
			opacity: (style.opacity as number) ?? 1,
		}),
		metadata: {
			...meta,
			geojson_cache_path: entry.geojson_cache_path || sourcePath,
			workspace_path: entry.workspace_path || "",
			_hydrated: "1",
		},
	})
}

export async function buildLayerFromEntry(entry: MapLayerCatalogEntry): Promise<MapLayer | null> {
	const t = entry.layer_type

	if (t === "raster") {
		return buildRasterLayerFromEntry(entry)
	}

	if (t === "inundation_3d") {
		if (!entry.inundation_3d_manifest_path) {
			return null
		}
		return buildInundation3dLayerFromPath(entry.id, entry.name, entry.inundation_3d_manifest_path, {
			...(entry.metadata_snapshot ?? {}),
			_hydrated: "1",
		})
	}

	// GeoJSON vector / workspace file
	if (entry.layer_type !== "gee_tile") {
		return buildVectorLayerFromEntry(entry)
	}

	// GEE tile — URL template is already in metadata_snapshot, no file read needed
	const meta = entry.metadata_snapshot ?? {}
	if (!meta.gee_tile_url_template && !meta.tile_url) {
		return null
	}
	return MapLayer.create({
		id: entry.id,
		name: entry.name,
		geojson: "",
		layerType: "gee_tile",
		visible: entry.visible,
		metadata: { ...meta, _hydrated: "1" },
	})
}

/**
 * Build and add layers for catalog entries. The UI reads `_hydrated_of` to say "Restored N of M saved layers"
 * rather than hiding the rest. Entries that cannot be rebuilt (missing file) are skipped, never fatal.
 * Returns the ids of the layers added, in order.
 */
export async function restoreCatalogEntries(
	controller: Controller,
	entries: MapLayerCatalogEntry[],
	total: number,
): Promise<string[]> {
	const added: string[] = []
	for (const entry of entries) {
		try {
			const layer = await buildLayerFromEntry(entry)
			if (layer) {
				layer.metadata = { ...(layer.metadata ?? {}), _hydrated_of: String(total) }
				controller.addMapLayer(layer)
				added.push(layer.id)
			}
		} catch (err) {
			console.warn(`[hydrateMapLayers] Skipping layer ${entry.id}:`, err)
		}
	}
	return added
}

/**
 * Read the persisted catalog and restore layers into the controller.
 * Called from Controller constructor (after mapSessionService.initialize).
 */
export async function hydrateMapLayersFromCatalog(controller: Controller, currentScope?: string): Promise<void> {
	let catalog
	try {
		catalog = await readMapLayerCatalog(currentScope)
	} catch {
		return
	}
	if (!catalog || catalog.layers.length === 0) {
		return
	}

	// Scope to the current workspace and cap the count (see restoreSelection.ts). Older entries are handed to
	// the controller, which keeps them in the catalog and offers "Restore older layers".
	const selection = selectCatalogEntriesToRestore(catalog, currentScope)
	controller.setMapOverflowEntries(selection.overflow)

	const restored = await restoreCatalogEntries(controller, selection.entries, selection.total)

	console.log(
		`[hydrateMapLayers] Restored ${restored.length} / ${selection.total} layers from catalog` +
			(selection.outOfScope ? ` (${selection.outOfScope} belong to another workspace)` : "") +
			(selection.capped ? ` (${selection.capped} older layers kept on disk, not loaded; cap reached)` : ""),
	)
}

/**
 * Resolve a raster layer's PNG from raster_path when raster_data_url is absent.
 * Called lazily when the webview tries to render a layer that was hydrated
 * without image data (e.g. catalog entry without raster_path).
 */
export async function ensureRasterDataUrl(layer: MapLayer, controller: Controller): Promise<void> {
	const meta = layer.metadata ?? {}
	if (meta.raster_data_url || !meta.raster_path) {
		return
	}
	const dataUrl = await readFileToBase64(meta.raster_path)
	if (!dataUrl) {
		return
	}
	controller.updateMapLayer(layer.id, {
		metadata: { ...meta, raster_data_url: dataUrl },
	})
}
