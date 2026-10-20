import type { Controller } from "@core/controller"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { MapLayer } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as path from "path"

const ACTIVE_WORKSPACE_FILE = aihydroPath("active_workspace.json")

function isFloodInundationRaster(layer: MapLayer): boolean {
	if (layer.layerType !== "raster") {
		return false
	}
	const meta = layer.metadata ?? {}
	return meta.tool === "map_flood_inundation" || meta.tool === "map_flood_inundation_hydrograph" || meta.source === "HAND+SRC"
}

function hasEmbedded3dManifest(layers: MapLayer[]): boolean {
	for (const layer of layers) {
		const raw = layer.metadata?.inundation_3d_manifest_json
		if (!raw) {
			continue
		}
		try {
			const parsed = JSON.parse(raw) as { frames?: unknown[] }
			if (Array.isArray(parsed.frames) && parsed.frames.length > 0) {
				return true
			}
		} catch {
			/* ignore */
		}
	}
	return false
}

async function readActiveWorkspace(): Promise<string | null> {
	try {
		const raw = await fs.readFile(ACTIVE_WORKSPACE_FILE, "utf-8")
		const parsed = JSON.parse(raw) as { workspace?: string }
		if (parsed.workspace && (await fs.stat(parsed.workspace)).isDirectory()) {
			return parsed.workspace
		}
	} catch {
		/* ignore */
	}
	return null
}

/** Candidate manifest paths for a flood depth raster layer id like `inundation_01031500_depth`. */
export function floodLayerManifestCandidates(layer: MapLayer, activeWorkspace?: string | null): string[] {
	const meta = layer.metadata ?? {}
	const explicit = meta.inundation_3d_manifest_path?.trim()
	if (explicit) {
		return [explicit]
	}

	const candidates: string[] = []
	const id = layer.id
	const prefix = id.endsWith("_depth") ? id.slice(0, -"_depth".length) : id.replace(/_depth$/, "")

	if (activeWorkspace) {
		candidates.push(path.join(activeWorkspace, `${prefix}_3d_manifest.json`))
	}

	const rasterPath = meta.raster_path?.trim()
	if (rasterPath) {
		candidates.push(path.join(path.dirname(rasterPath), `${prefix}_3d_manifest.json`))
	}

	return [...new Set(candidates)]
}

export async function buildInundation3dLayerFromPath(
	layerId: string,
	name: string,
	manifestPath: string,
	metadata: Record<string, string> = {},
): Promise<MapLayer | null> {
	let manifestJson = ""
	try {
		const raw = await fs.readFile(manifestPath, "utf-8")
		const manifest = JSON.parse(raw) as {
			mesh_dir?: string
			frames?: Array<{ mesh_file?: string; mesh?: unknown; [key: string]: unknown }>
			[key: string]: unknown
		}
		if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) {
			return null
		}
		const meshDir = manifest.mesh_dir ?? path.dirname(manifestPath)
		for (const frame of manifest.frames) {
			if (frame.mesh || !frame.mesh_file) {
				continue
			}
			const meshPath = path.join(meshDir, String(frame.mesh_file))
			try {
				frame.mesh = JSON.parse(await fs.readFile(meshPath, "utf-8"))
			} catch (err) {
				console.warn(`[inundation3dLayer] Could not read mesh at ${meshPath}:`, err)
			}
			delete frame.mesh_file
		}
		manifestJson = JSON.stringify(manifest)
	} catch (err) {
		console.warn(`[inundation3dLayer] Could not read manifest at ${manifestPath}:`, err)
		return null
	}

	if (!manifestJson) {
		return null
	}

	return MapLayer.create({
		id: layerId,
		name,
		geojson: "",
		layerType: "inundation_3d",
		visible: true,
		metadata: {
			...metadata,
			inundation_3d_manifest_json: manifestJson,
			inundation_3d_manifest_path: manifestPath,
		},
	})
}

/**
 * Attach inundation_3d layers when a flood raster exists and a manifest file is on disk
 * but the separate 3D map layer was never pushed (e.g. stale MCP or missed event).
 */
export async function hydrateInundation3dLayers(controller: Controller): Promise<number> {
	const layers = controller.getMapLayers()
	if (hasEmbedded3dManifest(layers)) {
		return 0
	}

	const activeWorkspace = await readActiveWorkspace()
	let attached = 0

	for (const layer of layers) {
		if (!isFloodInundationRaster(layer)) {
			continue
		}

		const prefix = layer.id.endsWith("_depth") ? layer.id.slice(0, -"_depth".length) : layer.id
		const threeDLayerId = `${prefix}_3d`
		const existing3d = layers.find((l) => l.id === threeDLayerId)
		if (existing3d?.metadata?.inundation_3d_manifest_json) {
			continue
		}

		for (const manifestPath of floodLayerManifestCandidates(layer, activeWorkspace)) {
			try {
				await fs.access(manifestPath)
			} catch {
				continue
			}

			const q = layer.metadata?.discharge_m3s
			const name = q ? `Flood 3D (Q=${Number.parseFloat(q).toFixed(0)} m³/s)` : "Flood 3D view"
			const built = await buildInundation3dLayerFromPath(threeDLayerId, name, manifestPath, {
				tool: layer.metadata?.tool ?? "map_flood_inundation",
				session_id: layer.metadata?.session_id ?? "",
				source: "HAND+SRC",
			})
			if (!built) {
				continue
			}
			controller.addMapLayer(built)
			attached += 1
			break
		}
	}

	if (attached > 0) {
		console.log(`[inundation3dLayer] Hydrated ${attached} inundation 3D layer(s) from disk`)
	}
	return attached
}
