import { expect } from "chai"
import { describe, it } from "mocha"
import { isWatcherExcluded } from "../watcherExclude"

describe("isWatcherExcluded", () => {
	const folders = ["/w/proj"]
	const defaults = { "**/.git/objects/**": true, "**/node_modules/*/**": true, "**/.hg/store/**": false }

	it("matches an enabled glob against the path below the workspace folder", () => {
		expect(isWatcherExcluded(defaults, folders, "/w/proj/node_modules/pkg/a.geojson")).to.equal(true)
		expect(isWatcherExcluded(defaults, folders, "/w/proj/.git/objects/ab/c.json")).to.equal(true)
	})
	it("leaves other files, disabled globs and a missing setting alone", () => {
		expect(isWatcherExcluded(defaults, folders, "/w/proj/data/a.geojson")).to.equal(false)
		expect(isWatcherExcluded(defaults, folders, "/w/proj/.hg/store/a.geojson")).to.equal(false)
		expect(isWatcherExcluded(undefined, folders, "/w/proj/node_modules/pkg/a.geojson")).to.equal(false)
	})
	it("supports a folder-relative glob, * and {a,b}", () => {
		expect(isWatcherExcluded({ "big/**": true }, folders, "/w/proj/big/x/a.geojson")).to.equal(true)
		expect(isWatcherExcluded({ "big/**": true }, folders, "/w/proj/small/big/a.geojson")).to.equal(false)
		expect(isWatcherExcluded({ "**/*.{shp,geojson}": true }, folders, "/w/proj/d/a.geojson")).to.equal(true)
		expect(isWatcherExcluded({ "**/*.{shp,geojson}": true }, folders, "/w/proj/d/a.csv")).to.equal(false)
	})
	it("supports character classes", () => {
		expect(isWatcherExcluded({ "**/[ab]/**": true }, folders, "/w/proj/a/x.geojson")).to.equal(true)
		expect(isWatcherExcluded({ "**/[ab]/**": true }, folders, "/w/proj/c/x.geojson")).to.equal(false)
		expect(isWatcherExcluded({ "[!a]/**": true }, folders, "/w/proj/a/x.geojson")).to.equal(false)
		expect(isWatcherExcluded({ "[!a]/**": true }, folders, "/w/proj/c/x.geojson")).to.equal(true)
	})
	it("matches dot folders", () => {
		expect(isWatcherExcluded({ "**/.cache/**": true }, folders, "/w/proj/.cache/a.geojson")).to.equal(true)
	})
	it("takes a drive letter in either case", () => {
		expect(isWatcherExcluded({ "big/**": true }, ["c:\\w\\proj"], "C:\\w\\proj\\big\\a.geojson")).to.equal(true)
	})
	it("reads Windows separators", () => {
		expect(isWatcherExcluded(defaults, ["C:\\w\\proj"], "C:\\w\\proj\\node_modules\\p\\a.geojson")).to.equal(true)
	})
})
