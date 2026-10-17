import { describe, expect, it } from "vitest"
import { DEFAULT_MAP_VIEW, loadMapWorkspace, sanitizePersistedViewState, sanitizeViewStateForDeck } from "../mapWorkspace"

describe("mapWorkspace viewState sanitization", () => {
	it("strips deserialized transitionInterpolator poison", () => {
		const poisoned = {
			longitude: -70,
			latitude: 45,
			zoom: 9,
			transitionDuration: 2000,
			transitionInterpolator: {},
		}
		const safe = sanitizeViewStateForDeck(poisoned as any, DEFAULT_MAP_VIEW)
		expect(safe.longitude).toBe(-70)
		expect(safe.latitude).toBe(45)
		expect(safe.zoom).toBe(9)
		expect(safe.transitionDuration).toBeUndefined()
		expect(safe.transitionInterpolator).toBeUndefined()
	})

	it("sanitizePersistedViewState keeps only camera scalars", () => {
		const safe = sanitizePersistedViewState({
			longitude: 1,
			latitude: 2,
			zoom: 3,
			pitch: 4,
			bearing: 5,
			transitionDuration: 500,
			transitionInterpolator: {},
		} as any)
		expect(safe).toEqual({
			longitude: 1,
			latitude: 2,
			zoom: 3,
			pitch: 4,
			bearing: 5,
		})
	})

	it("loadMapWorkspace rewrites poisoned transition fields from localStorage", () => {
		const key = "aihydro.map.workspace.v1"
		const poisoned = JSON.stringify({
			version: 1,
			viewState: {
				longitude: -95,
				latitude: 40,
				zoom: 4,
				transitionDuration: 2000,
				transitionInterpolator: {},
			},
		})
		localStorage.setItem(key, poisoned)
		const ws = loadMapWorkspace()
		expect(ws.viewState?.transitionInterpolator).toBeUndefined()
		expect(ws.viewState?.transitionDuration).toBeUndefined()
		const rewritten = JSON.parse(localStorage.getItem(key) || "{}")
		expect(rewritten.viewState.transitionInterpolator).toBeUndefined()
		localStorage.removeItem(key)
	})
})
