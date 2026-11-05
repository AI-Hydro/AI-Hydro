/**
 * Project files model: the pure decisions behind the tree, so they can be tested without rendering.
 *
 * Every project file stays in the tree. A file is "loaded" when a layer has the same resolved source path, however that
 * layer got to the map; Load and Unload act on the row in place and nothing moves between sections.
 */

import { resolvedSourcePath } from "@shared/map/layerIdentity"
import type { MapLayer, RemovedFileEntry, WorkspaceGeoFile } from "@shared/proto/cline/map"

/** Up to this many files, folders open themselves and the list reads flat. Above it, folders start collapsed. */
export const AUTO_OPEN_FILES = 20
/** The filter box appears above this many files. */
export const FILTER_ABOVE = 10
/** Rows the section shows at least, whatever else is on the panel. */
export const MIN_VISIBLE_ROWS = 5

/** A file's identity: its folder and its path inside it. */
export const fileKey = (folder: string | undefined, relativePath: string): string => `${folder ?? ""}\u0000${relativePath}`

/** The resolved path a file has on disk, the way a layer that holds it names it. */
export function fileResolved(file: Pick<WorkspaceGeoFile, "relativePath" | "workspaceFolder">): string {
	return resolvedSourcePath({ path: file.relativePath, workspace_folder: file.workspaceFolder }) ?? ""
}

/** Layers by the file they were loaded from. A layer saved before paths were absolute matches by relative path alone. */
export function layersByFile(
	layers: MapLayer[],
	/** One open folder. A legacy layer that recorded a relative path and no folder can only be matched to a file then. */
	singleRoot = true,
): {
	byPath: Map<string, MapLayer>
	pathOnly: Map<string, MapLayer>
	byId: Map<string, MapLayer>
} {
	const byPath = new Map<string, MapLayer>()
	const pathOnly = new Map<string, MapLayer>()
	const byId = new Map<string, MapLayer>()
	for (const layer of layers) {
		byId.set(layer.id, layer)
		const key = resolvedSourcePath(layer.metadata)
		if (key) byPath.set(key, layer)
		// With several folders open, a relative path alone cannot say which folder's file it is.
		if (singleRoot && layer.metadata?.path && !layer.metadata.workspace_folder) pathOnly.set(layer.metadata.path, layer)
	}
	return { byPath, pathOnly, byId }
}

/**
 * The layer that holds this file, if one is on the map. The host's answer comes first: it compares real paths, so a
 * symlinked folder or `/var` against `/private/var` still counts. The webview's own comparison is the fallback.
 */
export function layerOfFile(
	file: WorkspaceGeoFile,
	index: ReturnType<typeof layersByFile>,
): MapLayer | undefined {
	return (
		(file.loadedLayerId ? index.byId.get(file.loadedLayerId) : undefined) ??
		index.byPath.get(fileResolved(file)) ??
		index.pathOnly.get(file.relativePath)
	)
}

export type PfRow =
	| { kind: "folder"; key: string; depth: number; name: string; path: string; count: number; open: boolean; entry: FolderRef }
	| { kind: "file"; key: string; depth: number; file: WorkspaceGeoFile; multiRoot: boolean }
	| { kind: "removed-head"; key: string; count: number; open: boolean }
	| { kind: "removed"; key: string; entry: RemovedFileEntry }

/** A folder as the host names it: the open folder it is under and its path inside it ("" for the open folder itself). */
export interface FolderRef {
	workspaceFolder: string
	relativePath: string
}

interface Node {
	name: string
	path: string
	folders: Map<string, Node>
	files: WorkspaceGeoFile[]
	count: number
}

const newNode = (name: string, path: string): Node => ({ name, path, folders: new Map(), files: [], count: 0 })

/** Case-insensitive match on the whole relative path, so `huc8` finds `data/huc8/x.geojson`. */
export function matchesFilter(file: Pick<WorkspaceGeoFile, "relativePath" | "folderName">, filter: string): boolean {
	const needle = filter.trim().toLowerCase()
	return needle === "" || file.relativePath.toLowerCase().includes(needle) || (file.folderName ?? "").toLowerCase().includes(needle)
}

/**
 * The rows under "Not on the map", top to bottom; `files` are the files that are not on the map. With a filter the list is
 * flat (matches only); otherwise folders are rows.
 * `open` holds the folders the user flipped from their starting state: with 20 files or fewer every folder starts open,
 * above that every folder starts closed.
 */
export function buildRows(input: {
	files: WorkspaceGeoFile[]
	removed: RemovedFileEntry[]
	filter: string
	open: Set<string>
	removedOpen: boolean
}): PfRow[] {
	const { files, removed, filter, open, removedOpen } = input
	const multiRoot = new Set(files.map((f) => f.workspaceFolder)).size > 1
	const rows: PfRow[] = []
	const autoOpen = files.length <= AUTO_OPEN_FILES

	if (filter.trim() !== "") {
		for (const file of files.filter((f) => matchesFilter(f, filter))) {
			rows.push({
				kind: "file",
				key: fileKey(file.workspaceFolder, file.relativePath),
				depth: 0,
				file,
				multiRoot,
			})
		}
	} else {
		// One root node per open folder in a multi-root window, so a file's folder is always visible; otherwise the
		// folder's own files sit at the top.
		const roots = new Map<string, Node>()
		for (const file of files) {
			let root = roots.get(file.workspaceFolder)
			if (!root) {
				root = newNode(file.folderName || file.workspaceFolder, "")
				roots.set(file.workspaceFolder, root)
			}
			const parts = file.relativePath.replace(/\\/g, "/").split("/")
			let node = root
			node.count++
			for (const part of parts.slice(0, -1)) {
				const child = node.folders.get(part) ?? newNode(part, node.path ? `${node.path}/${part}` : part)
				node.folders.set(part, child)
				node = child
				node.count++
			}
			node.files.push(file)
		}
		const walk = (node: Node, folder: string, depth: number) => {
			for (const child of [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
				const key = `dir\u0000${folder}\u0000${child.path}`
				const isOpen = autoOpen !== open.has(key)
				rows.push({
					kind: "folder",
					key,
					depth,
					name: child.name,
					path: child.path,
					count: child.count,
					open: isOpen,
					entry: { workspaceFolder: folder, relativePath: child.path },
				})
				if (isOpen) walk(child, folder, depth + 1)
			}
			for (const file of node.files) {
				rows.push({
					kind: "file",
					key: fileKey(file.workspaceFolder, file.relativePath),
					depth,
					file,
						multiRoot,
				})
			}
		}
		for (const [folder, root] of roots) {
			if (multiRoot) {
				const key = `root\u0000${folder}`
				const isOpen = autoOpen !== open.has(key)
				rows.push({
					kind: "folder",
					key,
					depth: 0,
					name: root.name,
					path: "",
					count: root.count,
					open: isOpen,
					entry: { workspaceFolder: folder, relativePath: "" },
				})
				if (isOpen) walk(root, folder, 1)
			} else {
				walk(root, folder, 0)
			}
		}
	}

	if (removed.length > 0) {
		rows.push({ kind: "removed-head", key: "removed-head", count: removed.length, open: removedOpen })
		if (removedOpen) {
			for (const entry of removed) {
				rows.push({ kind: "removed", key: `removed\u0000${entry.workspaceFolder}\u0000${entry.kind}\u0000${entry.relativePath}`, entry })
			}
		}
	}
	return rows
}

/** The files a filter matches: what `Remove N matches` would hide. */
export function filterMatches(files: WorkspaceGeoFile[], filter: string): WorkspaceGeoFile[] {
	return filter.trim() === "" ? [] : files.filter((f) => matchesFilter(f, filter))
}

/** The files that are not on the map. */
export function notOnMap(files: WorkspaceGeoFile[], index: ReturnType<typeof layersByFile>): WorkspaceGeoFile[] {
	return files.filter((f) => !layerOfFile(f, index))
}

/** The folder keys above a file, outermost first, as `buildRows` keys them (for revealing a row that just moved). */
export function folderKeysOf(file: WorkspaceGeoFile, multiRoot: boolean): string[] {
	const keys: string[] = multiRoot ? [`root\u0000${file.workspaceFolder}`] : []
	const parts = file.relativePath.replace(/\\/g, "/").split("/").slice(0, -1)
	let acc = ""
	for (const part of parts) {
		acc = acc ? `${acc}/${part}` : part
		keys.push(`dir\u0000${file.workspaceFolder}\u0000${acc}`)
	}
	return keys
}

/** Extensions the map panel parses itself; the extension host does not read them. */
export const WEBVIEW_PARSED = new Set([".tif", ".tiff", ".kmz"])

/** The codicon for a file by its extension. */
export function fileIcon(extension: string): string {
	switch (extension.toLowerCase()) {
		case ".tif":
		case ".tiff":
			return "symbol-color"
		case ".kml":
		case ".kmz":
		case ".gpx":
			return "location"
		case ".shp":
		case ".fgb":
			return "database"
		default:
			return "json"
	}
}
