#!/usr/bin/env node
/**
 * Fails if any count in the checker budget is higher than on the base branch.
 *
 *   node scripts/ui-screens/check-budget-monotonic.mjs --base origin/main
 *   node scripts/ui-screens/check-budget-monotonic.mjs --base-file old.json [--file new.json]
 *
 * The budget may only shrink. Entries that do not exist on the base (new screens, new subsets) pass, and a budget
 * file that does not exist on the base at all (first introduction) passes. `cells` is a matrix size, not a count,
 * so it is not compared.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const args = process.argv.slice(2)
const opt = (name) => {
	const i = args.indexOf(`--${name}`)
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined
}
const REL = "webview-ui/screens-baseline/checker-budget.json"
const file = resolve(opt("file") ?? REL)
const baseRef = opt("base")
const baseFile = opt("base-file")
if (!baseRef && !baseFile) {
	console.error("usage: check-budget-monotonic.mjs (--base <git ref> | --base-file <json>) [--file <json>]")
	process.exit(2)
}

let baseText = null
if (baseFile) baseText = readFileSync(resolve(baseFile), "utf8")
else {
	try {
		baseText = execFileSync("git", ["show", `${baseRef}:${REL}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
	} catch (e) {
		const msg = String(e.stderr ?? e.message ?? e)
		// Only "path does not exist in that ref" counts as a missing base file; an unknown ref is a real error.
		if (/exists on disk, but not in|does not exist in|path .* does not exist/i.test(msg)) {
			console.log(`budget monotonic: ${REL} is absent on ${baseRef}; nothing to compare, pass`)
			process.exit(0)
		}
		console.error(`budget monotonic: cannot read ${baseRef}:${REL}\n${msg}`)
		process.exit(2)
	}
}

const leaves = (node, path = "", out = new Map()) => {
	if (typeof node === "number") out.set(path, node)
	else if (node && typeof node === "object")
		for (const [k, v] of Object.entries(node)) if (k !== "cells") leaves(v, path ? `${path}.${k}` : k, out)
	return out
}
const section = (json) => leaves({ screens: json.screens ?? {}, subsets: json.subsets ?? {} })

const base = section(JSON.parse(baseText))
const head = section(JSON.parse(readFileSync(file, "utf8")))
const raised = []
for (const [path, value] of head) {
	const was = base.get(path)
	if (was !== undefined && value > was) raised.push(`${path}: ${was} -> ${value}`)
}
if (raised.length) {
	console.error(`budget monotonic: ${raised.length} count(s) higher than the base (the budget may only shrink):`)
	for (const r of raised.slice(0, 50)) console.error(`  ${r}`)
	process.exit(1)
}
console.log(`budget monotonic: ${head.size} counts checked against ${base.size} on the base, none raised`)
