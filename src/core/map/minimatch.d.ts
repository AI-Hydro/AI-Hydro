/** minimatch 3 ships no types; this is the one call the map makes. */
declare module "minimatch" {
	function minimatch(path: string, pattern: string, options?: { dot?: boolean }): boolean
	export default minimatch
}
