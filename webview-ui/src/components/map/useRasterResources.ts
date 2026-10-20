import type { MapLayer } from "@shared/proto/cline/map"
import { useEffect, useState } from "react"
import { applyColormap, dataUrlToImage, rasterCache } from "./formats/rasterCache"
import { resolveFileUri } from "./resolveFileUri"
import { fingerprintBlob } from "./tileHealth"

export interface ResourceState {
	status: "loading" | "error"
	message: string
}
export const RASTER_DECODE_TIMEOUT_MS = 15000
/** Marks a cache entry whose image was decoded from a host file path rather than an inline data URL. */
const RASTER_PATH_SOURCE_PREFIX = "path:"

function parseStretch(raw: string | undefined): number | undefined {
	if (!raw) return undefined
	const value = Number.parseFloat(raw)
	return Number.isFinite(value) ? value : undefined
}

export function parseRasterBounds(raw: string): [number, number, number, number] {
	const b = JSON.parse(raw)
	if (
		!Array.isArray(b) ||
		b.length !== 4 ||
		!b.every((value) => typeof value === "number" && Number.isFinite(value)) ||
		b[0] >= b[2] ||
		b[1] >= b[3] ||
		b[0] < -180 ||
		b[2] > 180 ||
		b[1] < -90 ||
		b[3] > 90
	) {
		throw new Error(
			"Raster bounds must be ordered finite WGS84 coordinates; dateline-crossing rasters require an explicit split.",
		)
	}
	return b as [number, number, number, number]
}

export function useRasterResources(layers: MapLayer[], retry: number) {
	const [states, setStates] = useState<Record<string, ResourceState>>({})
	const [revision, setRevision] = useState(0)
	useEffect(() => {
		let active = true
		const cleanups: Array<() => void> = []
		const next: Record<string, ResourceState> = {}
		for (const layer of layers) {
			if (layer.layerType === "gee_tile") {
				try {
					if (!(layer.metadata?.gee_tile_url_template || layer.metadata?.tile_url))
						throw new Error("Remote tile URL is missing. Reload the source layer.")
					const bounds = layer.metadata?.gee_bounds || layer.metadata?.raster_bounds
					if (bounds) parseRasterBounds(bounds)
				} catch (error) {
					next[layer.id] = { status: "error", message: String(error) }
				}
				continue
			}
			if (layer.layerType !== "raster") continue
			const dataUrl = layer.metadata?.raster_data_url
			// Catalog-hydrated layers carry only a file path (the inline image is
			// stripped from the stream); the host resolves it to a webview URI.
			const rasterPath = layer.metadata?.raster_path
			const url = dataUrl || (rasterPath ? `${RASTER_PATH_SOURCE_PREFIX}${rasterPath}` : undefined)
			const rawBounds = layer.metadata?.raster_bounds
			const cached = rasterCache.get(layer.id)
			const sameSource = Boolean(cached && cached.sourceDataUrl === url && cached.sourceBounds === rawBounds)
			const targetColormap = layer.metadata?.raster_colormap ?? "viridis"
			const stretchMin = parseStretch(layer.metadata?.raster_stretch_min)
			const stretchMax = parseStretch(layer.metadata?.raster_stretch_max)
			const recolor =
				sameSource &&
				cached?.rawPixels &&
				(cached.colormap !== targetColormap || cached.stretchMin !== stretchMin || cached.stretchMax !== stretchMax)
			if (sameSource && !recolor) continue
			// Local loaders without a transported image can own a cache entry.
			if (cached && !url && !cached.sourceDataUrl) continue
			// A stream snapshot may carry only the file path for an image already decoded from its data URL.
			if (cached && !dataUrl && rasterPath && cached.sourceDataUrl && cached.sourceBounds === rawBounds) continue
			if (!recolor) rasterCache.delete(layer.id)
			try {
				if (!url || !rawBounds) throw new Error("Raster image or bounds are missing. Reload the source layer.")
				const bounds = parseRasterBounds(rawBounds)
				next[layer.id] = { status: "loading", message: "Decoding raster image…" }
				let settled = false
				const fail = (error: unknown) => {
					if (!active || settled) return
					settled = true
					clearTimeout(timer)
					setStates((previous) => ({
						...previous,
						[layer.id]: { status: "error", message: error instanceof Error ? error.message : String(error) },
					}))
				}
				const timer = setTimeout(
					() => fail(new Error("Raster image decoding timed out. Retry or reload the source.")),
					RASTER_DECODE_TIMEOUT_MS,
				)
				cleanups.push(() => clearTimeout(timer))
				const imagePromise =
					recolor && cached?.rawPixels
						? applyColormap(cached.rawPixels, targetColormap, stretchMin, stretchMax)
						: dataUrl
							? dataUrlToImage(dataUrl)
							: resolveFileUri(rasterPath as string).then(({ uri }) => dataUrlToImage(uri))
				imagePromise
					.then((image) => {
						if (!active || settled) return
						settled = true
						clearTimeout(timer)
						rasterCache.set(layer.id, {
							image,
							bounds,
							colormap: recolor ? targetColormap : (layer.metadata?.raster_colormap ?? "pre-rendered"),
							rawPixels: sameSource ? cached?.rawPixels : undefined,
							stretchMin: recolor ? stretchMin : undefined,
							stretchMax: recolor ? stretchMax : undefined,
							sourceDataUrl: url,
							sourceBounds: rawBounds,
						})
						setStates((previous) => {
							const updated = { ...previous }
							delete updated[layer.id]
							return updated
						})
						setRevision((value) => value + 1)
					})
					.catch(fail)
			} catch (error) {
				next[layer.id] = { status: "error", message: error instanceof Error ? error.message : String(error) }
			}
		}
		setStates(next)
		setRevision((value) => value + 1)
		return () => {
			active = false
			cleanups.forEach((cleanup) => cleanup())
		}
	}, [layers, retry])
	return { states, revision }
}

/** createImageBitmap can fail in some Electron webview contexts; an HTMLImageElement is also accepted by BitmapLayer. */
function decodeBlobAsImageElement(blob: Blob, tileUrl: string): Promise<HTMLImageElement> {
	const objectUrl = URL.createObjectURL(blob)
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const img = new Image()
		img.onload = () => {
			URL.revokeObjectURL(objectUrl)
			resolve(img)
		}
		img.onerror = () => {
			URL.revokeObjectURL(objectUrl)
			reject(new Error(`Tile image decode failed: ${tileUrl}`))
		}
		img.src = objectUrl
	})
}

export async function loadMapTile(
	tile: { url?: string | null; signal?: AbortSignal },
	onFingerprint?: (fingerprint: string) => void,
): Promise<ImageBitmap | HTMLImageElement> {
	if (!tile.url) throw new Error("Tile URL is missing")
	const response = await fetch(tile.url, { signal: tile.signal })
	if (!response.ok) throw new Error(`Tile request failed (HTTP ${response.status})`)
	const blob = await response.blob()
	// Basemaps pass a callback so a provider answering 200 with one placeholder image can be noticed.
	if (onFingerprint) void fingerprintBlob(blob).then(onFingerprint, () => undefined)
	let image: ImageBitmap | HTMLImageElement
	try {
		image = await createImageBitmap(blob)
	} catch {
		image = await decodeBlobAsImageElement(blob, tile.url)
	}
	if (tile.signal?.aborted) {
		if ("close" in image) image.close()
		throw new DOMException("Tile request cancelled", "AbortError")
	}
	return image
}

/** Fetches one tile and returns its content fingerprint; rejects on HTTP errors, network errors, abort or hashing failure. */
export async function fetchTileFingerprint(url: string, signal?: AbortSignal): Promise<string> {
	const response = await fetch(url, { signal })
	if (!response.ok) throw new Error(`Tile request failed (HTTP ${response.status})`)
	return fingerprintBlob(await response.blob())
}
