import { afterEach, describe, expect, it, vi } from "vitest"
import { flyToTransition } from "../flyToTransition"

const mockMedia = (reduce: boolean) =>
	vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("prefers-reduced-motion: reduce") }))

afterEach(() => vi.unstubAllGlobals())

describe("flyToTransition", () => {
	it("animates by default", () => {
		mockMedia(false)
		const t = flyToTransition(1500)
		expect(t.transitionDuration).toBe(1500)
		expect(t.transitionInterpolator).toBeDefined()
	})
	it("jumps (no transition props) under prefers-reduced-motion", () => {
		mockMedia(true)
		expect(flyToTransition(1500)).toEqual({})
	})
})
