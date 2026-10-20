import { PathLayer } from "@deck.gl/layers"
import { describe, expect, it } from "vitest"
import { freshLayers } from "../freshLayers"

const transects = [
	{
		path: [
			[0, 0],
			[1, 1],
		] as [number, number][],
	},
]
const makeLayer = () => new PathLayer({ id: "__saved-transects", data: transects, getPath: (t: any) => t.path })

/**
 * A Deck's LayerManager initialises a layer by calling `layer._initialize()`, which starts with
 * `assert(!this.internalState)`. A layer another Deck already initialised and finalised keeps its
 * `internalState` (`_finalize` never clears it), so handing the same instance to a second Deck throws
 * "deck.gl: assertion failed" (the bug: Retry imagery / WebGL context restore re-keys the Deck, and swipe mode
 * renders two Decks from the same cached layers). GPU state is not available in jsdom, so the state a first Deck
 * leaves behind is set directly; what is asserted is deck.gl's own guard.
 */
describe("freshLayers", () => {
	it("reproduces the crash: an already-initialised layer cannot be initialised by another Deck", () => {
		const layer = makeLayer()
		layer.internalState = {} as never // what the first Deck's _initialize() leaves on the instance
		expect(() => (layer as unknown as { _initialize(): void })._initialize()).toThrow(/assertion failed/)
	})

	it("returns new instances with no internal state, so a second Deck can initialise them", () => {
		const layer = makeLayer()
		layer.internalState = {} as never
		const [fresh] = freshLayers([layer])
		expect(fresh).not.toBe(layer)
		expect(fresh.internalState).toBeNull()
		expect(fresh.id).toBe("__saved-transects")
		// _initialize passes its first statement (the assertion); it then needs a GPU context, which jsdom lacks.
		let error: Error | undefined
		try {
			;(fresh as unknown as { _initialize(): void })._initialize()
		} catch (e) {
			error = e as Error
		}
		expect(error?.message ?? "").not.toMatch(/assertion failed/)
	})

	it("keeps ids and props and drops empty entries", () => {
		const a = makeLayer()
		const out = freshLayers([null, a, undefined, false])
		expect(out).toHaveLength(1)
		expect(out[0].props.data).toBe(a.props.data)
	})

	it("gives each Deck its own instances (swipe mode: two Decks, same cached layers)", () => {
		const shared = [makeLayer()]
		const left = freshLayers(shared)
		const right = freshLayers(shared)
		expect(left[0]).not.toBe(right[0])
		expect(left[0]).not.toBe(shared[0])
	})
})
