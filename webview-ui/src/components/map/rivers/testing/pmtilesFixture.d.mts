export type Pixel = [number, number]
export interface MvtFeature {
	props: Record<string, number>
	lines: Pixel[][]
}
export interface Segment {
	order: number
	riverId: number
	path: [number, number][]
}
export function lonLatToTilePixel(lon: number, lat: number, z: number, x: number, y: number, extent?: number): Pixel
export function encodeMvtLayer(layerName: string, features: MvtFeature[], extent?: number): Uint8Array
export function tileIdOf(z: number, x: number, y: number): number
export function buildPmtiles(
	tiles: Map<string, Uint8Array>,
	options?: {
		minZoom?: number
		maxZoom?: number
		bounds?: [number, number, number, number]
		gzip?: boolean
		metadata?: object
	},
): Uint8Array
export function syntheticNetwork(
	naturalEarth: { rivers: [number, number[]][] },
	options?: { seed?: number; branchBox?: [number, number, number, number] },
): Segment[]
export const archiveMinOrder: (z: number) => number
export function tilesFromSegments(
	segments: Segment[],
	options?: {
		minZoom?: number
		maxZoom?: number
		extent?: number
		buffer?: number
		orderFilter?: (z: number) => number
	},
): Map<string, Uint8Array>
