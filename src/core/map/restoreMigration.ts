/**
 * Upgrade pass for a persisted layer catalog, run once at restore before any layer is added.
 *
 * Older builds persisted the same file under several ids (an Explorer load, Add file, Reload source, the workspace
 * list), some of them with a path relative to a folder that was not recorded. The pass is idempotent and writes nothing:
 *   1. a relative `source_path`, `path` or `workspace_path` becomes absolute against the entry's `workspace_folder`, or
 *      else the catalog's workspace, and is stamped only when a file exists there (a path is a claim about a file);
 *   2. an entry with no path at all (Add file or drag-drop) takes the path of a project file with the same name only
 *      when its cached copy parses to exactly that file's content;
 *   3. entries with the same resolved file are one: the first in draw order stays, and the others become aliases of it,
 *      lending it what the user set (name, style, visibility). Nothing merges without a matching path or content.
 * Names are matched here, by key-order-insensitive comparison of parsed content, so no caller has to guess.
 * Cache files and project files are only read.
 */
import {
	type IdentityLayer,
	matchFile,
	mergedMetadata,
	type PathResolver,
	resolvedSourcePath,
	sameGeojson,
} from "@shared/map/layerIdentity"
import * as fs from "fs/promises"
import * as path from "path"
import type { MapLayerCatalogEntry } from "./mapLayerCatalog"

/** Keys the user set on a layer; carried over to the survivor when it has none of its own. */
const USER_KEYS = ["display_name", "symbology_user_override", "graduated_attr", "graduated_breaks", "graduated_colors", "legend"]
/** A cache copy larger than this is not compared to a project file by content. */
const MAX_COMPARE_BYTES = 20_000_000
const NON_VECTOR = new Set(["raster", "inundation_3d", "gee_tile"])

export interface RestoreMigration {
	entries: MapLayerCatalogEntry[]
	/** Ids merged away, and the entry that stands for each. */
	aliases: Record<string, string>
	mergedCount: number
}

export interface MigrationOptions {
	/** The workspace the catalog was written for or is restored into. */
	workspaceRoot?: string
	/** Where cache copies live (relative `geojson_cache_path` values resolve here). */
	cacheDir: string
	realpath?: PathResolver
	/** Text of a file, or undefined when it cannot be read. */
	readText?: (absolutePath: string) => Promise<string | undefined>
	/** True when a file exists at this absolute path. */
	exists?: (absolutePath: string) => Promise<boolean>
}

async function defaultExists(file: string): Promise<boolean> {
	try {
		return (await fs.stat(file)).isFile()
	} catch {
		return false
	}
}

const DEFAULT_STYLE: Record<string, number | string> = { fillColor: "#0066CC", strokeColor: "#003399" }
/** A style the user (or a tool) changed from the default one every new layer starts with. */
const isNonDefaultStyle = (style: Record<string, number | string> | undefined): boolean =>
	!!style && Object.entries(style).some(([k, v]) => k in DEFAULT_STYLE && DEFAULT_STYLE[k] !== v)

async function defaultReadText(file: string): Promise<string | undefined> {
	try {
		const stat = await fs.stat(file)
		if (!stat.isFile() || stat.size > MAX_COMPARE_BYTES) return undefined
		return await fs.readFile(file, "utf8")
	} catch {
		return undefined
	}
}

const isVectorEntry = (entry: MapLayerCatalogEntry): boolean => !NON_VECTOR.has(entry.layer_type)
const stem = (file: string): string => path.basename(file, path.extname(file)).toLowerCase()

async function absolutise(
	entry: MapLayerCatalogEntry,
	workspaceRoot: string | undefined,
	exists: (p: string) => Promise<boolean>,
): Promise<MapLayerCatalogEntry> {
	const meta = { ...(entry.metadata_snapshot ?? {}) }
	const base = meta.workspace_folder || workspaceRoot
	let workspacePath = entry.workspace_path
	if (base && path.isAbsolute(base)) {
		const resolve = (rel: string) => path.join(base, rel)
		// Only a path that names a file is stamped: the entry is otherwise left as it was.
		const found = async (rel: string | undefined): Promise<string | undefined> => {
			if (!rel) return undefined
			const abs = path.isAbsolute(rel) ? rel : resolve(rel)
			return (await exists(abs)) ? abs : undefined
		}
		if (meta.source_path && !path.isAbsolute(meta.source_path)) {
			const abs = await found(meta.source_path)
			if (abs) {
				meta.source_path = abs
				if (!meta.workspace_folder) meta.workspace_folder = base
			}
		} else if (!meta.source_path && meta.path && !path.isAbsolute(meta.path)) {
			// `path` is a layer's own key (the workspace list sets it); the file it names is also its source.
			const abs = await found(meta.path)
			if (abs) {
				meta.source_path = abs
				if (!meta.workspace_folder) meta.workspace_folder = base
			}
		}
		if (workspacePath && !path.isAbsolute(workspacePath)) workspacePath = (await found(workspacePath)) ?? workspacePath
		if (meta.workspace_path && !path.isAbsolute(meta.workspace_path)) {
			meta.workspace_path = (await found(meta.workspace_path)) ?? meta.workspace_path
		}
	}
	return { ...entry, workspace_path: workspacePath, metadata_snapshot: meta }
}

const identityOf = (entry: MapLayerCatalogEntry): IdentityLayer => ({
	id: entry.id,
	layerType: entry.layer_type,
	geojson: "",
	metadata: entry.metadata_snapshot,
})

export async function migrateCatalogEntries(input: MapLayerCatalogEntry[], options: MigrationOptions): Promise<RestoreMigration> {
	const readText = options.readText ?? defaultReadText
	const exists = options.exists ?? defaultExists
	let entries: MapLayerCatalogEntry[] = []
	for (const entry of input) {
		entries.push(isVectorEntry(entry) ? await absolutise(entry, options.workspaceRoot, exists) : entry)
	}

	// 2. Entries that name no file: the same name and the same parsed content as a project file means the same file.
	const pathOf = (entry: MapLayerCatalogEntry) => resolvedSourcePath(entry.metadata_snapshot, options.realpath)
	const known = entries.filter(isVectorEntry).flatMap((entry) => {
		const p = pathOf(entry)
		return p ? [p] : []
	})
	const next: MapLayerCatalogEntry[] = []
	for (const entry of entries) {
		if (!isVectorEntry(entry) || pathOf(entry) || !entry.geojson_cache_path) {
			next.push(entry)
			continue
		}
		const cachePath = path.isAbsolute(entry.geojson_cache_path)
			? entry.geojson_cache_path
			: path.join(options.cacheDir, entry.geojson_cache_path)
		const candidates = new Set<string>(known.filter((p) => stem(p) === (entry.name || "").toLowerCase()))
		if (options.workspaceRoot && entry.name) {
			for (const ext of [".geojson", ".json"]) candidates.add(path.join(options.workspaceRoot, `${entry.name}${ext}`))
		}
		let matched: string | undefined
		let cached: string | undefined
		for (const candidate of candidates) {
			cached ??= await readText(cachePath)
			if (cached === undefined) break
			const projectText = await readText(candidate)
			if (projectText !== undefined && sameGeojson(cached, projectText)) {
				matched = candidate
				break
			}
		}
		next.push(
			matched
				? {
						...entry,
						metadata_snapshot: {
							...entry.metadata_snapshot,
							source_path: matched,
							...(options.workspaceRoot ? { workspace_folder: options.workspaceRoot } : {}),
						},
					}
				: entry,
		)
	}
	entries = next

	// 3. One file, one entry. The first in draw order stays.
	const kept: MapLayerCatalogEntry[] = []
	const aliases: Record<string, string> = {}
	for (const entry of entries) {
		const survivorIndex = isVectorEntry(entry)
			? kept.findIndex(
					(k) => isVectorEntry(k) && matchFile(identityOf(k), identityOf(entry), options.realpath) !== "different",
				)
			: -1
		if (survivorIndex < 0) {
			kept.push(entry)
			continue
		}
		const survivor = kept[survivorIndex]
		const meta = mergedMetadata(survivor.metadata_snapshot, entry.metadata_snapshot)
		// What the user set on the duplicate is kept when the survivor has none of its own: name, legend and graduated
		// settings, and a style that is not the default one.
		for (const key of USER_KEYS) {
			if (!meta[key] && entry.metadata_snapshot?.[key]) meta[key] = entry.metadata_snapshot[key]
		}
		const lendStyle = !isNonDefaultStyle(survivor.style) && isNonDefaultStyle(entry.style)
		if (
			lendStyle &&
			!survivor.metadata_snapshot?.symbology_user_override &&
			entry.metadata_snapshot?.symbology_user_override
		) {
			meta.symbology_user_override = entry.metadata_snapshot.symbology_user_override
		}
		kept[survivorIndex] = {
			...survivor,
			visible: survivor.visible || entry.visible,
			style: lendStyle ? entry.style : survivor.style,
			metadata_snapshot: meta,
		}
		aliases[entry.id] = survivor.id
	}
	return { entries: kept, aliases, mergedCount: Object.keys(aliases).length }
}
