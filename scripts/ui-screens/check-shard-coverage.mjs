#!/usr/bin/env node
/**
 * Aggregator gate for the sharded screens job: every registered screen must have been covered by exactly one shard.
 *
 *   node scripts/ui-screens/check-shard-coverage.mjs --registry registry.json --shards <dir of shard.json files> [--expect-shards n]
 *
 * registry.json is the output of `run.mjs --list`; each shard writes shard.json (renamed shard-i.json by CI).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { coverageProblems } from "./shard.mjs"

const args = process.argv.slice(2)
const opt = (n) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : undefined)
const registryPath = opt("registry")
const dir = opt("shards")
if (!registryPath || !dir) {
	console.error("usage: check-shard-coverage.mjs --registry <registry.json> --shards <dir>")
	process.exit(2)
}
const registry = JSON.parse(readFileSync(registryPath, "utf8")).screens
const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".json"))
const reports = files.map((f) => JSON.parse(readFileSync(join(dir, String(f)), "utf8")))
const problems = coverageProblems(registry, reports)
// The workflow's matrix and SHARD_COUNT must agree: the shards run with n = --expect-shards, so a matrix that is
// shorter (or longer) than that leaves slices unrendered and shows up here.
const expect = opt("expect-shards")
if (expect !== undefined && reports.some((r) => r.of !== Number(expect)))
	problems.push(`shards ran with a different count than the expected ${expect}`)
if (expect !== undefined && reports.length !== Number(expect))
	problems.push(`expected ${expect} shard reports, found ${reports.length}`)
if (problems.length) {
	for (const p of problems) console.error(`coverage: ${p}`)
	process.exit(1)
}
console.log(`coverage ok: ${registry.length} screens covered exactly once by ${reports.length} shards`)
