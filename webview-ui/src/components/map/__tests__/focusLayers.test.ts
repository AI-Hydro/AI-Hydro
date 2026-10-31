import { describe, expect, it } from "vitest"
import { focusLayersMessage, IDLE_MS, mayMoveCamera } from "../focusLayers"

describe("focus layers", () => {
	it("moves the camera only when the map has been left alone", () => {
		expect(mayMoveCamera(10_000, 10_000 + IDLE_MS - 1)).toBe(false)
		expect(mayMoveCamera(10_000, 10_000 + IDLE_MS)).toBe(true)
		expect(mayMoveCamera(0, 60_000)).toBe(true)
	})

	it("never claims a camera move that did not happen", () => {
		expect(focusLayersMessage(2, 2, true)).toBe("Showing 2 layers from the run.")
		expect(focusLayersMessage(1, 1, false)).toMatch(/did not move/)
		expect(focusLayersMessage(1, 3, true)).toMatch(/2 not on this map/)
		expect(focusLayersMessage(0, 2, false)).toMatch(/None of that run/)
	})
})
