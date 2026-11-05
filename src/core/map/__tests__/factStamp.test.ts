import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { describe, it } from "mocha"
import { applyFactStampPolicy } from "../factStamp"

const layer = (metadata: Record<string, string>, geojson = '{"type":"FeatureCollection","features":[]}') =>
	MapLayer.create({ id: "l1", name: "l1", layerType: "line", geojson, visible: true, metadata })
const STAMPED = {
	_run_id: "r1",
	tool: "gauge_flowlines",
	gauge_id: "01013500",
	n_features: "9",
	_fact_keys: "gauge_id,n_features",
}

describe("applyFactStampPolicy: only an add from a run keeps the stamp", () => {
	it("a plain add loses _fact_keys but keeps what else it carried (including _run_id)", () => {
		const out = applyFactStampPolicy(undefined, layer({ ...STAMPED }), false)
		expect(out.metadata).to.not.have.property("_fact_keys")
		expect(out.metadata._run_id).to.equal("r1")
		expect(out.metadata.gauge_id).to.equal("01013500")
	})
	it("a trusted add (from a run, a restore of the host's catalog, Undo) keeps it", () => {
		const l = layer({ ...STAMPED })
		expect(applyFactStampPolicy(undefined, l, true)).to.equal(l)
	})
	it("a layer with no stamp is returned as it is", () => {
		const l = layer({ gauge_id: "01013500" })
		expect(applyFactStampPolicy(undefined, l, false)).to.equal(l)
	})
	it("the same layer re-sent unchanged (a style edit) keeps the stamp it already had", () => {
		const prior = layer({ ...STAMPED })
		const out = applyFactStampPolicy(prior, layer({ ...STAMPED, display_name: "x" }), false)
		expect(out.metadata._fact_keys).to.equal("gauge_id,n_features")
	})
	it("a re-send with other geometry, other fact values, or no prior stamp does not keep it", () => {
		const prior = layer({ ...STAMPED })
		expect(
			applyFactStampPolicy(prior, layer({ ...STAMPED }, '{"type":"FeatureCollection","features":[1]}'), false).metadata,
		).to.not.have.property("_fact_keys")
		expect(applyFactStampPolicy(prior, layer({ ...STAMPED, n_features: "99" }), false).metadata).to.not.have.property(
			"_fact_keys",
		)
		expect(applyFactStampPolicy(layer({ gauge_id: "01013500" }), layer({ ...STAMPED }), false).metadata).to.not.have.property(
			"_fact_keys",
		)
	})

	it("a re-send that points at another run or tool does not keep the stamp, even with the same geometry and facts", () => {
		const prior = layer({ ...STAMPED })
		expect(applyFactStampPolicy(prior, layer({ ...STAMPED, _run_id: "r2" }), false).metadata).to.not.have.property(
			"_fact_keys",
		)
		expect(applyFactStampPolicy(prior, layer({ ...STAMPED, tool: "other_tool" }), false).metadata).to.not.have.property(
			"_fact_keys",
		)
	})
	it("a forged scene file layer with no prior layer (a new id) loses the stamp", () => {
		const forged = layer({ _run_id: "r9", tool: "gauge_flowlines", gauge_id: "01013500", _fact_keys: "gauge_id" })
		expect(applyFactStampPolicy(undefined, forged, false).metadata).to.not.have.property("_fact_keys")
	})
	it("Undo: a layer the host removed itself comes back with its stamp, only when it is the same layer", () => {
		const removed = layer({ ...STAMPED })
		expect(applyFactStampPolicy(removed, layer({ ...STAMPED }), false).metadata._fact_keys).to.equal("gauge_id,n_features")
		expect(applyFactStampPolicy(removed, layer({ ...STAMPED, gauge_id: "09999999" }), false).metadata).to.not.have.property(
			"_fact_keys",
		)
	})
})
