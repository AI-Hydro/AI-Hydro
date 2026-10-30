#!/usr/bin/env node
/**
 * Self-test for shard partitioning and the coverage proof (no browser). The proof is a gate, so it is shown to
 * fail on a dropped, duplicated, missing and mismatched shard as well as to pass. Run with `npm run ui:screens:selftest`.
 */
import assert from "node:assert/strict"
import { coverageProblems, parseShard, shardScreens } from "./shard.mjs"

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
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `screen-${String((i * 13) % n).padStart(3, "0")}` }))
const ids = (xs) => xs.map((x) => x.id)
const reports = (screens, count) =>
	Array.from({ length: count }, (_, i) => ({
		shard: i + 1,
		of: count,
		screens: ids(shardScreens(screens, { index: i + 1, count })),
		registry: ids(screens),
	}))

check("parseShard accepts i/n and rejects the rest", () => {
	assert.deepEqual(parseShard("2/4"), { index: 2, count: 4 })
	for (const bad of ["0/4", "5/4", "2", "a/b", "1/0", "-1/4", ""]) assert.throws(() => parseShard(bad), bad)
})
for (const [n, count] of [
	[1, 1],
	[3, 4],
	[37, 4],
	[100, 7],
	[714, 4],
	[5, 5],
])
	check(`${n} screens over ${count} shards: each covered exactly once`, () => {
		const screens = mk(n)
		const all = []
		for (let i = 1; i <= count; i++) all.push(...ids(shardScreens(screens, { index: i, count })))
		assert.deepEqual([...all].sort(), ids(screens).sort())
		assert.equal(new Set(all).size, all.length)
	})
check("shard sizes differ by at most one", () => {
	const sizes = [1, 2, 3, 4].map((i) => shardScreens(mk(37), { index: i, count: 4 }).length)
	assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join(","))
})
check("partition does not depend on registry order", () => {
	const a = mk(40)
	const b = [...a].reverse()
	assert.deepEqual(ids(shardScreens(a, { index: 2, count: 4 })), ids(shardScreens(b, { index: 2, count: 4 })))
})
check("complete shard set has no coverage problems", () => {
	const screens = mk(37)
	assert.deepEqual(coverageProblems(ids(screens), reports(screens, 4)), [])
})
check("a screen dropped from a shard is reported", () => {
	const screens = mk(37)
	const r = reports(screens, 4)
	const dropped = r[1].screens.pop()
	assert.ok(coverageProblems(ids(screens), r).some((p) => p.includes(`${dropped} was covered by no shard`)))
})
check("a screen in two shards is reported", () => {
	const screens = mk(37)
	const r = reports(screens, 4)
	r[2].screens.push(r[0].screens[0])
	assert.ok(coverageProblems(ids(screens), r).some((p) => p.includes("covered by shards")))
})
check("a missing shard report is reported", () => {
	const screens = mk(37)
	const r = reports(screens, 4).slice(0, 3)
	assert.ok(coverageProblems(ids(screens), r).some((p) => p.includes("shard 4/4 produced no coverage report")))
})
check("a screen added to the registry after the shards ran is reported", () => {
	const screens = mk(37)
	const r = reports(screens, 4)
	assert.ok(coverageProblems([...ids(screens), "brand-new"], r).length > 0)
})
check("shards that disagree on count are reported", () => {
	const screens = mk(37)
	const r = reports(screens, 4)
	r[0].of = 3
	assert.ok(coverageProblems(ids(screens), r).some((p) => p.includes("disagree")))
})
check("no reports at all fails", () => assert.ok(coverageProblems(["a"], []).length > 0))

if (failures) process.exit(1)
