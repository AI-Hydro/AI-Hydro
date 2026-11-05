import type { MapLayerStyle } from "@shared/proto/cline/map"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { defaultAihydroDir } from "./mapLayerCatalog"

/**
 * What Unload remembers about a layer, in a file of its own beside the layer catalog.
 *
 *   `<AIHYDRO_HOME>/map_unloaded_layers.<12 hex of sha1(workspace root)>.json`
 *
 * It is not part of the catalog: the tools read the catalog as "what is on the map", and an unloaded file is not.
 * Load looks an entry up by the file's resolved path and gives the layer its name, style, opacity and place back.
 *
 * An entry holds no run link, no tool and no study. A file that is loaded again is a file; whether a run made it is
 * for a lookup to say (the by-artifact lookup comes later), never for a name or a folder.
 */

export const SIDECAR_VERSION = 1
/** Entries kept per project. The oldest unload goes first. */
export const SIDECAR_CAP = 500

export interface UnloadedLayerEntry {
	layer_id: string
	name: string
	display_name?: string
	layer_type: string
	style?: Partial<MapLayerStyle>
	opacity?: number
	hidden?: boolean
	position_from_top?: number
	source_size_bytes?: number
	source_mtime_ms?: number
	unloaded_at: number
}

interface SidecarFile {
	version: number
	workspace_root: string
	layers: Record<string, UnloadedLayerEntry>
}

export function sidecarFile(workspaceRoot: string, baseDir: string = defaultAihydroDir()): string {
	const key = createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12)
	return path.join(baseDir, `map_unloaded_layers.${key}.json`)
}

async function read(file: string): Promise<SidecarFile | null> {
	try {
		const parsed = JSON.parse(await fs.readFile(file, "utf8")) as SidecarFile
		return parsed && typeof parsed === "object" && parsed.layers && typeof parsed.layers === "object" ? parsed : null
	} catch {
		return null
	}
}

/** Writes one file at a time, so two unloads in a row never lose one. */
const writes = new Map<string, Promise<unknown>>()
function serialised<T>(file: string, work: () => Promise<T>): Promise<T> {
	const next = (writes.get(file) ?? Promise.resolve()).then(work, work)
	writes.set(
		file,
		next.catch(() => {}),
	)
	return next
}

async function writeAtomic(file: string, data: SidecarFile): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
	await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
	await fs.rename(tmp, file)
}

const ENTRY_KEYS: (keyof UnloadedLayerEntry)[] = [
	"layer_id",
	"name",
	"display_name",
	"layer_type",
	"style",
	"opacity",
	"hidden",
	"position_from_top",
	"source_size_bytes",
	"source_mtime_ms",
	"unloaded_at",
]

/** Only the settings the user chose are kept. Anything else on the object, a run link included, is dropped here. */
function onlySettings(entry: UnloadedLayerEntry): UnloadedLayerEntry {
	const out: Record<string, unknown> = {}
	for (const key of ENTRY_KEYS) if (entry[key] !== undefined) out[key] = entry[key]
	return out as unknown as UnloadedLayerEntry
}

/** Keeps (or replaces) the entry for a file. `resolvedPath` is the file's one resolved path. */
export function saveUnloaded(
	workspaceRoot: string,
	resolvedPath: string,
	entry: UnloadedLayerEntry,
	baseDir?: string,
): Promise<void> {
	const file = sidecarFile(workspaceRoot, baseDir)
	return serialised(file, async () => {
		const current = (await read(file)) ?? { version: SIDECAR_VERSION, workspace_root: workspaceRoot, layers: {} }
		delete current.layers[resolvedPath]
		current.layers[resolvedPath] = onlySettings(entry)
		const keys = Object.keys(current.layers)
		for (const old of keys.slice(0, Math.max(0, keys.length - SIDECAR_CAP))) delete current.layers[old]
		await writeAtomic(file, { ...current, version: SIDECAR_VERSION, workspace_root: workspaceRoot })
	})
}

/** The entry for a file, without removing it. */
export async function peekUnloaded(
	workspaceRoot: string,
	resolvedPath: string,
	baseDir?: string,
): Promise<UnloadedLayerEntry | undefined> {
	return (await read(sidecarFile(workspaceRoot, baseDir)))?.layers[resolvedPath]
}

/** The entry for a file, removed once it has been used: a layer on the map is not "unloaded" any more. */
export function takeUnloaded(
	workspaceRoot: string,
	resolvedPath: string,
	baseDir?: string,
): Promise<UnloadedLayerEntry | undefined> {
	const file = sidecarFile(workspaceRoot, baseDir)
	return serialised(file, async () => {
		const current = await read(file)
		const entry = current?.layers[resolvedPath]
		if (!current || !entry) return undefined
		delete current.layers[resolvedPath]
		await writeAtomic(file, current)
		return entry
	})
}
