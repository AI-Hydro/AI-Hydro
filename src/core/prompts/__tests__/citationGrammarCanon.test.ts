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
	it("no extension prompt text teaches [run:<id>#data.<field>] (canonical form is key_outputs.<field>)", () => {
		const promptsDir = path.resolve(__dirname, "..")
		const offenders = walk(promptsDir).filter((f) => /\[run:[^\]\n]*#(evidence\.)?data\./.test(fs.readFileSync(f, "utf8")))
		expect(offenders).to.deep.equal([])
	})
})
