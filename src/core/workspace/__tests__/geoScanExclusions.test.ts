import { expect } from "chai"
import { describe, it } from "mocha"
import { isExcludedWorkspaceGeoPath, WORKSPACE_GEO_EXCLUDE_GLOB } from "../geoScanExclusions"

describe("geoScanExclusions", () => {
	it("excludes dependency, VCS, worktree and archive directories at any depth", () => {
		for (const p of [
			"node_modules/x/a.json",
			"pkg/node_modules/x/a.json",
			".worktrees/v2040-ui-s3/data/basin.geojson",
			"_archive/old/a.json",
			".git/objects/a.json",
			"a/.venv/lib/b.json",
			"env/lib/python3.12/site-packages/x/a.json",
			"proj/.tox/py312/a.json",
			"lib/site-packages/pkg/a.json",
			"nb/.ipynb_checkpoints/a.json",
			".cache/pip/a.json",
			"rust/target/debug/a.json",
		]) {
			expect(isExcludedWorkspaceGeoPath(p), p).to.equal(true)
		}
	})

	it("keeps ordinary workspace files, including a file that merely shares an excluded name", () => {
		for (const p of ["basin.geojson", "data/gauges.json", "outputs/run1/basin.geojson", "build.json", "dist"]) {
			expect(isExcludedWorkspaceGeoPath(p), p).to.equal(false)
		}
	})

	it("builds a findFiles exclude glob from the same list", () => {
		expect(WORKSPACE_GEO_EXCLUDE_GLOB).to.contain("**/.worktrees/**").and.to.contain("**/_archive/**")
	})
})
