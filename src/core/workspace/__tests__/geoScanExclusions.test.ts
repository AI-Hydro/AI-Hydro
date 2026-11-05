import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildExcludeGlob,
	isExcludedByNames,
	isExcludedWorkspaceGeoPath,
	mergeFilesExclude,
	WORKSPACE_GEO_EXCLUDE_GLOB,
} from "../geoScanExclusions"

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

	it("excludes the tools' .aihydro state directory", () => {
		expect(isExcludedWorkspaceGeoPath(".aihydro/runs/r1/basin.geojson")).to.equal(true)
		expect(WORKSPACE_GEO_EXCLUDE_GLOB).to.contain("**/.aihydro/**")
	})

	it("merges files.exclude: directories keep their contents out, braces are reported not dropped", () => {
		const m = mergeFilesExclude({ "**/.hidden": true, "**/*.pyc": true, "**/off": false, "{a,b}": true })
		expect(m.globs).to.include.members(["**/.hidden", "**/.hidden/**", "**/*.pyc"])
		expect(m.globs).to.not.include("**/off")
		expect(m.dirNames).to.deep.equal([".hidden"])
		expect(m.unsupported).to.deep.equal(["{a,b}"])
		expect(buildExcludeGlob(m.globs)).to.contain("**/.hidden/**").and.to.contain("**/node_modules/**")
		expect(isExcludedByNames("x/.hidden/a.json", m.dirNames)).to.equal(true)
		expect(isExcludedByNames(".hidden", m.dirNames)).to.equal(false)
	})
})
