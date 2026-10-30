import type { ProjectKey } from "./projectIdentity"

/**
 * Where the map keeps a project's pins (UX program 2026-11, X1-M2).
 *
 * Pins used to live in one global list, so a pin dropped in one project showed up in every other. They are now
 * keyed by the project: `prj_...` once the tools server knows the directory, otherwise `dir:<hash>` (see
 * `projectIdentity.ts`). The map webview stays ignorant of keys; it asks the host for "my pins" and sends "these are
 * my pins", and the host picks the bucket.
 *
 * Three things happen on load, in this order, and each is idempotent:
 *   1. a `dir:` bucket is renamed to the `prj_` bucket the first time the project has a real id;
 *   2. the pre-project global list is handed, once, to the first project that opens the map. Its pins are marked
 *      `imported` so the UI can offer "Keep / Clear all" (map-polish decision D3). Nothing is deleted from the legacy
 *      key, so a downgrade still finds its pins;
 *   3. a bucket is read.
 */

/** The pre-project global list (webview `aihydro.map.annotations.v2`) and its collections. */
export const LEGACY_ANNOTATIONS_KEY = "aihydro.map.annotations.v2"
export const LEGACY_COLLECTIONS_KEY = "aihydro.map.annotation.collections.v1"
/** `Record<projectKey, PinBucket>`. */
export const PINS_BY_PROJECT_KEY = "aihydro.map.pins.byProject.v1"
/** The project key that took over the legacy list. Written once, never cleared. */
export const LEGACY_CLAIMED_BY_KEY = "aihydro.map.pins.legacyClaimedBy.v1"

export interface PinBucket {
	annotations: unknown[]
	collections: unknown[]
}

/** The slice of `vscode.Memento` this needs, so it can be tested with a Map. */
export interface PinStateStore {
	get<T>(key: string): T | undefined
	update(key: string, value: unknown): PromiseLike<void>
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Mark a legacy entry as imported. Entries that are not objects are dropped here, the webview validates the rest. */
const markImported = (entry: unknown): unknown =>
	entry && typeof entry === "object" && !Array.isArray(entry)
		? { ...(entry as Record<string, unknown>), imported: true }
		: undefined

/** `primary` first, then the entries of `extra` whose id is not already there (the same pin saved under both keys). */
function mergeById(primary: unknown[], extra: unknown[]): unknown[] {
	const id = (e: unknown) => (e && typeof e === "object" ? (e as { id?: unknown }).id : undefined)
	const seen = new Set<unknown>(primary.map(id).filter((v) => v !== undefined))
	return [...primary, ...extra.filter((e) => id(e) === undefined || !seen.has(id(e)))]
}

export interface LoadedPins extends PinBucket {
	projectKey: string
	/** How many entries came from the pre-project list on this call (0 on every call after the first). */
	importedCount: number
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
	const all: Record<string, PinBucket> = { ...(store.get<Record<string, PinBucket>>(PINS_BY_PROJECT_KEY) ?? {}) }
	let changed = false

	if (key.kind === "prj" && options.dirKey && options.dirKey !== key.key && all[options.dirKey]) {
		const old = all[options.dirKey]
		const current = all[key.key]
		all[key.key] = current
			? {
					annotations: mergeById(asList(current.annotations), asList(old.annotations)),
					collections: asList(current.collections),
				}
			: old
		delete all[options.dirKey]
		changed = true
	}

	let importedCount = 0
	if (!all[key.key] && store.get<string>(LEGACY_CLAIMED_BY_KEY) === undefined) {
		const hostLegacy = asList(store.get<unknown[]>(LEGACY_ANNOTATIONS_KEY))
		const legacy = (hostLegacy.length > 0 ? hostLegacy : asList(options.legacyLocal)).map(markImported).filter(Boolean)
		if (legacy.length > 0) {
			all[key.key] = { annotations: legacy, collections: asList(store.get<unknown[]>(LEGACY_COLLECTIONS_KEY)) }
			importedCount = legacy.length
			changed = true
			await store.update(LEGACY_CLAIMED_BY_KEY, key.key)
		}
	}

	if (changed) {
		await store.update(PINS_BY_PROJECT_KEY, all)
	}
	const bucket = all[key.key]
	return {
		projectKey: key.key,
		annotations: asList(bucket?.annotations),
		collections: asList(bucket?.collections),
		importedCount,
	}
}

/** Replace one project's bucket. Other projects are never touched. */
export async function savePinsForProject(
	store: PinStateStore,
	key: ProjectKey,
	annotations: unknown,
	collections: unknown,
): Promise<void> {
	const all = { ...(store.get<Record<string, PinBucket>>(PINS_BY_PROJECT_KEY) ?? {}) }
	all[key.key] = { annotations: asList(annotations), collections: asList(collections) }
	await store.update(PINS_BY_PROJECT_KEY, all)
}
