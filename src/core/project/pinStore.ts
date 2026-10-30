import type { ProjectKey } from "./projectIdentity"

/**
 * Where the map keeps a project's pins (UX program 2026-11, X1-M2). These are the owner's own data, so the rules are
 * about never writing to the wrong place and never losing an entry.
 *
 * Layout (one Memento key per project, so a window only ever rewrites its own project):
 *   `aihydro.map.pins.v1:<projectKey>`   { annotations, collections, tombstones }
 *   `aihydro.map.pins.legacyClaimedBy.v1`  the project that took over the pre-project list
 *   `aihydro.map.pins.quarantine.v1`       entries the webview could not read, kept verbatim
 *   `aihydro.map.annotations.v2`           the pre-project global list: never written, never deleted
 *
 * The bucket is chosen when the map LOADS and then travels with every save (`checkSaveTarget`): the host writes only to
 * the key the webview loaded, and refuses (asks for a reload) when that key no longer belongs to the open folder. So a
 * folder reorder or a `dir:` -> `prj_` flip mid-session can never write one project's pins over another's.
 *
 * Loading does three things, each idempotent: (1) when the project now has a `prj_` id, an older `dir:` bucket is
 * merged into it, honouring deletions through tombstones, and removed; (2) the pre-project list is offered to the
 * first REAL project (never "no folder"), marked `imported`; (3) the bucket is read.
 */

export const LEGACY_ANNOTATIONS_KEY = "aihydro.map.annotations.v2"
export const LEGACY_COLLECTIONS_KEY = "aihydro.map.annotation.collections.v1"
export const PINS_KEY_PREFIX = "aihydro.map.pins.v1:"
export const LEGACY_CLAIMED_BY_KEY = "aihydro.map.pins.legacyClaimedBy.v1"
export const QUARANTINE_KEY = "aihydro.map.pins.quarantine.v1"
/** The key used when no folder is open. It never claims the legacy list. */
export const NO_FOLDER_KEY = "dir:none"

const TOMBSTONE_CAP = 500
const QUARANTINE_CAP = 500

export interface PinBucket {
	annotations: unknown[]
	collections: unknown[]
	/** Ids deleted in this bucket, so a merge does not bring them back. */
	tombstones?: string[]
}

/** The slice of `vscode.Memento` this needs, so it can be tested with a Map. */
export interface PinStateStore {
	get<T>(key: string): T | undefined
	update(key: string, value: unknown): PromiseLike<void>
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const idOf = (e: unknown): string | undefined =>
	e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string" ? (e as { id: string }).id : undefined

export const bucketKey = (projectKey: string): string => PINS_KEY_PREFIX + projectKey

function readBucket(store: PinStateStore, projectKey: string): PinBucket | undefined {
	const raw = store.get<PinBucket>(bucketKey(projectKey))
	return raw && typeof raw === "object"
		? {
				annotations: asList(raw.annotations),
				collections: asList(raw.collections),
				tombstones: asList(raw.tombstones) as string[],
			}
		: undefined
}

/** `primary` first, then the entries of `extra` that are not already there and not in `dropIds`. */
function mergeById(primary: unknown[], extra: unknown[], dropExtra: Set<string>, dropPrimary: Set<string>): unknown[] {
	const kept = primary.filter((e) => {
		const id = idOf(e)
		return id === undefined || !dropPrimary.has(id)
	})
	const seen = new Set(kept.map(idOf).filter((v): v is string => v !== undefined))
	return [
		...kept,
		...extra.filter((e) => {
			const id = idOf(e)
			return id === undefined || (!seen.has(id) && !dropExtra.has(id))
		}),
	]
}

const markImported = (entry: unknown): unknown =>
	entry && typeof entry === "object" && !Array.isArray(entry)
		? { ...(entry as Record<string, unknown>), imported: true }
		: undefined

export interface LoadedPins extends PinBucket {
	projectKey: string
	/** How many entries came from the pre-project list on this call (0 on every call after the first). */
	importedCount: number
}

/** The legacy list belongs to nobody yet, or only to the "no folder" bucket (which is not a project). */
const legacyUnclaimed = (store: PinStateStore): boolean => {
	const claimed = store.get<string>(LEGACY_CLAIMED_BY_KEY)
	return claimed === undefined || claimed === NO_FOLDER_KEY
}

/**
 * The pins of one project. `dirKey` is the same folder's `dir:` key; pass it whenever `key` is a `prj_` id so a bucket
 * saved before the project had an id follows the project. `legacyLocal` is the webview's own copy of the old list, used
 * when the host never received one.
 */
export async function loadPinsForProject(
	store: PinStateStore,
	key: ProjectKey,
	options: { dirKey?: string; legacyLocal?: unknown } = {},
): Promise<LoadedPins> {
	// 1. dir: -> prj_, as an explicit step.
	if (key.kind === "prj" && options.dirKey && options.dirKey !== key.key) {
		const old = readBucket(store, options.dirKey)
		if (old) {
			const current = readBucket(store, key.key)
			const oldGone = new Set(old.tombstones)
			const curGone = new Set(current?.tombstones)
			const merged: PinBucket = current
				? {
						annotations: mergeById(current.annotations, old.annotations, curGone, oldGone),
						collections: mergeById(current.collections, old.collections, new Set(), new Set()),
						tombstones: [...new Set([...curGone, ...oldGone])].slice(-TOMBSTONE_CAP),
					}
				: old
			await store.update(bucketKey(key.key), merged)
			await store.update(bucketKey(options.dirKey), undefined)
		}
	}

	// 2. The pre-project list goes to the first real project, once. The claim marker is written first and read back, so
	//    two windows racing for it cannot both import.
	let importedCount = 0
	if (key.key !== NO_FOLDER_KEY && !readBucket(store, key.key) && legacyUnclaimed(store)) {
		const hostLegacy = asList(store.get<unknown[]>(LEGACY_ANNOTATIONS_KEY))
		const legacy = (hostLegacy.length > 0 ? hostLegacy : asList(options.legacyLocal)).map(markImported).filter(Boolean)
		if (legacy.length > 0) {
			await store.update(LEGACY_CLAIMED_BY_KEY, key.key)
			if (store.get<string>(LEGACY_CLAIMED_BY_KEY) === key.key) {
				await store.update(bucketKey(key.key), {
					annotations: legacy,
					collections: asList(store.get<unknown[]>(LEGACY_COLLECTIONS_KEY)),
					tombstones: [],
				})
				importedCount = legacy.length
			}
		}
	}

	// 3. Read.
	const bucket = readBucket(store, key.key)
	return {
		projectKey: key.key,
		annotations: bucket?.annotations ?? [],
		collections: bucket?.collections ?? [],
		importedCount,
	}
}

/**
 * Can this save be written? `given` is the key the webview loaded. It may be written only when it still belongs to the
 * open folder: its current key, or the `dir:` key of the same folder (a `dir:` bucket stays a `dir:` bucket until the
 * next load migrates it). Anything else means the open folder changed under the webview: it must reload, not write.
 */
export function checkSaveTarget(given: unknown, current: { key: ProjectKey; dirKey?: string }): "write" | "reload" {
	if (typeof given !== "string" || given === "") {
		return "reload"
	}
	return given === current.key.key || given === current.dirKey ? "write" : "reload"
}

/** Replace one project's bucket and remember which ids were deleted. Other projects are never touched. */
export async function savePinsForProject(
	store: PinStateStore,
	projectKey: string,
	annotations: unknown,
	collections: unknown,
): Promise<void> {
	const prev = readBucket(store, projectKey)
	const next = asList(annotations)
	const nextIds = new Set(next.map(idOf).filter((v): v is string => v !== undefined))
	const deleted = (prev?.annotations ?? []).map(idOf).filter((v): v is string => v !== undefined && !nextIds.has(v))
	const tombstones = [...(prev?.tombstones ?? []), ...deleted].filter((id) => !nextIds.has(id))
	await store.update(bucketKey(projectKey), {
		annotations: next,
		collections: asList(collections),
		tombstones: [...new Set(tombstones)].slice(-TOMBSTONE_CAP),
	})
}

/** Keep entries the webview could not read, verbatim, so the next save cannot lose them. */
export async function quarantinePins(store: PinStateStore, projectKey: string, entries: unknown): Promise<number> {
	const incoming = asList(entries)
	if (incoming.length === 0) {
		return 0
	}
	const existing = asList(store.get<unknown[]>(QUARANTINE_KEY))
	const stamp = new Date().toISOString()
	const additions = incoming.map((entry) => ({ projectKey, quarantinedAt: stamp, entry }))
	const seen = new Set(existing.map((e) => JSON.stringify((e as { entry?: unknown })?.entry)))
	const fresh = additions.filter((a) => !seen.has(JSON.stringify(a.entry)))
	if (fresh.length > 0) {
		await store.update(QUARANTINE_KEY, [...existing, ...fresh].slice(-QUARANTINE_CAP))
	}
	return fresh.length
}
