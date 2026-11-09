/**
 * Soft edge for a coverage-limited overlay tile.
 *
 * A raster overlay is requested per tile, and tiles outside every coverage box are skipped, so the overlay ends
 * on a tile edge: a hard straight seam that cuts across lakes and the sea (USGS hydrography ends at 50N, which
 * slices Lake Manitoba in half). A tile that straddles a coverage edge is therefore multiplied by a mask that is
 * opaque inside the coverage boxes and fades to nothing over FEATHER_PX at their edge. The maths is pure; the
 * canvas step is in `featherTileToCoverage`.
 */
import type { Extent } from "./basemaps"
import type { TileAddress } from "./tileFallback"

/** Width of the fade, in tile pixels, measured inward from the coverage edge. */
export const FEATHER_PX = 48

export interface PixelRect {
	left: number
	top: number
	right: number
	bottom: number
}

/** Web-Mercator pixel of a lon/lat at zoom `z` (tile size `tileSize`), origin at the top-left of the world. */
export function mercatorPixel(lon: number, lat: number, z: number, tileSize = 256): { x: number; y: number } {
	const world = tileSize * 2 ** z
	const clamped = Math.max(-85.0511, Math.min(85.0511, lat))
	const sin = Math.sin((clamped * Math.PI) / 180)
	return { x: ((lon + 180) / 360) * world, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world }
}

/** Each coverage box that touches the tile, as a pixel rectangle in the tile's own frame (may extend past it). */
export function coverageRectsInTile(tile: TileAddress, boxes: Extent[], tileSize = 256): PixelRect[] {
	const originX = tile.x * tileSize
	const originY = tile.y * tileSize
	const rects: PixelRect[] = []
	for (const [west, south, east, north] of boxes) {
		const topLeft = mercatorPixel(west, north, tile.z, tileSize)
		const bottomRight = mercatorPixel(east, south, tile.z, tileSize)
		const rect = {
			left: topLeft.x - originX,
			top: topLeft.y - originY,
			right: bottomRight.x - originX,
			bottom: bottomRight.y - originY,
		}
		if (rect.right > 0 && rect.bottom > 0 && rect.left < tileSize && rect.top < tileSize) rects.push(rect)
	}
	return rects
}

/** True when one box covers the whole tile with the feather to spare: nothing to mask. */
export function tileIsFullyCovered(rects: PixelRect[], tileSize = 256, feather = FEATHER_PX): boolean {
	return rects.some(
		(r) => r.left <= -feather && r.top <= -feather && r.right >= tileSize + feather && r.bottom >= tileSize + feather,
	)
}

/**
 * Multiplies the tile's alpha by the coverage mask. Returns the tile unchanged when it lies well inside one box.
 * `bitmap` is closed once drawn.
 */
export async function featherTileToCoverage(
	bitmap: ImageBitmap | HTMLImageElement,
	tile: TileAddress,
	boxes: Extent[],
	tileSize = 256,
	feather = FEATHER_PX,
): Promise<ImageBitmap | HTMLImageElement> {
	const rects = coverageRectsInTile(tile, boxes, tileSize)
	if (rects.length === 0 || tileIsFullyCovered(rects, tileSize, feather)) return bitmap
	const mask = document.createElement("canvas")
	mask.width = tileSize
	mask.height = tileSize
	const maskContext = mask.getContext("2d")
	const out = document.createElement("canvas")
	out.width = tileSize
	out.height = tileSize
	const outContext = out.getContext("2d")
	if (!maskContext || !outContext) return bitmap
	// A blurred box, inset by the feather so the fade is finished at the coverage edge.
	maskContext.filter = `blur(${feather / 3}px)`
	maskContext.fillStyle = "#000"
	for (const r of rects)
		maskContext.fillRect(r.left + feather / 2, r.top + feather / 2, r.right - r.left - feather, r.bottom - r.top - feather)
	outContext.drawImage(bitmap, 0, 0, tileSize, tileSize)
	outContext.globalCompositeOperation = "destination-in"
	outContext.drawImage(mask, 0, 0)
	if ("close" in bitmap) bitmap.close()
	return createImageBitmap(out)
}
