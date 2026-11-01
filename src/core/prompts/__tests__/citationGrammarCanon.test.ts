import { expect } from "chai"
import * as fs from "fs"
import * as path from "path"

/**
 * The citation grammar the model is taught lives server-side (aihydro-tools "Citation Grammar", delivered as
 * trusted MCP instructions). The canonical run path is `key_outputs.<field>`; `data.<field>` is only an accepted
 * alias. Guard: no prompt text shipped by the extension may teach the alias form as the example.
 */
function walk(dir: string, out: string[] = []): string[] {
	for (const name of fs.readdirSync(dir)) {
		const p = path.join(dir, name)
		if (fs.statSync(p).isDirectory()) {
			if (name !== "__tests__") walk(p, out)
		} else if (/\.(ts|md|snap)$/.test(name)) {
			out.push(p)
		}
	}
	return out
}

describe("citation grammar canon", () => {
	it("the grammar reaches every user through the system prompt, with the #path the auditor requires", () => {
		const { SCIENTIFIC_CONDUCT_RULES } = require("../system-prompt/components/scientific_conduct")
		expect(SCIENTIFIC_CONDUCT_RULES).to.include("[run:<run_id>#key_outputs.<field>]")
		expect(SCIENTIFIC_CONDUCT_RULES).to.include("a marker without it cannot be checked")
	})

	it("the project-context frame names the full marker form, never a pathless [run:]", () => {
		const { formatProjectContextSection } = require("../../task/projectContextSection")
		const frame = formatProjectContextSection("x")
		expect(frame).to.include("[run:<run_id>#key_outputs.<field>]")
		expect(frame).to.not.include("[run:]")
	})

	it("no extension prompt text teaches [run:<id>#data.<field>] (canonical form is key_outputs.<field>)", () => {
		const promptsDir = path.resolve(__dirname, "..")
		const offenders = walk(promptsDir).filter((f) => /\[run:[^\]\n]*#(evidence\.)?data\./.test(fs.readFileSync(f, "utf8")))
		expect(offenders).to.deep.equal([])
	})
})
