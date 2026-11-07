import { Controller } from "@core/controller"
import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import { expect } from "chai"
import { describe, it } from "mocha"
import { refreshLayerFromFile } from "../refreshFromFile"

const GJ = '{"type":"FeatureCollection","features":[{"a":1}]}'
const GJ2 = '{"type":"FeatureCollection","features":[{"a":2}]}'
const snap = { sizeBytes: 50, mtimeMs: 1_700_000_000_123.4, sha256: "abc" }
const NOW = "2026-11-07T10:00:00.000Z"
const layer = (meta: Record<string, string> = {}) =>
	MapLayer.create({
		id: "user-a",
		name: "a",
		geojson: GJ,
		layerType: "polygon",
		visible: false,
		style: MapLayerStyle.create({ fillColor: "#123456", strokeWidth: 4 }),
		metadata: {
			source: "user",
			source_path: "/w/a.geojson",
			source_size_bytes: "52",
			source_status: "source_changed",
			...meta,
		},
	})

describe("refreshLayerFromFile", () => {
	it("takes the new content and the version's size, time and hash; id, name, style and visibility stay", () => {
		const before = layer({ display_name: "My basin" })
		const out = refreshLayerFromFile(before, { geojson: GJ2, snapshot: snap, updatedAtIso: NOW }, "auto")
		if (!out.ok) throw new Error(out.reason)
		expect(out.layer.id).to.equal("user-a")
		expect(out.layer.name).to.equal("a")
		expect(out.layer.visible).to.equal(false)
		expect(out.layer.style).to.deep.equal(before.style)
		expect(out.layer.geojson).to.equal(GJ2)
		expect(out.layer.metadata).to.include({
			source_size_bytes: "50",
			source_mtime_ms: "1700000000123",
			source_sha256: "abc",
			source_status: "current",
			source_updated_at_utc: NOW,
			display_name: "My basin",
			source_path: "/w/a.geojson",
		})
	})

	it("drops what described the old content: a preview made from it, the version a flag had seen, an error", () => {
		const out = refreshLayerFromFile(
			layer({
				display_geojson_path: "/c/p.geojson",
				display_mode: "preview",
				preview_feature_count: "3",
				source_seen_sha256: "zzz",
				source_seen_size_bytes: "9",
				source_error: "boom",
				source_status: "source_unreadable",
			}),
			{ geojson: GJ2, snapshot: snap, updatedAtIso: NOW },
			"auto",
		)
		if (!out.ok) throw new Error(out.reason)
		for (const key of [
			"display_geojson_path",
			"display_mode",
			"preview_feature_count",
			"source_seen_sha256",
			"source_seen_size_bytes",
			"source_error",
		]) {
			expect(out.layer.metadata[key], key).to.equal(undefined)
		}
		expect(out.layer.metadata.source_status).to.equal("current")
	})

	it("refuses an automatic update for each kind of evidence link, and says so", () => {
		for (const link of [{ _run_id: "r.1" }, { study_id: "s" }, { tool: "t" }, { claim_id: "c" }] as Array<
			Record<string, string>
		>) {
			const out = refreshLayerFromFile(layer(link), { geojson: GJ2, snapshot: snap, updatedAtIso: NOW }, "auto")
			expect(out.ok, JSON.stringify(link)).to.equal(false)
		}
	})

	it("the user's choice removes the whole link, notes which run, and keeps what the user set", () => {
		const out = refreshLayerFromFile(
			layer({
				_run_id: "r.1",
				tool: "t",
				study_id: "s",
				claim_id: "c",
				uncertainty: "ci",
				display_name: "Mine",
				gauge_id: "01013500",
			}),
			{ geojson: GJ2, snapshot: snap, updatedAtIso: NOW },
			"use_new_file",
		)
		if (!out.ok) throw new Error(out.reason)
		const meta = out.layer.metadata
		for (const key of ["_run_id", "tool", "study_id", "claim_id", "uncertainty", "gauge_id"])
			expect(meta[key], key).to.equal(undefined)
		expect(meta._prior_run_id).to.equal("r.1")
		expect(meta.display_name).to.equal("Mine")
		expect(out.priorRun).to.equal("r.1")
	})

	it("a parse cannot set the host's keys: links, paths, source, facts", () => {
		const out = refreshLayerFromFile(
			layer(),
			{
				geojson: GJ2,
				snapshot: snap,
				updatedAtIso: NOW,
				metadata: {
					_run_id: "forged",
					tool: "forged",
					study_id: "forged",
					source_path: "/etc/passwd",
					path: "/etc/passwd",
					source: "tool",
					source_sha256: "forged",
					_fact_keys: "n_features",
					n_features: "99",
					source_format: "kml",
					feature_count: "2",
				},
			},
			"auto",
		)
		if (!out.ok) throw new Error(out.reason)
		const meta = out.layer.metadata
		expect(meta._run_id).to.equal(undefined)
		expect(meta.tool).to.equal(undefined)
		expect(meta.study_id).to.equal(undefined)
		expect(meta.source_path).to.equal("/w/a.geojson")
		expect(meta.path).to.equal(undefined)
		expect(meta.source).to.equal("user")
		expect(meta.source_sha256).to.equal("abc")
		expect(meta._fact_keys).to.equal(undefined)
		expect(meta.n_features).to.equal(undefined)
		expect(meta.source_format).to.equal("kml")
		expect(meta.feature_count).to.equal("2")
	})

	it("refuses an empty new version", () => {
		expect(refreshLayerFromFile(layer(), { geojson: "", snapshot: snap, updatedAtIso: NOW }, "auto").ok).to.equal(false)
	})
})

describe("Controller.refreshMapLayerFromFile", () => {
	/** The method touches only these members; a fake that lacks anything else (the session service, aliases) fails the test if it reaches for one. */
	function fakeController(l: MapLayer) {
		const calls = { notified: [] as MapLayer[], synced: 0 }
		const fake: any = {
			mapLayers: new Map([[l.id, l]]),
			resolveMapLayerId: (id: string) => id,
			notifyMapLayerSubscribers: (x: MapLayer) => calls.notified.push(x),
			syncMapLayerCatalog: () => {
				calls.synced++
				return Promise.resolve()
			},
		}
		return { fake, calls }
	}
	const run = (fake: unknown, mode: "auto" | "use_new_file") =>
		(Controller.prototype as any).refreshMapLayerFromFile.call(
			fake,
			"user-a",
			{ geojson: GJ2, snapshot: snap, updatedAtIso: NOW },
			mode,
		)

	it("updates the layer in the store and tells the panel once; no focus or selection event, so the camera does not move", () => {
		const { fake, calls } = fakeController(layer())
		const out = run(fake, "auto")
		expect(out.ok).to.equal(true)
		expect(fake.mapLayers.get("user-a").geojson).to.equal(GJ2)
		expect(calls.notified.length).to.equal(1)
		expect(calls.notified[0].id).to.equal("user-a")
		expect(calls.synced).to.equal(1)
	})

	it("changes nothing for a linked layer in automatic mode", () => {
		const { fake, calls } = fakeController(layer({ _run_id: "r.1" }))
		const out = run(fake, "auto")
		expect(out.ok).to.equal(false)
		expect(fake.mapLayers.get("user-a").geojson).to.equal(GJ)
		expect(calls.notified.length).to.equal(0)
	})

	it("says so when the layer is gone", () => {
		const { fake } = fakeController(layer())
		fake.mapLayers.clear()
		expect(run(fake, "auto").ok).to.equal(false)
	})
})
