import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { describe, it } from "mocha"
import { resolveAlias } from "../applyAddLayer"
import { mergeMapLayerPatch } from "../mergeMapLayerPatch"

describe("mergeMapLayerPatch", () => {
	const base = MapLayer.create({
		id: "layer_a",
		name: "Basin",
		geojson: '{"type":"FeatureCollection","features":[]}',
		layerType: "polygon",
		style: {
			fillColor: "#0066CC",
			fillOpacity: 0.4,
			strokeColor: "#003399",
			strokeWidth: 2,
		},
		metadata: {
			graduated_attr: "twi",
			graduated_breaks: "[1,2,3]",
			path: "vectors/basin.geojson",
		},
	})

	it("preserves geojson when patching style", () => {
		const merged = mergeMapLayerPatch(base, {
			style: { fillColor: "#FF0000", fillOpacity: 0.6 },
		})
		expect(merged.geojson).to.equal(base.geojson)
		expect(merged.style?.fillColor).to.equal("#FF0000")
		expect(merged.style?.fillOpacity).to.equal(0.6)
	})

	it("clears graduated metadata when clear_graduated is set", () => {
		const merged = mergeMapLayerPatch(base, { clear_graduated: true })
		expect(merged.metadata?.graduated_attr).to.be.undefined
		expect(merged.metadata?.graduated_breaks).to.be.undefined
		expect(merged.metadata?.path).to.equal("vectors/basin.geojson")
	})

	it("merges metadata keys", () => {
		const merged = mergeMapLayerPatch(base, {
			metadata: {
				graduated_attr: "elev",
				graduated_breaks: "[10,20]",
			},
		})
		expect(merged.metadata?.graduated_attr).to.equal("elev")
	})
})

describe("mergeMapLayerPatch protects the facts recorded on a layer, whoever the caller is", () => {
	const stamped = MapLayer.create({
		id: "canon",
		name: "trace",
		geojson: "{}",
		layerType: "line",
		metadata: {
			_run_id: "r1",
			gauge_id: "01013500",
			truncated: "false",
			n_features: "9",
			_fact_keys: "gauge_id,truncated,n_features",
		},
	})

	it("does not set, change or erase the stamp or a stamped fact, and still applies other keys", () => {
		const out = mergeMapLayerPatch(stamped, {
			metadata: { gauge_id: "09999999", truncated: "", _fact_keys: "", n_features: "1", note: "kept" },
		})
		expect(out.metadata).to.deep.include({
			gauge_id: "01013500",
			truncated: "false",
			n_features: "9",
			_fact_keys: "gauge_id,truncated,n_features",
			note: "kept",
		})
	})

	it("cannot give a layer a stamp it does not have, so it cannot make plain keys look recorded", () => {
		const plain = MapLayer.create({ id: "p", name: "p", geojson: "{}", layerType: "line", metadata: { _run_id: "r1" } })
		const out = mergeMapLayerPatch(plain, { metadata: { _fact_keys: "gauge_id", gauge_id: "01013500" } })
		expect(out.metadata).to.not.have.property("_fact_keys")
		expect(out.metadata.gauge_id).to.equal("01013500") // an ordinary key, unstamped, so the card will not trust it
	})

	it("is reached through an alias of a merged-away layer: the id resolves first, then the layer is merged", () => {
		const aliases = new Map([["old-alias", "canon"]])
		const layers = new Map([["canon", stamped]])
		const target = layers.get(resolveAlias(aliases, "old-alias"))
		expect(target).to.equal(stamped)
		const out = mergeMapLayerPatch(target as MapLayer, { metadata: { gauge_id: "09999999" } })
		expect(out.metadata.gauge_id).to.equal("01013500")
	})
})
