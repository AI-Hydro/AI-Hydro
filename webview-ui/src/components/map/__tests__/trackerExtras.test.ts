import { beforeEach, describe, expect, it } from "vitest"
import { hasTrackerData, TRACKER_EXTRAS_KEY, trackerExtrasEnabled } from "../trackerExtras"

const plain = { status: "open", priority: null, tags: [], collectionIds: [] }
beforeEach(() => localStorage.clear())

describe("tracker fields default", () => {
	it("is off for plain sketches and on when a saved sketch holds tracker data", () => {
		expect(trackerExtrasEnabled([plain])).toBe(false)
		for (const data of [{ status: "done" }, { priority: "high" }, { tags: ["a"] }, { collectionIds: ["c1"] }]) {
			expect(hasTrackerData([{ ...plain, ...data }])).toBe(true)
			expect(trackerExtrasEnabled([{ ...plain, ...data }])).toBe(true)
		}
	})

	it("a saved choice wins either way", () => {
		localStorage.setItem(TRACKER_EXTRAS_KEY, "0")
		expect(trackerExtrasEnabled([{ ...plain, tags: ["a"] }])).toBe(false)
		localStorage.setItem(TRACKER_EXTRAS_KEY, "1")
		expect(trackerExtrasEnabled([plain])).toBe(true)
	})
})
