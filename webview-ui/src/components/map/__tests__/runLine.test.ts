import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { hashMatch, openRunDisabledReason, runLineOf, showsRunIcon } from "../runLine"

const layer = (metadata: Record<string, string>): MapLayer =>
	({ id: "x", name: "x", layerType: "polygon", visible: true, geojson: "", metadata }) as unknown as MapLayer

describe("the Run line", () => {
	it("names the tool and the run when the layer names its study and run, and Open run is allowed", () => {
		const l = layer({ tool: "delineate_watershed", _run_id: "ab12cd34", study_id: "s1" })
		expect(runLineOf(l)).toEqual({
			kind: "openable",
			text: "delineate_watershed · run ab12cd34",
			studyId: "s1",
			runId: "ab12cd34",
		})
		expect(openRunDisabledReason(l)).toBeUndefined()
		expect(showsRunIcon(l)).toBe(true)
	})

	it("a run with no study cannot open here, and says why", () => {
		const l = layer({ tool: "t", _run_id: "ab12cd34" })
		expect(runLineOf(l).text).toBe("Run ab12cd34. No study recorded, so it cannot open here.")
		expect(openRunDisabledReason(l)).toBe("No study recorded")
		expect(showsRunIcon(l)).toBe(false)
	})

	it("a layer without _run_id has no run, whatever else it carries", () => {
		// A tool name, a study, a provenance path, a file path and a run-looking name are not a run.
		const l = layer({
			source: "workspace",
			tool: "delineate_watershed",
			study_id: "s1",
			provenance_path: "/p.json",
			path: "runs/ab12cd34/basin.geojson",
		})
		expect(runLineOf(l)).toEqual({ kind: "none", text: "Not linked to a run" })
		expect(openRunDisabledReason(l)).toBe("Not linked to a run")
		expect(showsRunIcon(l)).toBe(false)
	})

	it("a reference layer says it is not in any run", () => {
		expect(runLineOf(layer({ source: "nwis" })).text).toBe("Reference, not in any run.")
	})

	it("only the manifest rule with a sha256 may say a file was matched by hash", () => {
		const file = layer({ source: "user" })
		expect(runLineOf(file, { rule: "manifest", sha256: "ab", studyId: "S" })).toEqual({
			kind: "matched",
			text: "Study S, matched by file hash",
			studyId: "S",
		})
		for (const lookup of [
			{ rule: "heuristic", sha256: "ab", studyId: "S" },
			{ rule: "manifest", studyId: "S" },
			{ rule: "path", studyId: "S" },
			{ rule: "manifest", sha256: "ab" },
			{ studyId: "S" },
			undefined,
		]) {
			expect(hashMatch(lookup)).toBeUndefined()
			expect(runLineOf(file, lookup).text).toBe("Not linked to a run")
		}
		// A matched file has no run to open.
		expect(openRunDisabledReason(file)).toBe("Not linked to a run")
	})

	it("a matched file never overrides a layer's own run", () => {
		const l = layer({ tool: "t", _run_id: "r1", study_id: "s1" })
		expect(runLineOf(l, { rule: "manifest", sha256: "ab", studyId: "OTHER" }).kind).toBe("openable")
	})
})
