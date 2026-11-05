import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

/**
 * Stage 2: the runtime is no longer explorer-shaped. The one place that says "explorer" in quotes is the definition
 * data (agentDefinition.ts); everything else asks the registry for a definition and reads its fields. This keeps the next
 * hard-coded id out by failing the build, not by review.
 */
const SRC = path.resolve(__dirname, "../../../..")
const WEBVIEW = path.resolve(SRC, "../webview-ui/src")
const ALLOWED = new Set(["core/task/subagents/agentDefinition.ts"])
const LITERAL = /["'`]explorer["'`]/

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "generated" || entry.name === "dist") {
			continue
		}
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			walk(full, out)
		} else if (/\.(ts|tsx)$/.test(entry.name)) {
			out.push(full)
		}
	}
	return out
}

/** Test code and recorded screen fixtures are data about the explorer, not code that decides on it. */
function isTestOrFixture(file: string): boolean {
	// Separators are normalised: on Windows the path has backslashes and a "/fixtures/" pattern would never match.
	// The screen fixtures (webview-ui/src/screens/fixtures) are deliberate: they are recorded transcripts that say
	// "explorer" as data, the way the tests do, and they decide nothing.
	return /__tests__|\.test\.tsx?$|\/fixtures\/|\/test\/|subagentHarness/.test(file.split(path.sep).join("/"))
}

describe("no hard-coded agent id", () => {
	it('"explorer" in quotes appears only in the definition data', () => {
		const offenders: string[] = []
		for (const root of [SRC, WEBVIEW]) {
			for (const file of walk(root)) {
				const rel = path.relative(SRC, file).split(path.sep).join("/")
				if (isTestOrFixture(file) || ALLOWED.has(rel)) {
					continue
				}
				const text = fs.readFileSync(file, "utf8")
				text.split("\n").forEach((line, index) => {
					if (LITERAL.test(line)) {
						offenders.push(`${rel}:${index + 1}: ${line.trim().slice(0, 120)}`)
					}
				})
			}
		}
		expect(offenders, offenders.join("\n")).to.deep.equal([])
	})

	it("the definition file still holds it (the check is looking at the right thing)", () => {
		const text = fs.readFileSync(path.join(SRC, "core/task/subagents/agentDefinition.ts"), "utf8")
		expect(text).to.match(LITERAL)
	})
})
