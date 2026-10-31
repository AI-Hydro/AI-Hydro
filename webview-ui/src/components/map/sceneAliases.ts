/**
 * A saved scene names layers by id. When two layers were merged because they were the same file, the id that went
 * away stands for the layer that stayed. Opening an older scene follows that, so it neither shows a hidden layer for
 * a missing id nor brings the duplicate back.
 */
export interface SceneLike {
	visibleLayerIds?: unknown
	layerOrder?: unknown
	layerOpacities?: unknown
	layers?: unknown
}

export function followAlias(id: string, aliases: Record<string, string>): string {
	// Aliases do not chain (the survivor is never merged away in one pass), but a short walk is safe either way.
	let at = id
	for (let i = 0; i < 4 && aliases[at] && aliases[at] !== at; i++) at = aliases[at]
	return at
}

export function remapSceneIds<T extends SceneLike>(scene: T, aliases: Record<string, string>): T {
	if (Object.keys(aliases).length === 0) return scene
	const map = (id: string) => followAlias(id, aliases)
	const ids = (value: unknown): unknown =>
		Array.isArray(value) ? [...new Set(value.map((v) => (typeof v === "string" ? map(v) : v)))] : value
	const opacities =
		scene.layerOpacities && typeof scene.layerOpacities === "object"
			? Object.entries(scene.layerOpacities as Record<string, number>).reduce<Record<string, number>>((acc, [id, v]) => {
					const target = map(id)
					// The layer that stayed keeps its own opacity if the scene had one for it.
					if (!(target in acc) || target === id) acc[target] = v
					return acc
				}, {})
			: scene.layerOpacities
	// A scene layer whose id was merged away is already on the map as the survivor: do not add it again.
	const layers = Array.isArray(scene.layers)
		? (scene.layers as Array<{ id?: string }>).filter((l) => !(l?.id && aliases[l.id] && aliases[l.id] !== l.id))
		: scene.layers
	return {
		...scene,
		visibleLayerIds: ids(scene.visibleLayerIds),
		layerOrder: ids(scene.layerOrder),
		layerOpacities: opacities,
		layers,
	}
}
