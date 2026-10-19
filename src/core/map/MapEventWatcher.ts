/**
 * MapEventWatcher — polls ~/.aihydro/map_events/ for layer event files
 * written by the Python MCP tools and forwards them to the map panel.
 *
 * Flow:
 *   Python push_layer() / push_raster_layer() writes ~/.aihydro/map_events/<uuid>.json
 *     → this watcher reads the file
 *       → calls controller.addMapLayer()  (broadcasts to all subscribers)
 *         → optionally opens the map panel  (openMap: true in event)
 *           → deletes the processed file
 *
 * GeoJSON layers  → stored verbatim in MapLayer.geojson; rendered as GeoJsonLayer
 * Raster layers   → PNG read from disk, base64-encoded, stored in MapLayer.metadata
 *                   as raster_data_url + raster_bounds; rendered as BitmapLayer
 *
 * Each event file is a one-shot message: write, consume, delete.
 * Processing is idempotent — re-reading a file replaces the layer with the same id.
 */

import type { Controller } from "@core/controller"
import { buildInundation3dLayerFromPath, hydrateInundation3dLayers } from "@core/map/inundation3dLayer"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as path from "path"
import { ensureGeoJsonPreviewArtifact } from "./geojsonPreview"

const MAP_EVENTS_DIR = aihydroPath("map_events")
const POLL_INTERVAL_MS = 200

interface RasterPayload {
	path: string
	bounds: [number, number, number, number] // [west, south, east, north]
	opacity?: number
	colormap?: string
}

interface MapEventPayload {
	id: string
	name: string
	geojson: string
	layerType?: string
	raster?: RasterPayload
	inundation3d?: { manifest_path: string }
	style?: {
		fillColor?: string
		fillOpacity?: number
		color?: string
		strokeColor?: string
		strokeWidth?: number
		weight?: number
		opacity?: number
	}
	autoZoom?: boolean
	openMap?: boolean
	metadata?: Record<string, string>
	timestamp?: string
}

export class MapEventWatcher {
	private controller: Controller
	private timer: ReturnType<typeof setInterval> | null = null
	private processing = false

	constructor(controller: Controller) {
		this.controller = controller
	}

	start(): void {
		if (this.timer) {
			return
		}
		this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
		this.poll() // process any queued events immediately
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
	}

	private async poll(): Promise<void> {
		if (this.processing) {
			return
		}
		this.processing = true
		try {
			await this.processDir()
		} catch {
			// Directory may not exist yet — fine
		} finally {
			this.processing = false
		}
	}

	private async processDir(): Promise<void> {
		let entries: string[]
		try {
			entries = await fs.readdir(MAP_EVENTS_DIR)
		} catch {
			return
		}

		const jsonFiles = entries.filter((f) => f.endsWith(".json"))
		if (jsonFiles.length === 0) {
			return
		}

		for (const file of jsonFiles) {
			const filePath = path.join(MAP_EVENTS_DIR, file)
			await this.processEventFile(filePath)
		}
	}

	private async processEventFile(filePath: string): Promise<void> {
		let raw: string
		try {
			raw = await fs.readFile(filePath, "utf-8")
		} catch {
			return // file deleted by concurrent process
		}

		let event: MapEventPayload
		try {
			event = JSON.parse(raw)
		} catch {
			console.warn("[MapEventWatcher] Malformed event file, removing:", filePath)
			await this.deleteFile(filePath)
			return
		}

		try {
			await this.applyEvent(event)
			// Delete only after successful apply so a transient failure (e.g. PNG
			// temporarily missing) doesn't permanently discard the layer.
			await this.deleteFile(filePath)
		} catch (err) {
			console.error("[MapEventWatcher] Failed to apply event:", event.id, err)
			// Move to a failed/ sub-directory for inspection rather than dropping.
			await this.quarantineFile(filePath)
		}
	}

	private async applyEvent(event: MapEventPayload): Promise<void> {
		const isRaster = event.layerType === "raster" && event.raster != null
		const isInundation3d = event.layerType === "inundation_3d" && event.inundation3d != null

		let layer: MapLayer

		if (isRaster) {
			layer = await this.buildRasterLayer(event)
		} else if (isInundation3d) {
			layer = await this.buildInundation3dLayer(event)
		} else {
			layer = await this.buildVectorLayer(event)
		}

		console.log(
			`[MapEventWatcher] Applying ${isRaster ? "raster" : isInundation3d ? "inundation_3d" : "vector"} layer: ${event.id}`,
		)
		this.controller.addMapLayer(layer)

		if (isRaster && (event.metadata?.tool === "map_flood_inundation" || event.metadata?.source === "HAND+SRC")) {
			void hydrateInundation3dLayers(this.controller)
		}

		if (event.openMap) {
			// Try standalone side-panel first; fall back to in-chat map tab
			let panelOpened = false
			try {
				const { VscodeMapPanelProvider } = await import("@/hosts/vscode/VscodeMapPanelProvider")
				await VscodeMapPanelProvider.createOrShow()
				panelOpened = true
			} catch {
				// Not in VS Code environment (tests / desktop) — skip silently
			}

			if (!panelOpened) {
				// Fall back to in-chat map tab via the button-clicked event
				try {
					const { sendMapButtonClickedEvent } = await import("@/core/controller/ui/subscribeToMapButtonClicked")
					await sendMapButtonClickedEvent()
				} catch {
					// Nothing more we can do
				}
			}
		}
	}

	private async buildVectorLayer(event: MapEventPayload): Promise<MapLayer> {
		const style = event.style ?? {}
		const mapLayerStyle = MapLayerStyle.create({
			fillColor: style.fillColor ?? "#0066CC",
			fillOpacity: style.fillOpacity ?? 0.3,
			color: style.color ?? style.strokeColor ?? "#003399",
			strokeColor: style.strokeColor ?? style.color ?? "#003399",
			strokeWidth: style.strokeWidth ?? style.weight ?? 2,
			weight: style.weight ?? style.strokeWidth ?? 2,
			opacity: style.opacity ?? 1.0,
		})

		const geojson = event.geojson ?? ""
		const metadata: Record<string, string> = {
			...(event.metadata ?? {}),
			...(event.timestamp ? { addedAt: event.timestamp } : {}),
		}
		if (geojson) {
			try {
				const preview = await ensureGeoJsonPreviewArtifact(event.id, geojson)
				if (preview) {
					metadata.display_geojson_path = preview.previewPath
					metadata.full_geojson_embedded = "true"
					metadata.display_mode = "preview"
					metadata.original_feature_count = String(preview.stats.featureCount)
					metadata.preview_feature_count = String(preview.previewStats.featureCount)
					metadata.original_coord_count = String(preview.stats.coordCount)
					metadata.preview_coord_count = String(preview.previewStats.coordCount)
					metadata.preview_bytes = String(preview.previewBytes)
				}
			} catch (err) {
				console.warn(`[MapEventWatcher] Could not build GeoJSON preview for ${event.id}:`, err)
			}
		}

		return MapLayer.create({
			id: event.id,
			name: event.name,
			geojson,
			layerType: event.layerType ?? "polygon",
			style: mapLayerStyle,
			visible: true,
			metadata,
		})
	}

	private async buildInundation3dLayer(event: MapEventPayload): Promise<MapLayer> {
		const manifestPath = event.inundation3d!.manifest_path
		const built = await buildInundation3dLayerFromPath(event.id, event.name, manifestPath, {
			...(event.metadata ?? {}),
			...(event.timestamp ? { addedAt: event.timestamp } : {}),
		})
		if (built) {
			return built
		}

		return MapLayer.create({
			id: event.id,
			name: event.name,
			geojson: "",
			layerType: "inundation_3d",
			visible: true,
			metadata: {
				...(event.metadata ?? {}),
				inundation_3d_manifest_json: "",
				inundation_3d_manifest_path: manifestPath,
				...(event.timestamp ? { addedAt: event.timestamp } : {}),
			},
		})
	}

	private async buildRasterLayer(event: MapEventPayload): Promise<MapLayer> {
		const raster = event.raster!
		const opacity = raster.opacity ?? 0.75

		// Store raster_path as the source of truth. The webview resolves it to a
		// webview URI via aihydro-resolve-file-uri. We still include a base64
		// data URL as a fallback for the first render (avoids a resolve round-trip),
		// but the catalog will persist raster_path so reloads don't need it.
		let dataUrl = ""
		try {
			const pngBuffer = await fs.readFile(raster.path)
			dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`
		} catch (err) {
			console.warn(`[MapEventWatcher] Could not read raster PNG at ${raster.path}:`, err)
		}

		return MapLayer.create({
			id: event.id,
			name: event.name,
			geojson: "",
			layerType: "raster",
			visible: true,
			metadata: {
				...(event.metadata ?? {}),
				raster_data_url: dataUrl,
				raster_bounds: JSON.stringify(raster.bounds),
				raster_opacity: String(opacity),
				raster_colormap: raster.colormap ?? "viridis",
				raster_path: raster.path,
				...(event.timestamp ? { addedAt: event.timestamp } : {}),
			},
		})
	}

	private async deleteFile(filePath: string): Promise<void> {
		try {
			await fs.unlink(filePath)
		} catch {
			// Already deleted or inaccessible — safe to ignore
		}
	}

	private async quarantineFile(filePath: string): Promise<void> {
		try {
			const failedDir = path.join(MAP_EVENTS_DIR, "failed")
			await fs.mkdir(failedDir, { recursive: true })
			const dest = path.join(failedDir, path.basename(filePath))
			await fs.rename(filePath, dest)
		} catch {
			// If rename fails, at least delete so we don't loop forever.
			await this.deleteFile(filePath)
		}
	}
}
