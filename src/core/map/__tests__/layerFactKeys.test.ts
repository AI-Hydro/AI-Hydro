import { LAYER_FACT_KEYS } from "@shared/map/provenanceEnvelope"
import { expect } from "chai"
import * as fs from "fs"
import { describe, it } from "mocha"
import * as path from "path"

describe("layer fact keys", () => {
	it("are the list in the fixture shared with aihydro-tools, in the same order", () => {
		const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "layer_fact_keys.json"), "utf8"))
		expect([...LAYER_FACT_KEYS]).to.deep.equal(fixture.layer_fact_keys)
	})

	it("match the tools source when it is on disk (set AIHYDRO_TOOLS_ENFORCEMENT_PY to its enforcement.py)", function () {
		const py = process.env.AIHYDRO_TOOLS_ENFORCEMENT_PY
		if (!py || !fs.existsSync(py)) return this.skip()
		const m = /LAYER_FACT_KEYS\s*=\s*frozenset\(\{([^}]*)\}\)/.exec(fs.readFileSync(py, "utf8"))
		expect(m, "LAYER_FACT_KEYS not found in enforcement.py").to.not.equal(null)
		const names = [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1])
		expect([...names].sort()).to.deep.equal([...LAYER_FACT_KEYS].sort())
	})
})
