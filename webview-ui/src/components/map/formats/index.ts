/**
 * Public surface of the map format module — what callers (LayerPanel, MapView)
 * actually need.
 */

export { loadFile } from "./loadFile"
export { pushLayerSpec } from "./pushLayer"
export type { FormatId, LayerSpec, RasterLayerSpec, VectorLayerSpec } from "./types"
export { ACCEPTED_EXTENSIONS, detectFormat, LayerLoadError, SUPPORTED_FORMATS } from "./types"

import { loadFile } from "./loadFile"
import { pushLayerSpec } from "./pushLayer"
import { detectFormat, LayerLoadError, type LayerSourceSpec } from "./types"

export interface FileLoadEntry {
	file: File
	source?: LayerSourceSpec
}

/**
 * High-level "drop these files on the map" entry point.
 * Returns counts so callers can surface a status toast.
 */
export async function loadAndPushFiles(files: File[] | FileList): Promise<{
	loaded: number
	skipped: number
	errors: string[]
}> {
	return loadAndPushFileEntries(Array.from(files).map((file) => ({ file })))
}

/**
 * Dropped files with the path the host knows them by, where the host reports one (`File.path`). A webview normally does
 * not, and then the file has no path and is told apart by its content alone; a path found here makes it the same
 * layer as the same file added by any other route.
 */
export function entriesWithHostPaths(files: File[] | FileList): FileLoadEntry[] {
	return Array.from(files).map((file) => {
		const hostPath = (file as File & { path?: unknown }).path
		return typeof hostPath === "string" && /^([A-Za-z]:[\\/]|\/)/.test(hostPath)
			? { file, source: { path: hostPath, displayPath: hostPath } }
			: { file }
	})
}

export async function loadAndPushFileEntries(entries: FileLoadEntry[]): Promise<{
	loaded: number
	skipped: number
	errors: string[]
}> {
	const list = entries
	let loaded = 0
	let skipped = 0
	const errors: string[] = []

	for (const entry of list) {
		const file = entry.file
		const fmt = detectFormat(file.name)
		if (!fmt) {
			skipped++
			errors.push(`Skipped ${file.name}: unsupported format`)
			continue
		}
		try {
			const spec = await loadFile(file, { source: { ...entry.source, format: entry.source?.format ?? fmt } })
			await pushLayerSpec(spec)
			loaded++
		} catch (err) {
			const msg = err instanceof LayerLoadError ? err.message : String(err)
			errors.push(msg)
		}
	}
	return { loaded, skipped, errors }
}
