/**
 * Which persisted map-layer catalog entries are restored on startup.
 *
 * `~/.aihydro/map_layer_catalog.json` is global and had no scope or cap, so layers from every earlier
 * investigation piled up and were all re-hydrated. Two general rules replace that:
 *   1. Scope: when the catalog records the workspace it was written for and that differs from the current
 *      workspace, nothing is restored. Legacy catalogs without a scope are treated as unscoped.
 *   2. Cap: at most MAX_RESTORED_LAYERS entries are restored, the most recently added ones (the end of the
 *      display order). The total is reported so the UI can say "Restored N of M" instead of hiding the rest.
 *      Entries beyond the cap are returned as `overflow`; the controller carries them through every catalog
 *      rewrite so they stay on disk and can be restored later.
 */
import type { MapLayerCatalog, MapLayerCatalogEntry } from "./mapLayerCatalog"

export const MAX_RESTORED_LAYERS = 40

export interface RestoreSelection {
	/** Entries to restore, in display order. */
	entries: MapLayerCatalogEntry[]
	/** Entries in the catalog file. */
	total: number
	/** Entries skipped because the catalog belongs to a different workspace. */
	outOfScope: number
	/** Entries skipped by the cap. */
	capped: number
	/** The skipped entries themselves (oldest first): kept on disk and restorable on request, never dropped. */
	overflow: MapLayerCatalogEntry[]
}

export function orderedCatalogEntries(catalog: MapLayerCatalog): MapLayerCatalogEntry[] {
	const order = catalog.layer_order ?? []
	return [
		...order.map((id) => catalog.layers.find((l) => l.id === id)).filter((e): e is MapLayerCatalogEntry => !!e),
		...catalog.layers.filter((l) => !order.includes(l.id)),
	]
}

export function selectCatalogEntriesToRestore(
	catalog: MapLayerCatalog,
	currentScope: string | undefined,
	cap: number = MAX_RESTORED_LAYERS,
): RestoreSelection {
	const all = orderedCatalogEntries(catalog)
	if (catalog.workspace_root && currentScope && catalog.workspace_root !== currentScope) {
		return { entries: [], total: all.length, outOfScope: all.length, capped: 0, overflow: [] }
	}
	const split = Math.max(0, all.length - cap)
	const entries = all.slice(split)
	return { entries, total: all.length, outOfScope: 0, capped: split, overflow: all.slice(0, split) }
}
