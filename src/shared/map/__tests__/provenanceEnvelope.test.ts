import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { describe, it } from "mocha"
import { mapLayerToLiveLayer } from "../liveLayer"
import { layerRetrievedAt, layerRunId, layerTool, readEnvelope, runLayerMetadata } from "../provenanceEnvelope"

describe("provenanceEnvelope", () => {
	it("reads only the envelope keys and drops empties", () => {
		expect(readEnvelope({ _run_id: "r1", tool: "t", chat_id: "", extra: "x", run_id: "legacy" })).to.deep.equal({
			_run_id: "r1",
			tool: "t",
		})
	})

	it("a layer with no _run_id has no run record; the legacy run_id key is never read", () => {
		expect(layerRunId({ run_id: "legacy", tool: "t" })).to.equal(undefined)
		expect(layerRunId({ _run_id: "  " })).to.equal(undefined)
		expect(layerRunId({ _run_id: "r1" })).to.equal("r1")
	})

	it("tool and retrieved_at prefer the envelope keys and fall back to the older names", () => {
		expect(layerTool({ tool: "a", tool_name: "b" })).to.equal("a")
		expect(layerTool({ tool_name: "b" })).to.equal("b")
		expect(layerRetrievedAt({ retrieved_at: "2026-01-01T00:00:00Z", timestamp: "x" })).to.equal("2026-01-01T00:00:00Z")
		expect(layerRetrievedAt({ timestamp: "x" })).to.equal("x")
	})

	it("runLayerMetadata copies the envelope under _run_id", () => {
		const meta = runLayerMetadata(
			{ _run_id: "run-9", study_id: "st_1", chat_id: "c1", tool: "delineate_watershed", retrieved_at: "t" },
			{ runId: "ignored-because-envelope-wins", sessionId: "st_other" },
		)
		expect(meta._run_id).to.equal("run-9")
		expect(meta.study_id).to.equal("st_1")
		expect(meta.chat_id).to.equal("c1")
		expect(meta.tool).to.equal("delineate_watershed")
		expect(meta).to.not.have.property("run_id")
	})

	it("runLayerMetadata falls back to the command's own run_id, and omits _run_id when there is none", () => {
		const withRun = runLayerMetadata(undefined, { runId: "run-3", sessionId: "st_2" })
		expect(withRun._run_id).to.equal("run-3")
		expect(withRun.study_id).to.equal("st_2")
		expect(withRun).to.not.have.property("run_id")
		const none = runLayerMetadata(undefined, { runId: "", sessionId: "" })
		expect(none).to.not.have.property("_run_id")
		expect(none).to.not.have.property("run_id")
	})

	it("the live layer chip reads the same key", () => {
		const layer = MapLayer.create({ id: "l", name: "n", layerType: "polygon", metadata: { _run_id: "r1", tool: "t" } })
		const live = mapLayerToLiveLayer(layer)
		expect(live.runId).to.equal("r1")
		expect(live.toolName).to.equal("t")
	})
})
