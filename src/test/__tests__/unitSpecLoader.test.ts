import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

// Unit specs must load through one loader (ts-node, CommonJS). Native ESM loading (Node >= 22.18 type
// stripping) is disabled in .mocharc.json, and `import.meta` is a TS1343 compile error under that loader.
const SRC_ROOT = path.resolve(__dirname, "..", "..")

function collectUnitSpecs(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") {
			continue
		}
		const full = path.join(dir, entry)
		if (statSync(full).isDirectory()) {
			collectUnitSpecs(full, out)
		} else if (entry.endsWith(".ts") && path.basename(path.dirname(full)) === "__tests__") {
			out.push(full)
		}
	}
	return out
}

describe("unit spec loader contract", () => {
	it("no unit spec uses import.meta", () => {
		const specs = collectUnitSpecs(SRC_ROOT)
		expect(specs.length).to.be.greaterThan(10)
		const offenders = specs
			.filter((file) => file !== __filename)
			.filter((file) => /\bimport\.meta\b/.test(readFileSync(file, "utf8")))
			.map((file) => path.relative(SRC_ROOT, file))
		expect(offenders, "specs using import.meta break under ts-node CommonJS (TS1343)").to.deep.equal([])
	})

	it("mocha is configured to disable native TypeScript stripping", () => {
		const rc = JSON.parse(readFileSync(path.resolve(SRC_ROOT, "..", ".mocharc.json"), "utf8"))
		expect(rc["node-option"]).to.include("no-experimental-strip-types")
	})
})
