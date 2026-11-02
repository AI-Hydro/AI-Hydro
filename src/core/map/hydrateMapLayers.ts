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
import { resolvedSourcePath } from "@shared/map/layerIdentity"
import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import { constants as fsConstants, realpathSync } from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { ensureGeoJsonPreviewArtifact } from "./geojsonPreview"
import { buildInundation3dLayerFromPath } from "./inundation3dLayer"
import { type MapLayerCatalogEntry, readMapLayerCatalog, scopedMapLayerCatalogFile } from "./mapLayerCatalog"
import { migrateCatalogEntries } from "./restoreMigration"
import { selectCatalogEntriesToRestore } from "./restoreSelection"
import { MAX_INLINE_GEOJSON_BYTES } from "./sanitizeMapLayerForWebview"

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

/** Extensions whose file text is the layer's GeoJSON. Other formats were converted when loaded, so only the cache copy is. */
const JSON_SOURCE_EXT = new Set([".geojson", ".json"])

async function readTextIfPresent(file: string): Promise<string | null> {
	try {
		return await fs.readFile(file, "utf8")
	} catch {
		return null
	}
}

interface EntrySource {
	raw: string
	/** Where it was read: the layer's own file, or a copy AI-Hydro kept. */
	from: "file" | "cache"
}

/**
 * The text a restored vector layer is made of. A layer that names a file is read from that file (an absolute path, or a
 * relative one under the folder the layer recorded). The cache directory holds a copy under the file's own name, which
 * can be older, so it is read only when the file is gone, and the caller says so. A tool's layer is the other way round:
 * the cache holds what the run produced, and the file (if any) may have been overwritten since, so the cache is first.
 * A relative path is never looked for in the cache directory unless it is the cache's own.
 */
export async function readEntryGeojson(entry: MapLayerCatalogEntry, meta: Record<string, string>): Promise<EntrySource | null> {
	const cachePath = entry.geojson_cache_path
		? path.isAbsolute(entry.geojson_cache_path)
			? entry.geojson_cache_path
			: aihydroPath("map_layer_geojson_cache", entry.geojson_cache_path)
		: undefined
	const named = resolvedSourcePath({ ...meta, workspace_path: meta.workspace_path || entry.workspace_path })
	const projectFile = named && JSON_SOURCE_EXT.has(path.extname(named).toLowerCase()) ? named : undefined
	const fromTool = Boolean(meta.tool || meta._run_id)
	const order: Array<[string | undefined, EntrySource["from"]]> = fromTool
		? [
				[cachePath, "cache"],
				[projectFile, "file"],
			]
		: [
				[projectFile, "file"],
				[cachePath, "cache"],
			]
	for (const [candidate, from] of order) {
		if (!candidate) continue
		const raw = await readTextIfPresent(candidate)
		if (raw !== null) return { raw, from }
	}
	return null
}

async function buildVectorLayerFromEntry(entry: MapLayerCatalogEntry): Promise<MapLayer | null> {
	const meta = { ...(entry.metadata_snapshot ?? {}) }
	// Restorable from a cache copy, a file the layer names, or a workspace file it recorded.
	const named = resolvedSourcePath({ ...meta, workspace_path: meta.workspace_path || entry.workspace_path })
	if (!entry.geojson_cache_path && !named) {
		return null
	}
	// A layer that names a file (and is not a tool's) is that file as it is now. A stored preview was made from the file
	// as it was, and the map draws a preview first, so it is dropped and rebuilt from the text read below.
	if (named && !(meta.tool || meta._run_id) && meta.display_geojson_path) {
		for (const key of [
			"display_geojson_path",
			"display_mode",
			"original_feature_count",
			"preview_feature_count",
			"original_coord_count",
			"preview_coord_count",
			"preview_bytes",
		]) {
			delete meta[key]
		}
	}
	const source = await readEntryGeojson(entry, meta)
	if (source && !meta.display_geojson_path) {
		try {
			const preview = await ensureGeoJsonPreviewArtifact(entry.id, source.raw)
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
	// A layer that names a file and was read from the cache because the file is gone says so, not "current".
	if (named && source?.from === "cache" && !(meta.tool || meta._run_id)) {
		meta.source_status = "source_missing"
	} else if (named && source?.from === "file" && meta.source_status === "source_missing") {
		// The file is back (or was never gone): a status written when it was missing must not outlive that.
		meta.source_status = "current"
	}
	// A restored layer holds its content like a new one, up to the size the webview is sent. Larger ones are drawn from
	// disk. Text that is not JSON (a file kept in another format) is left out rather than inlined.
	let geojson = ""
	if (source && Buffer.byteLength(source.raw, "utf8") <= MAX_INLINE_GEOJSON_BYTES) {
		try {
			JSON.parse(source.raw)
			geojson = source.raw
		} catch {
			/* not GeoJSON text: drawn from the cached copy */
		}
	}
	const style = entry.style ?? {}
	return MapLayer.create({
		id: entry.id,
		name: entry.name,
		geojson,
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
			// Only the cache copy goes here: this key is read as "a cache file", and a project path stamped into it
			// would be drawn in preference to the project file it belongs to.
			geojson_cache_path: entry.geojson_cache_path || "",
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

/** Copy of the catalog taken before the first merge. Never overwritten: it is the file as an older build left it. */
export async function backUpCatalogBeforeMerge(catalogFile: string): Promise<void> {
	try {
		await fs.copyFile(catalogFile, catalogFile.replace(/\.json$/, ".pre-merge-backup.json"), fsConstants.COPYFILE_EXCL)
	} catch (err) {
		// EEXIST: a backup from an earlier merge stays as it is. ENOENT: nothing to keep.
		const code = (err as NodeJS.ErrnoException).code
		if (code !== "EEXIST" && code !== "ENOENT") console.warn("[hydrateMapLayers] catalog backup failed:", err)
	}
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

	// Persisted duplicates (older builds kept one file under several ids) are one layer before anything is added.
	controller.restorePersistedAliases(catalog.layer_aliases ?? {})
	const migration = await migrateCatalogEntries(selection.entries, {
		workspaceRoot: catalog.workspace_root || currentScope || undefined,
		cacheDir: aihydroPath("map_layer_geojson_cache"),
		realpath: (p) => realpathSync(p),
	})
	if (migration.mergedCount > 0 && currentScope) {
		// The merge is written to the catalog by the next layer change. Keep the catalog as it was first, once.
		await backUpCatalogBeforeMerge(scopedMapLayerCatalogFile(currentScope))
	}
	controller.recordRestoreMerges(migration.aliases)

	const restored = await restoreCatalogEntries(controller, migration.entries, selection.total)

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
