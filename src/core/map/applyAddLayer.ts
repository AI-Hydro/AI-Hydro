import { findDuplicate, type PathResolver, pathHash, planMerge, resolvedSourcePath } from "@shared/map/layerIdentity"
import { MapLayer } from "@shared/proto/cline/map"

/** The id a layer is known by now: itself, or the layer an earlier merge folded it into. */
export const resolveAlias = (aliases: Map<string, string>, id: string): string => aliases.get(id) ?? id

/** A layer left the map: ids that stood for it no longer stand for anything. */
export function dropAliasesFor(aliases: Map<string, string>, id: string): void {
	for (const [alias, target] of [...aliases]) if (target === id || alias === id) aliases.delete(alias)
}

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
 * - A same-id add is an overwrite (a style edit), never a duplicate, unless it names a different file: then it is a new
 *   layer under an id that carries a hash of its path.
 * - The same file under another id: the layer already on the map stays (id, style, visibility, order) and either
 *   gains the other's run and source keys (same content) or takes the new content (the file changed).
 */
export function applyAddLayer(
	state: LayerStoreState,
	incoming: MapLayer,
	options: { replaceExisting?: boolean } = {},
	realpath?: PathResolver,
): AddOutcome {
	let layer = incoming
	const sameId = options.replaceExisting ? undefined : state.layers.get(layer.id)
	if (sameId) {
		// A same-id add is a style edit or a refresh only when it is the same file. Another file that happens to get the
		// same id (the same name in two folders, from an older build) is its own layer, not an overwrite of the first.
		const onMap = resolvedSourcePath(sameId.metadata, realpath)
		const arriving = resolvedSourcePath(layer.metadata, realpath)
		if (onMap && arriving && onMap !== arriving) {
			layer = MapLayer.create({ ...layer, id: `${layer.id}-${pathHash(arriving)}` })
		}
	}
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
		...(plan.takeContent && layer.geojson ? { geojson: layer.geojson } : {}),
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
