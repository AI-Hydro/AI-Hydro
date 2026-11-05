import { expect } from "chai"
import { describe, it } from "mocha"
import { looksLikeGeoJson, SNIFF_BYTES } from "../geoSniff"

const fc = '{"type":"FeatureCollection","features":[]}'
describe("geoSniff", () => {
	it("validates a small file whole", () => {
		expect(looksLikeGeoJson(fc, fc.length, ".json")).to.equal(true)
		expect(looksLikeGeoJson('{"type":"Nope"}', 15, ".geojson")).to.equal(false)
		expect(looksLikeGeoJson("[1,2]", 5, ".json")).to.equal(false)
	})
	it("judges a large .json from its prefix, and trusts .geojson by name once it opens as an object", () => {
		const big = SNIFF_BYTES * 10
		expect(looksLikeGeoJson(`﻿  ${fc.slice(0, -2)}`, big, ".json")).to.equal(true)
		expect(looksLikeGeoJson('{"name":"config","items":[1,2,3]', big, ".json")).to.equal(false)
		expect(looksLikeGeoJson('{"name":"x"', big, ".geojson")).to.equal(true)
		expect(looksLikeGeoJson("<kml>", big, ".geojson")).to.equal(false)
	})
})
