import { findDuplicate, type PathResolver, planMerge } from "@shared/map/layerIdentity"
import { MapLayer } from "@shared/proto/cline/map"

export interface LayerStoreState {
	layers: Map<string, MapLayer>
	order: string[]
	/** Ids merged away, and the layer that stands for each. */
	aliases: Map<string, string>
}

export type AddOutcome =
	| { kind: "added"; layer: MapLayer }
	| { kind: "merged"; layer: MapLayer; note: string }
	| { kind: "updated"; layer: MapLayer; note: string; priorRun?: string }

/**
 * Add a layer to the store, one file one layer. Mutates `state`; the caller notifies, syncs and speaks.
 * - `replaceExisting` (Undo, opening a scene) restores exactly what it was given, and never merges.
 * - A same-id add is an overwrite (a style edit), never a duplicate.
 * - The same file under another id: the layer already on the map stays (id, style, visibility, order) and either
 *   gains the other's run and source keys (same content) or takes the new content (the file changed).
 */
export function applyAddLayer(
	state: LayerStoreState,
	layer: MapLayer,
	options: { replaceExisting?: boolean } = {},
	realpath?: PathResolver,
): AddOutcome {
	const found =
		options.replaceExisting || state.layers.has(layer.id)
			? undefined
			: findDuplicate(Array.from(state.layers.values()), layer, realpath)
	if (!found) {
		state.layers.set(layer.id, layer)
		if (!state.order.includes(layer.id)) state.order.push(layer.id)
		// Restoring an id that was merged away makes it a real layer again.
		state.aliases.delete(layer.id)
		return { kind: "added", layer }
	}
	const existing = found.layer
	const plan = planMerge(existing, layer, found.match)
	const kept = MapLayer.create({
		...existing,
		...(plan.takeContent ? { geojson: layer.geojson } : {}),
		metadata: plan.metadata,
	})
	state.layers.set(kept.id, kept)
	state.aliases.set(plan.aliasId, plan.keptId)
	const name = kept.metadata?.display_name || kept.name
	if (plan.kind === "merge") {
		return { kind: "merged", layer: kept, note: `Already on the map as “${name}”. Selected it.` }
	}
	return {
		kind: "updated",
		layer: kept,
		priorRun: plan.priorRun,
		note: plan.priorRun
			? `Updated “${name}”: the file changed since run ${plan.priorRun}, so the run link was removed.`
			: `Updated “${name}”: the file changed.`,
	}
}
