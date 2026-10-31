import { expect } from "chai"
import { describe, it } from "mocha"
import { contentHash, findDuplicate, mergedMetadata, planMerge, preferKept, resolvedSourcePath, sameFile } from "../layerIdentity"

const L = (id: string, metadata: Record<string, string> = {}, geojson = "", layerType = "polygon") => ({
	id,
	layerType,
	geojson,
	metadata,
})
const GJ = '{"type":"FeatureCollection","features":[{"a":1}]}'

describe("layer identity: one file is one layer", () => {
	it("resolves a workspace layer's folder and relative path to the same path a user-added layer has", () => {
		const workspace = { source: "workspace", path: "vectors/watershed_01013500.geojson", workspace_folder: "/w/proj" }
		const user = { source: "user", source_path: "/w/proj/vectors/watershed_01013500.geojson" }
		expect(resolvedSourcePath(workspace)).to.equal("/w/proj/vectors/watershed_01013500.geojson")
		expect(resolvedSourcePath(user)).to.equal(resolvedSourcePath(workspace))
		expect(resolvedSourcePath({ path: "vectors/x.geojson" })).to.equal(undefined)
	})

	it("same file added twice by two routes is one: restored plus workspace, whatever the ids and names", () => {
		const restored = L("polygon-170-ab", { source: "user", source_path: "/w/proj/v/a.geojson" })
		const workspace = L(
			"workspace_v_a_geojson",
			{ source: "workspace", path: "v/a.geojson", workspace_folder: "/w/proj" },
			GJ,
		)
		expect(sameFile(restored, workspace)).to.equal(true)
		expect(findDuplicate([restored], workspace)?.id).to.equal("polygon-170-ab")
		expect(sameFile(workspace, workspace)).to.equal(false)
	})

	it("two files with the same name and different content are two layers", () => {
		const a = L("a", { source: "user", source_path: "/w/one/basin.geojson" }, GJ)
		const b = L("b", { source: "user", source_path: "/w/two/basin.geojson" }, GJ.replace("1", "2"))
		expect(sameFile(a, b)).to.equal(false)
		// Same name, no paths, different content.
		expect(sameFile(L("c", {}, GJ), L("d", {}, GJ.replace("1", "2")))).to.equal(false)
		// Same content at two different paths is two files; the copy is the user's.
		const c1 = L("c1", { source_path: "/w/one/basin.geojson" }, GJ)
		const c2 = L("c2", { source_path: "/w/two/basin.geojson" }, GJ)
		expect(sameFile(c1, c2)).to.equal(false)
	})

	it("with no path on one side, identical content is the same file; different size is never", () => {
		expect(sameFile(L("a", { source: "user" }, GJ), L("b", { source: "workspace", path: "x.geojson" }, GJ))).to.equal(true)
		expect(
			sameFile(
				L("a", { source_path: "/p/a", source_size_bytes: "10" }),
				L("b", { source_path: "/p/a", source_size_bytes: "11" }),
			),
		).to.equal(false)
	})

	it("results from different runs are never merged, even with identical content", () => {
		const r1 = L("r1", { _run_id: "run-1", source_path: "/w/out.geojson" }, GJ)
		const r2 = L("r2", { _run_id: "run-2", source_path: "/w/out.geojson" }, GJ)
		expect(sameFile(r1, r2)).to.equal(false)
		// A run and a plain file at the same path are the same layer; the run is kept.
		const plain = L("p", { source: "workspace", source_path: "/w/out.geojson" })
		expect(sameFile(r1, plain)).to.equal(true)
		expect(preferKept(plain, r1, ["p", "r1"]).id).to.equal("r1")
		expect(preferKept(L("x"), L("y"), ["y", "x"]).id).to.equal("y")
	})

	it("a merge keeps the run link and the source keys from either side, and replaces nothing", () => {
		const keep = { source: "user", style: "mine", _run_id: "" }
		const other = {
			_run_id: "run-9",
			tool: "delineate_watershed",
			study_id: "s1",
			path: "v/a.geojson",
			workspace_folder: "/w",
			source: "workspace",
		}
		const merged = mergedMetadata(keep, other)
		expect(merged).to.include({
			source: "user",
			style: "mine",
			_run_id: "run-9",
			tool: "delineate_watershed",
			study_id: "s1",
			path: "v/a.geojson",
		})
		expect(mergedMetadata({ _run_id: "run-1" }, { _run_id: "run-2" })._run_id).to.equal("run-1")
	})

	it("hashes by content and length", () => {
		expect(contentHash(GJ)).to.equal(contentHash(GJ))
		expect(contentHash(GJ)).to.not.equal(contentHash(`${GJ} `))
	})

	it("plans a merge: the existing layer stays unless the incoming one has the run; order never jumps", () => {
		const existing = L("e", { source: "user", source_path: "/w/a.geojson" })
		const plain = L("n", { source: "workspace", path: "a.geojson", workspace_folder: "/w" })
		const keepExisting = planMerge(existing, plain, ["x", "e", "y"])
		expect(keepExisting).to.include({ winner: "existing", keptId: "e" })
		expect(keepExisting.order).to.deep.equal(["x", "e", "y"])
		expect(keepExisting.removedId).to.equal(undefined)

		const withRun = L("r", { source: "tool", _run_id: "run-3", tool: "delineate_watershed", source_path: "/w/a.geojson" })
		const swap = planMerge(existing, withRun, ["x", "e", "y"])
		expect(swap).to.include({ winner: "incoming", keptId: "r", removedId: "e" })
		expect(swap.order).to.deep.equal(["x", "r", "y"])
		expect(swap.metadata._run_id).to.equal("run-3")

		// The run link survives when the existing layer has it and the incoming does not.
		const run = L("e2", { _run_id: "run-4", source_path: "/w/a.geojson" })
		const kept = planMerge(run, L("n2", { source: "user", source_path: "/w/a.geojson" }), ["e2"])
		expect(kept.metadata._run_id).to.equal("run-4")
	})
})
