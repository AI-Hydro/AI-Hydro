import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { rowIndicators } from "../layerModel"
import { runTag, sourceNote } from "../sourceNoteText"

const L = (metadata: Record<string, string>, geojson = '{"type":"FeatureCollection","features":[]}'): MapLayer =>
	({ id: "a", name: "a", layerType: "polygon", visible: true, geojson, metadata }) as unknown as MapLayer

describe("what a layer says about its file", () => {
	it("says nothing for a layer whose file is as it was", () => {
		expect(sourceNote(L({ source_path: "/w/a.geojson", source_status: "current" }))).toBeUndefined()
	})

	it("a followed update leaves a line with the time, and says which run link was removed after Use new file", () => {
		const note = sourceNote(
			L({
				source_path: "/w/a.geojson",
				source_updated_at_utc: "2026-11-07T10:00:00.000Z",
				_prior_run_id: "dfetch.1.2.ab12cd34",
			}),
		)
		expect(note?.kind).toBe("updated")
		expect(note?.text).toMatch(/^Updated from the file on disk at .+\. The link to run ab12cd34 was removed\.$/)
		expect(note?.useNewFile).toBeUndefined()
	})

	it("a layer with a run link says the file changed after the run and what the map shows", () => {
		const note = sourceNote(L({ source_status: "source_changed", _run_id: "dfetch.1.2.ab12cd34" }))
		expect(note?.text).toBe("The file changed after this run. The map still shows the run's result.")
		expect(note?.useNewFile?.question).toBe(
			"Use the new file? The link to run ab12cd34 will be removed, because this content did not come from that run.",
		)
	})

	it("does not claim a copy the layer does not hold", () => {
		const note = sourceNote(L({ source_status: "source_changed", _run_id: "dfetch.1.2.ab12cd34" }, ""))
		expect(note?.text).not.toContain("still shows")
		expect(note?.text).toContain("draws the file as it is now")
		// A cached copy or a preview is a copy.
		expect(
			sourceNote(L({ source_status: "source_changed", _run_id: "r.1", geojson_cache_path: "/c/a.geojson" }, ""))?.text,
		).toContain("still shows")
	})

	it("a linked layer with no run (a study, a tool, a claim) names its evidence, not a run", () => {
		for (const link of [{ study_id: "prj" }, { tool: "t" }, { claim_id: "c" }] as Array<Record<string, string>>) {
			const note = sourceNote(L({ source_status: "source_changed", ...link }))
			expect(note?.text).toContain("after this layer's evidence was recorded")
			expect(note?.useNewFile?.question).toContain("link to its evidence")
		}
	})

	it("a layer that cannot update itself (no link, e.g. a raster) says to load the file again, with no button", () => {
		const note = sourceNote(L({ source_status: "source_changed" }))
		expect(note?.kind).toBe("changed_manual")
		expect(note?.text).toContain("Remove it and load the file again")
		expect(note?.useNewFile).toBeUndefined()
	})

	it("a changed linked raster offers no Use new file (it cannot be replaced in place)", () => {
		const raster = {
			...L({ source_status: "source_changed", _run_id: "dfetch.1.2.ab12cd34" }),
			layerType: "raster",
		} as unknown as MapLayer
		const note = sourceNote(raster)
		expect(note?.useNewFile).toBeUndefined()
		expect(note?.text).toContain("Load the file again")
	})

	it("a layer whose file is not watched says so quietly, and an update line wins over it", () => {
		expect(sourceNote(L({ source_watch: "not_watched", source_path: "/home/u/x.geojson" }))?.text).toMatch(
			/^Not watched: this file is outside the open folders/,
		)
		expect(sourceNote(L({ source_watch: "not_watched", source_status: "source_missing", source_path: "/x" }))?.kind).toBe(
			"missing",
		)
	})

	it("unreadable and missing say what happened and which copy is shown", () => {
		expect(sourceNote(L({ source_status: "source_unreadable", source_error: "Unexpected end of JSON input" }))?.text).toBe(
			"Could not read the new version: Unexpected end of JSON input. Showing the last good copy.",
		)
		expect(sourceNote(L({ source_status: "source_missing", source_path: "/w/data/x.geojson" }))?.text).toBe(
			"File not found: /w/data/x.geojson. Showing the last loaded copy.",
		)
	})

	it("none of it says Reload", () => {
		for (const status of ["source_changed", "source_unreadable", "source_missing"]) {
			for (const link of [{}, { _run_id: "r.1" }] as Array<Record<string, string>>) {
				const note = sourceNote(L({ source_status: status, ...link }))
				expect(note?.text).not.toMatch(/reload/i)
			}
		}
	})

	it("the row carries a warning for a changed, unreadable or missing file", () => {
		for (const status of ["source_changed", "source_unreadable", "source_missing"]) {
			expect(rowIndicators(L({ source_status: status, _run_id: "r.1" })).warnings.length, status).toBeGreaterThan(0)
		}
		expect(rowIndicators(L({ source_status: "current" })).warnings).toEqual([])
	})

	it("runTag is the last segment of the run id", () => {
		expect(runTag("dfetch.20261017.e2eproo.48d4b668")).toBe("48d4b668")
		expect(runTag("plain")).toBe("plain")
	})
})
