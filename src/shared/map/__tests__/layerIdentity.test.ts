import { expect } from "chai"
import { describe, it } from "mocha"
import { findDuplicate, matchFile, mergedMetadata, planMerge, preferKept, resolvedSourcePath, sameFile } from "../layerIdentity"

const L = (id: string, metadata: Record<string, string> = {}, geojson = "", layerType = "polygon") => ({
	id,
	layerType,
	geojson,
	metadata,
})
const GJ = '{"type":"FeatureCollection","features":[{"a":1}]}'
const GJ2 = GJ.replace("1", "2") // same length, different content

describe("layer identity: one file is one layer", () => {
	it("resolves a workspace layer's folder and relative path to the same path a user-added layer has", () => {
		const workspace = { source: "workspace", path: "vectors/watershed_01013500.geojson", workspace_folder: "/w/proj" }
		const user = { source: "user", source_path: "/w/proj/vectors/watershed_01013500.geojson" }
		expect(resolvedSourcePath(workspace)).to.equal("/w/proj/vectors/watershed_01013500.geojson")
		expect(resolvedSourcePath(user)).to.equal(resolvedSourcePath(workspace))
		expect(resolvedSourcePath({ path: "vectors/x.geojson" })).to.equal(undefined)
	})

	it("normalises dot segments, duplicate slashes, backslashes and Windows case, and resolves symlinks when asked", () => {
		expect(resolvedSourcePath({ source_path: "/w/proj/./v/../v//a.geojson" })).to.equal("/w/proj/v/a.geojson")
		expect(resolvedSourcePath({ source_path: "C:\\W\\Proj\\a.geojson" })).to.equal("c:/w/proj/a.geojson")
		expect(resolvedSourcePath({ source_path: "/w/link/a.geojson" }, (p) => p.replace("/link/", "/real/"))).to.equal(
			"/w/real/a.geojson",
		)
		expect(
			resolvedSourcePath({ source_path: "/w/x.geojson" }, () => {
				throw new Error("ENOENT")
			}),
		).to.equal("/w/x.geojson")
	})

	it("same file added twice by two routes is one: restored plus workspace, whatever the ids and names", () => {
		const restored = L("polygon-170-ab", { source: "user", source_path: "/w/proj/v/a.geojson" })
		const workspace = L(
			"workspace_v_a_geojson",
			{ source: "workspace", path: "v/a.geojson", workspace_folder: "/w/proj" },
			GJ,
		)
		expect(matchFile(restored, workspace)).to.equal("same")
		expect(findDuplicate([restored], workspace)?.layer.id).to.equal("polygon-170-ab")
		expect(sameFile(workspace, workspace)).to.equal(false)
		// With content on both sides, identical content at one path is "same".
		expect(matchFile(L("a", { source_path: "/p/a.geojson" }, GJ), L("b", { source_path: "/p/a.geojson" }, GJ))).to.equal(
			"same",
		)
	})

	it("two files with the same name and different content are two layers", () => {
		const a = L("a", { source: "user", source_path: "/w/one/basin.geojson" }, GJ)
		const b = L("b", { source: "user", source_path: "/w/two/basin.geojson" }, GJ2)
		expect(matchFile(a, b)).to.equal("different")
		expect(matchFile(L("c", {}, GJ), L("d", {}, GJ2))).to.equal("different")
		expect(
			matchFile(L("c1", { source_path: "/w/one/basin.geojson" }, GJ), L("c2", { source_path: "/w/two/basin.geojson" }, GJ)),
		).to.equal("different")
	})

	it("the same path with different content means the file changed (reload, overwrite): not a duplicate", () => {
		const onMap = L(
			"workspace_v_a",
			{ source: "workspace", path: "v/a.geojson", workspace_folder: "/w", source_size_bytes: "52" },
			GJ,
		)
		const reload = L("user-a", { source: "user", source_path: "/w/v/a.geojson", source_size_bytes: "52" }, GJ2)
		expect(matchFile(onMap, reload)).to.equal("changed")
		// A restored layer has no content here; a different recorded size says the same.
		expect(
			matchFile(
				L("r", { source_path: "/w/v/a.geojson", source_size_bytes: "10" }),
				L("n", { source_path: "/w/v/a.geojson", source_size_bytes: "11" }, GJ),
			),
		).to.equal("changed")
	})

	it("with no path on one side, identical content is the same file; different size is never", () => {
		expect(matchFile(L("a", { source: "user" }, GJ), L("b", { source: "workspace", path: "x.geojson" }, GJ))).to.equal("same")
		expect(matchFile(L("a", { source_size_bytes: "10" }, GJ), L("b", { source_size_bytes: "11" }, GJ))).to.equal("different")
	})

	it("results from different runs or different tools are never merged, even with identical content", () => {
		expect(
			matchFile(
				L("r1", { _run_id: "run-1", source_path: "/w/out.geojson" }, GJ),
				L("r2", { _run_id: "run-2", source_path: "/w/out.geojson" }, GJ),
			),
		).to.equal("different")
		expect(matchFile(L("t1", { tool: "delineate_watershed" }, GJ), L("t2", { tool: "extract_rivers" }, GJ))).to.equal(
			"different",
		)
		const plain = L("p", { source: "workspace", source_path: "/w/out.geojson" })
		expect(matchFile(L("r1", { _run_id: "run-1", source_path: "/w/out.geojson" }, GJ), plain)).to.equal("same")
		expect(preferKept(plain, L("r1", { _run_id: "run-1" }), ["p"]).id).to.equal("r1")
	})

	it("compares content without hashing: a one-character change at equal length is seen, and repeated ids do not go stale", () => {
		const a = L("e", { source_path: "/p/x" }, GJ)
		expect(matchFile(a, L("n", { source_path: "/p/x" }, `${GJ} `))).to.equal("changed")
		expect(matchFile(a, L("n", { source_path: "/p/x" }, GJ))).to.equal("same")
		expect(matchFile(a, L("n", { source_path: "/p/x" }, GJ2))).to.equal("changed")
	})

	it("a merge keeps the run link and source keys from either side, and replaces nothing", () => {
		const keep = { source: "user", style: "mine", _run_id: "" }
		const other = {
			_run_id: "run-9",
			tool: "delineate_watershed",
			study_id: "s1",
			path: "v/a.geojson",
			workspace_folder: "/w",
			source: "workspace",
			source_size_bytes: "52",
			validation_status: "ok",
			units: "mm",
			crs: "EPSG:4326",
			coverage_status: "full",
			uncertainty: "u",
			source_mtime_ms: "5",
			source_status: "current",
		}
		const merged = mergedMetadata(keep, other)
		expect(merged).to.include({
			source: "user",
			style: "mine",
			_run_id: "run-9",
			tool: "delineate_watershed",
			study_id: "s1",
			path: "v/a.geojson",
			source_size_bytes: "52",
			validation_status: "ok",
			units: "mm",
			crs: "EPSG:4326",
			coverage_status: "full",
			uncertainty: "u",
			source_mtime_ms: "5",
			source_status: "current",
		})
		expect(mergedMetadata({ _run_id: "run-1" }, { _run_id: "run-2" })._run_id).to.equal("run-1")
	})

	it("plans a merge: the existing layer always survives, so its id, style, visibility and order do not move", () => {
		const existing = L("e", { source: "user", source_path: "/w/a.geojson" })
		const withRun = L("r", { source: "tool", _run_id: "run-3", tool: "delineate_watershed", source_path: "/w/a.geojson" })
		const plan = planMerge(existing, withRun, "same")
		expect(plan).to.include({ kind: "merge", keptId: "e", aliasId: "r", takeContent: false })
		expect(plan.metadata._run_id).to.equal("run-3")
		const run = L("e2", { _run_id: "run-4", source_path: "/w/a.geojson" })
		expect(planMerge(run, L("n2", { source: "user", source_path: "/w/a.geojson" }), "same").metadata._run_id).to.equal(
			"run-4",
		)
	})

	it("plans an update when the file changed: new content, user keys kept, status current", () => {
		const existing = L(
			"e",
			{
				source: "workspace",
				path: "v/a.geojson",
				workspace_folder: "/w",
				display_name: "My basin",
				source_status: "source_changed",
			},
			GJ,
		)
		const reload = L("n", { source: "user", source_path: "/w/v/a.geojson", source_size_bytes: "99", display_name: "a" }, GJ2)
		const plan = planMerge(existing, reload, "changed")
		expect(plan).to.include({ kind: "update", keptId: "e", takeContent: true })
		expect(plan.metadata).to.include({ display_name: "My basin", source_status: "current", source_size_bytes: "99" })
		expect(plan.priorRun).to.equal(undefined)
	})

	it("a layer with run R1 whose file was overwritten and re-added plain loses the run link and says which run", () => {
		const existing = L(
			"e",
			{
				_run_id: "R1",
				tool: "delineate_watershed",
				provenance_path: "/p.json",
				source_path: "/w/a.geojson",
				study_id: "s1",
			},
			GJ,
		)
		const plan = planMerge(existing, L("n", { source: "user", source_path: "/w/a.geojson" }, GJ2), "changed")
		expect(plan.priorRun).to.equal("R1")
		expect(plan.metadata._run_id).to.equal(undefined)
		expect(plan.metadata.tool).to.equal(undefined)
		expect(plan.metadata.provenance_path).to.equal(undefined)
		expect(plan.metadata._prior_run_id).to.equal("R1")
		// Annotations about the run go with it, so they do not sit beside content they did not describe.
		for (const key of ["study_id", "uncertainty", "validation_status", "units", "crs"])
			expect(plan.metadata[key], key).to.equal(undefined)
	})

	it("an agent re-push with the same run and path updates the layer and keeps the run", () => {
		const existing = L("e", { _run_id: "R1", tool: "delineate_watershed", source_path: "/w/a.geojson" }, GJ)
		const push = L("n", { _run_id: "R1", tool: "delineate_watershed", source_path: "/w/a.geojson" }, GJ2)
		expect(matchFile(existing, push)).to.equal("changed")
		const plan = planMerge(existing, push, "changed")
		expect(plan.priorRun).to.equal(undefined)
		expect(plan.metadata._run_id).to.equal("R1")
	})

	it("run annotations the incoming layer supplies are kept; the rest go with the run link", () => {
		const existing = L("e", { _run_id: "R1", units: "mm", crs: "EPSG:4326", source_path: "/w/a.geojson" }, GJ)
		const plan = planMerge(existing, L("n", { source: "user", source_path: "/w/a.geojson", units: "m3/s" }, GJ2), "changed")
		expect(plan.metadata.units).to.equal("m3/s")
		expect(plan.metadata.crs).to.equal(undefined)
	})

	it("an empty incoming layer (a restore) is the same file and never overwrites; an empty value never replaces a real one", () => {
		const onMap = L("e", { source_path: "/w/a.geojson", source_size_bytes: "52", units: "mm" }, GJ)
		const restored = L("n", { source_path: "/w/a.geojson", source_size_bytes: "99", units: "" }, "")
		expect(matchFile(onMap, restored)).to.equal("same")
		const plan = planMerge(onMap, restored, "same")
		expect(plan.takeContent).to.equal(false)
		expect(plan.metadata).to.include({ source_size_bytes: "52", units: "mm" })
		expect(
			matchFile(
				L("r", { source_path: "/w/a.geojson", source_size_bytes: "52" }, ""),
				L("n2", { source_path: "/w/a.geojson", source_size_bytes: "99" }, GJ),
			),
		).to.equal("changed")
		expect(planMerge(onMap, L("n3", { source_path: "/w/a.geojson", units: "" }, GJ2), "changed").metadata.units).to.equal(
			"mm",
		)
	})
})
