import { dirProjectKey, type ProjectKey } from "@core/project/projectIdentity"
import * as path from "path"

/**
 * "Remove from list" for the Layers panel's Project files tree.
 *
 * It changes one list on one machine and never touches a file: nothing in this module (or the feature) deletes, moves
 * or renames anything on disk. The list lives in the extension's `globalState`, one key per project, the way
 * `pinStore.ts` keeps pins, so a window only ever rewrites its own project's list:
 *
 *   `aihydro.map.fileList.removed.v1:<projectKey>`   RemovedEntry[]
 *
 * An entry is `{ folderHash, relativePath, kind, removedAt }`. The folder is a hash of its resolved path and the file is
 * its path inside that folder, so no absolute path (and no user name in a home directory) is ever stored, and the entry
 * means the same file in a multi-root window whichever order the folders are listed in. `prj_` and `dir:` keys follow
 * the pin rule: a list saved under the folder's `dir:` key is merged into the project's `prj_` key once it has one.
 */

export const REMOVED_KEY_PREFIX = "aihydro.map.fileList.removed.v1:"
/** Entries kept per project. A list longer than this keeps the newest. */
export const REMOVED_CAP = 2_000

export interface RemovedEntry {
	folderHash: string
	/** Forward slashes, relative to the folder. For a folder entry, the folder's own path. */
	relativePath: string
	kind: "file" | "folder"
	removedAt: number
}

/** The slice of `vscode.Memento` this needs, so it can be tested with a Map. */
export interface FileListStateStore {
	get<T>(key: string): T | undefined
	update(key: string, value: unknown): PromiseLike<void>
}

export const removedKey = (projectKey: string): string => REMOVED_KEY_PREFIX + projectKey

/** A hash of the folder's resolved path. Same input as the project's `dir:` key, shortened; never the path itself. */
export async function folderHashOf(folderPath: string): Promise<string> {
	return (await dirProjectKey(folderPath)).slice("dir:".length, "dir:".length + 16)
}

/** Forward slashes, no leading `./`, no trailing slash. */
export function normalizeRelative(relativePath: string): string {
	return relativePath
		.replace(/\\/g, "/")
		.replace(/^(\.\/)+/, "")
		.replace(/\/+$/, "")
}

/** True for a path that could not be inside a folder: absolute, a drive path, or one that climbs out with `..`. */
function escapes(relativePath: string): boolean {
	const n = normalizeRelative(relativePath)
	return n === "" || path.isAbsolute(n) || /^[A-Za-z]:/.test(n) || n.split("/").includes("..")
}

function isEntry(value: unknown): value is RemovedEntry {
	if (!value || typeof value !== "object") return false
	const e = value as Partial<RemovedEntry>
	return (
		typeof e.folderHash === "string" &&
		typeof e.relativePath === "string" &&
		(e.kind === "file" || e.kind === "folder") &&
		!escapes(e.relativePath)
	)
}

const entryKey = (e: Pick<RemovedEntry, "folderHash" | "relativePath" | "kind">): string =>
	`${e.kind}\u0000${e.folderHash}\u0000${e.relativePath}`

function readList(store: FileListStateStore, projectKey: string): RemovedEntry[] {
	const raw = store.get<unknown>(removedKey(projectKey))
	return Array.isArray(raw) ? raw.filter(isEntry) : []
}

/** `primary` first, then the entries of `extra` it does not already have. */
function mergeEntries(primary: RemovedEntry[], extra: RemovedEntry[]): RemovedEntry[] {
	const seen = new Set(primary.map(entryKey))
	return [...primary, ...extra.filter((e) => !seen.has(entryKey(e)))]
}

/**
 * The removed entries of one project. When the project now has a `prj_` id, a list saved under the folder's `dir:` key
 * is merged into it and the old key is cleared, as an explicit step.
 */
export async function readRemoved(
	store: FileListStateStore,
	key: ProjectKey,
	options: { dirKey?: string } = {},
): Promise<RemovedEntry[]> {
	if (key.kind === "prj" && options.dirKey && options.dirKey !== key.key) {
		const old = readList(store, options.dirKey)
		if (old.length > 0) {
			await store.update(removedKey(key.key), mergeEntries(readList(store, key.key), old).slice(-REMOVED_CAP))
			await store.update(removedKey(options.dirKey), undefined)
		}
	}
	return readList(store, key.key)
}

/** Add entries (kept in the order they were removed). Entries that escape their folder are ignored. Returns how many were added. */
export async function addRemoved(
	store: FileListStateStore,
	projectKey: string,
	entries: { folderHash: string; relativePath: string; kind?: "file" | "folder" }[],
	now: number = Date.now(),
): Promise<number> {
	const current = readList(store, projectKey)
	const have = new Set(current.map(entryKey))
	const fresh: RemovedEntry[] = []
	for (const e of entries) {
		if (!e.folderHash || escapes(e.relativePath)) continue
		const entry: RemovedEntry = {
			folderHash: e.folderHash,
			relativePath: normalizeRelative(e.relativePath),
			kind: e.kind === "folder" ? "folder" : "file",
			removedAt: now,
		}
		if (have.has(entryKey(entry))) continue
		have.add(entryKey(entry))
		fresh.push(entry)
	}
	if (fresh.length > 0) await store.update(removedKey(projectKey), [...current, ...fresh].slice(-REMOVED_CAP))
	return fresh.length
}

/** Take entries off the removed list (`all` empties it). Returns how many came back. */
export async function restoreRemoved(
	store: FileListStateStore,
	projectKey: string,
	which: "all" | { folderHash: string; relativePath: string; kind?: "file" | "folder" }[],
): Promise<number> {
	const current = readList(store, projectKey)
	if (which === "all") {
		if (current.length > 0) await store.update(removedKey(projectKey), [])
		return current.length
	}
	const drop = new Set(which.map((e) => entryKey({ ...e, relativePath: normalizeRelative(e.relativePath), kind: e.kind === "folder" ? "folder" : "file" })))
	const kept = current.filter((e) => !drop.has(entryKey(e)))
	if (kept.length !== current.length) await store.update(removedKey(projectKey), kept)
	return current.length - kept.length
}

export interface RemovedIndex {
	/** True when this file is on the removed list itself, or lies under a removed folder. */
	has(folderHash: string, relativePath: string): boolean
}

export function indexRemoved(entries: RemovedEntry[]): RemovedIndex {
	const files = new Set<string>()
	const folders = new Map<string, string[]>()
	for (const e of entries) {
		if (e.kind === "file") files.add(`${e.folderHash}\u0000${e.relativePath}`)
		else folders.set(e.folderHash, [...(folders.get(e.folderHash) ?? []), e.relativePath])
	}
	return {
		has(folderHash, relativePath) {
			const rel = normalizeRelative(relativePath)
			if (files.has(`${folderHash}\u0000${rel}`)) return true
			return (folders.get(folderHash) ?? []).some((f) => rel === f || rel.startsWith(`${f}/`))
		},
	}
}
