/**
 * Custom type declarations for geo format libraries without official types
 */

declare module "@mapbox/togeojson" {
	export function kml(doc: Document, options?: { styles?: boolean }): any
	export function gpx(doc: Document, options?: { styles?: boolean }): any
}

declare module "shpjs" {
	// Main conversion function (default export) - for ZIP files only
	function parseZip(input: Buffer | ArrayBuffer): Promise<any>
	export default parseZip

	// Named exports for parsing separate shapefile components
	export function parseShp(buffer: Buffer | ArrayBuffer, prj?: string): any
	export function parseDbf(buffer: Buffer | ArrayBuffer): any
	export function combine(parts: any[]): any
}

declare module "topojson-client" {
	export function feature(topology: any, object: any): any
	export function mesh(topology: any, object: any, filter?: (a: any, b: any) => boolean): any
	export function meshArcs(topology: any, object: any, filter?: (a: any, b: any) => boolean): any
	export function merge(topology: any, objects: any[]): any
	export function mergeArcs(topology: any, objects: any[]): any
}
