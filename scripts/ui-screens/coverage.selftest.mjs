#!/usr/bin/env node
/**
 * Self-test for the chrome coverage rule on synthetic boxes (no browser). The rule is a gate, so it has to be shown
 * to fail on real overlap as well as to pass. Run with `npm run ui:screens:selftest`.
 */
import assert from "node:assert/strict"
import { coverageLimit, coverageRatio, unionArea } from "./coverage.mjs"

let failures = 0
const check = (name, fn) => {
	try {
		fn()
		console.log(`ok   ${name}`)
	} catch (e) {
		failures++
		console.error(`FAIL ${name}: ${e.message}`)
	}
}
const box = (left, top, right, bottom) => ({ left, top, right, bottom })
const canvas = box(0, 0, 1000, 500)

check("a single box is its own area", () => assert.equal(unionArea([box(0, 0, 10, 20)]), 200))
check("disjoint boxes add", () => assert.equal(unionArea([box(0, 0, 10, 10), box(20, 0, 30, 10)]), 200))
check("overlap is counted once", () => assert.equal(unionArea([box(0, 0, 10, 10), box(5, 5, 15, 15)]), 175))
check("a box inside another adds nothing", () => assert.equal(unionArea([box(0, 0, 100, 100), box(10, 10, 20, 20)]), 10000))
check("an L shape of two boxes is the sum minus the overlap", () =>
	assert.equal(unionArea([box(0, 0, 40, 10), box(0, 0, 10, 40)]), 400 + 400 - 100),
)
check("degenerate and inverted boxes are zero", () =>
	assert.equal(unionArea([box(5, 5, 5, 20), box(9, 9, 3, 3), box(0, 0, 0, 0)]), 0),
)
check("no boxes is zero", () => assert.equal(unionArea([]), 0))

check("coverage is the clipped union over the canvas", () => {
	// A 100x500 strip on the canvas edge is 10% of a 1000x500 canvas.
	assert.equal(coverageRatio([box(900, 0, 1000, 500)], canvas), 0.1)
	// Two overlapping strips count once.
	assert.equal(coverageRatio([box(900, 0, 1000, 500), box(950, 0, 1000, 500)], canvas), 0.1)
})
check("chrome outside the canvas covers nothing (a docked panel)", () => {
	assert.equal(coverageRatio([box(1000, 0, 1340, 500)], canvas), 0)
	// A box straddling the edge only counts the part on the canvas.
	assert.equal(coverageRatio([box(950, 0, 1100, 500)], canvas), 0.05)
})
check("an empty canvas is 0, not NaN", () => assert.equal(coverageRatio([box(0, 0, 10, 10)], box(0, 0, 0, 0)), 0))

check("limits follow plan 4.3", () => {
	assert.equal(coverageLimit({ width: 1280, panelOpen: false, mode: "docked" }), 0.06)
	assert.equal(coverageLimit({ width: 800, panelOpen: false, mode: "overlay" }), 0.06)
	assert.equal(coverageLimit({ width: 400, panelOpen: false, mode: "sheet" }), 0.03)
	assert.ok(coverageLimit({ width: 1280, panelOpen: true, mode: "docked" }) <= 0.001)
	assert.equal(coverageLimit({ width: 800, panelOpen: true, mode: "overlay" }), 0.4)
	assert.equal(coverageLimit({ width: 400, panelOpen: true, mode: "sheet" }), 0.6)
})

// The rule must fail on a layout that breaks the budget, and pass on one that keeps it.
check("a docked panel that overlaps the canvas fails", () => {
	const covered = coverageRatio([box(700, 0, 1000, 500)], canvas) // 30%
	assert.ok(covered > coverageLimit({ width: 1280, panelOpen: true, mode: "docked" }))
})
check("an overlay panel at 37.5% passes and one at 50% fails", () => {
	const limit = coverageLimit({ width: 800, panelOpen: true, mode: "overlay" })
	assert.ok(coverageRatio([box(625, 0, 1000, 500)], canvas) <= limit)
	assert.ok(coverageRatio([box(500, 0, 1000, 500)], canvas) > limit)
})
check("a 40 px rail over a 1000 px canvas is 4%, inside the closed budget", () => {
	const r = coverageRatio([box(960, 0, 1000, 500)], canvas)
	assert.equal(r, 0.04)
	assert.ok(r <= coverageLimit({ width: 1280, panelOpen: false, mode: "docked" }))
})

process.exit(failures ? 1 : 0)
