/**
 * Parent-tile fallback for sparse tile caches.
 *
 * Some ArcGIS caches have holes inside their declared coverage (USGSHydroCached answers 404 for every tile at
 * zoom 13 across much of the northern US while z12 and z14 are served). When a tile inside declared coverage is
 * missing, the next-coarser tile is fetched and the matching quadrant is cropped and scaled up (overzoom), the
 * same rule the catalogue applies past `maxNativeZoom`. Up to MAX_PARENT_LEVELS levels are tried.
 *
 * The address arithmetic and the fallback loop are pure (injected `load`), so they are tested without a canvas.
 */

/** Coarser levels tried before the gap is reported. */
export const MAX_PARENT_LEVELS = 3

export interface TileAddress {
	x: number
	y: number
	z: number
}

/** Which part of an ancestor tile covers the wanted tile, as fractions of the ancestor (0..1). */
export interface ParentCrop {
	parent: TileAddress
	/** Levels above the wanted tile (1 = direct parent). */
	levels: number
	left: number
	top: number
	/** Width and height of the sub-rectangle as a fraction of the ancestor (1 / 2^levels). */
	size: number
}

/** The ancestor `levels` above `tile` and the sub-rectangle of it that covers `tile`. Null when above zoom 0. */
export function parentCrop(tile: TileAddress, levels: number): ParentCrop | null {
	if (!Number.isInteger(levels) || levels < 1 || tile.z - levels < 0) return null
	const span = 2 ** levels
	const parent = { z: tile.z - levels, x: Math.floor(tile.x / span), y: Math.floor(tile.y / span) }
	return {
		parent,
		levels,
		left: (tile.x - parent.x * span) / span,
		top: (tile.y - parent.y * span) / span,
		size: 1 / span,
	}
}

/** Fills a `{z}/{x}/{y}` tile URL template. */
export function fillTileUrl(template: string, address: TileAddress): string {
	return template.replace("{z}", String(address.z)).replace("{y}", String(address.y)).replace("{x}", String(address.x))
}

/** True for the "HTTP 404" failures `loadMapTile` throws: a tile that is not in the cache, not an outage. */
export function isTileNotFound(error: unknown): boolean {
	return error instanceof Error && /\bHTTP 404\b/.test(error.message)
}

/** Confirmed gaps are remembered this long, so a pan over the same hole does not ask the server again. */
export const GAP_MEMORY_MS = 60_000
/** Most gap URLs remembered at once (oldest dropped first). */
export const GAP_MEMORY_MAX = 512

/**
 * Shares ancestor fetches between sibling tiles and remembers confirmed 404s for a short time.
 * Four z13 holes under one z12 parent fetch that parent once; an ancestor already known to be absent is not
 * requested again until GAP_MEMORY_MS has passed (a Retry waits at most that long, or calls `clear`).
 */
export class ParentTileCache<Parent> {
	private inFlight = new Map<string, Promise<Parent>>()
	private gaps = new Map<string, number>()
	constructor(private now: () => number = Date.now) {}

	isKnownGap(url: string): boolean {
		const since = this.gaps.get(url)
		if (since === undefined) return false
		if (this.now() - since > GAP_MEMORY_MS) {
			this.gaps.delete(url)
			return false
		}
		return true
	}

	/** One shared request per URL while it is in flight; a 404 is recorded as a gap. */
	load(url: string, load: (url: string) => Promise<Parent>): Promise<Parent> {
		const pending = this.inFlight.get(url)
		if (pending) return pending
		const request = load(url).then(
			(image) => {
				this.inFlight.delete(url)
				return image
			},
			(error) => {
				this.inFlight.delete(url)
				if (isTileNotFound(error)) {
					this.gaps.set(url, this.now())
					if (this.gaps.size > GAP_MEMORY_MAX) this.gaps.delete(this.gaps.keys().next().value as string)
				}
				throw error
			},
		)
		this.inFlight.set(url, request)
		return request
	}

	clear(): void {
		this.inFlight.clear()
		this.gaps.clear()
	}
}

export interface ParentFallbackOptions<Parent, Out = Parent> {
	tile: TileAddress
	urlTemplate: string
	/** Loads one tile image; rejects with "HTTP <status>" on a non-OK response. */
	load: (url: string) => Promise<Parent>
	/** Cuts the wanted quadrant out of an ancestor and scales it to a full tile. */
	crop: (parentImage: Parent, crop: ParentCrop) => Out
	maxLevels?: number
	/**
	 * Shallowest zoom an ancestor may have. Below it the source draws things the overlay is kept away from (the
	 * USGS tiles at z5-7 carry baked-in country and state names that double the base map's), so the walk stops there.
	 */
	minZoom?: number
	cache?: ParentTileCache<Parent>
	/** Called with the number of levels climbed when an ancestor filled the tile. */
	onFilled?: (levels: number) => void
}

/**
 * Tries the ancestors of a missing tile, nearest first, never above `minZoom`. Resolves to the cropped image, or
 * null when none of them exists either. Only a 404 moves on to the next level; any other failure (network, abort,
 * decode) is thrown, because it says nothing about the cache's contents.
 */
export async function loadParentFallback<Parent, Out = Parent>(options: ParentFallbackOptions<Parent, Out>): Promise<Out | null> {
	const { tile, urlTemplate, load, crop, maxLevels = MAX_PARENT_LEVELS, minZoom = 0, cache, onFilled } = options
	for (let levels = 1; levels <= maxLevels; levels++) {
		const cut = parentCrop(tile, levels)
		if (!cut || cut.parent.z < minZoom) return null
		const url = fillTileUrl(urlTemplate, cut.parent)
		if (cache?.isKnownGap(url)) continue
		try {
			const parentImage = await (cache ? cache.load(url, load) : load(url))
			const filled = crop(parentImage, cut)
			onFilled?.(levels)
			return filled
		} catch (error) {
			if (!isTileNotFound(error)) throw error
		}
	}
	return null
}

/** Canvas crop for `loadParentFallback`: the quadrant of an ancestor, scaled up to a `tileSize` square. The ancestor is shared, so it is not closed. */
export function cropParentToCanvas(
	parentImage: ImageBitmap | HTMLImageElement,
	cut: ParentCrop,
	tileSize = 256,
): HTMLCanvasElement {
	const canvas = document.createElement("canvas")
	canvas.width = tileSize
	canvas.height = tileSize
	const context = canvas.getContext("2d")
	if (!context) throw new Error("Canvas 2D context unavailable for the parent-tile fallback")
	const width = "naturalWidth" in parentImage ? parentImage.naturalWidth : parentImage.width
	const height = "naturalHeight" in parentImage ? parentImage.naturalHeight : parentImage.height
	context.imageSmoothingEnabled = true
	context.drawImage(
		parentImage,
		cut.left * width,
		cut.top * height,
		cut.size * width,
		cut.size * height,
		0,
		0,
		tileSize,
		tileSize,
	)
	return canvas
}
