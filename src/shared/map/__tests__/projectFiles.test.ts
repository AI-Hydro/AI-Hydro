import { expect } from "chai"
import { describe, it } from "mocha"
import { formatBytes, formatCount, isLargeLoad, LARGE_LOAD_BYTES, notOnMapHeader } from "../projectFiles"

describe("projectFiles helpers", () => {
	it("formats sizes", () => {
		expect([96, 820_000, 1_200_000, 12_400_000, 2_500_000_000].map(formatBytes)).to.deep.equal(["96 B", "820 KB", "1.2 MB", "12 MB", "2.5 GB"])
		expect(formatBytes(undefined)).to.equal("")
	})
	it("is honest about a truncated count", () => {
		expect(formatCount(5000, true)).to.equal("5,000+")
		expect(notOnMapHeader(2, false)).to.equal("Not on the map · 2 files")
		expect(notOnMapHeader(1, false)).to.equal("Not on the map · 1 file")
		expect(notOnMapHeader(0, false)).to.equal("Not on the map · 0 files")
		expect(notOnMapHeader(5000, true)).to.equal("Not on the map · 5,000+ files")
	})
	it("asks only above the threshold", () => {
		expect(isLargeLoad(LARGE_LOAD_BYTES)).to.equal(false)
		expect(isLargeLoad(LARGE_LOAD_BYTES + 1)).to.equal(true)
	})
})
