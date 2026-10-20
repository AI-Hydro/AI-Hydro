import type { Layer } from "@deck.gl/core"

/**
 * Returns new layer instances for one Deck.
 *
 * A deck.gl layer instance owns GPU state (`internalState`) once a Deck has initialised it, and a finalised
 * layer cannot be reused: a second Deck's LayerManager calls `_initialize()`, whose first statement is
 * `assert(!this.internalState)` ("deck.gl: assertion failed"). The map hits this whenever the same cached
 * instances reach a new Deck, i.e. after Retry imagery or a WebGL context restore (the Deck is re-keyed) and in
 * swipe mode (two Decks share the overlay layers).
 *
 * `clone({})` is deck.gl's own copy mechanism: same id and props, no `internalState`. Cloning per Deck and per
 * Deck epoch is a general rule that covers every layer, including ones added later, instead of fixing each
 * memoised layer separately. Deck matches layers by id between renders, so a clone of an already-rendered
 * layer inherits its tile cache and attributes; only the instance is new.
 */
export function freshLayers<T extends Layer>(layers: ReadonlyArray<T | null | undefined | false>): T[] {
	const fresh: T[] = []
	for (const layer of layers) {
		if (layer) {
			fresh.push(layer.clone({}) as T)
		}
	}
	return fresh
}
