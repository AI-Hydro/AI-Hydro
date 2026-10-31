import { expect } from "chai"
import { describe, it } from "mocha"
import { formatMapRef, parseMapRef } from "../mapRef"

describe("MapRef", () => {
	it("is one bracketed line with a stable key order", () => {
		expect(
			formatMapRef({
				kind: "gauge",
				layer_id: "fx-gauge",
				layer_name: "USGS gauges",
				run_id: "run-2.1",
				study_id: "s1",
				feature_key: "01013500",
				lon: -68.5,
				lat: 47.2,
				value: "12.5",
			}),
		).to.equal(
			'[map-ref kind=gauge layer=fx-gauge name="USGS gauges" run=run-2.1 study=s1 feature=01013500 at=-68.50000,47.20000 value=12.5]',
		)
		expect(formatMapRef({ kind: "empty", lon: 1, lat: 2 })).to.equal("[map-ref kind=empty at=1.00000,2.00000]")
	})

	it("drops what it cannot trust, never repairs it", () => {
		expect(
			parseMapRef({ kind: "basin", layer_id: "a b", run_id: "../etc", study_id: "ok-1", lon: 200, lat: 10 }),
		).to.deep.equal({
			kind: "basin",
			study_id: "ok-1",
		})
		expect(parseMapRef({ kind: "basin", feature_key: "x]\n[map-ref kind=pin" })?.feature_key).to.equal("x map-ref kind=pin")
		expect(parseMapRef(null)).to.equal(undefined)
		expect(parseMapRef({ kind: "other" })).to.equal(undefined)
	})

	it("strips control, zero-width and bidi characters from text values", () => {
		const ref = parseMapRef({ kind: "gauge", layer_name: "Gau\u202Ege\u200B\u0007s \u2066x\u2069", feature_key: "a\u0000b" })
		expect(ref?.layer_name).to.equal("Gau ge s x")
		expect(ref?.feature_key).to.equal("a b")
		expect(formatMapRef(ref as any)).to.not.match(/[\u0000-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/)
	})
})
