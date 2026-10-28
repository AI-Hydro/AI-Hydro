import { expect } from "chai"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "mocha"

/**
 * X0-2: the extension asks the server (resources and tools) which study a chat is bound to and which studies exist.
 * It does not read the server's files. This keeps that true for the whole session-integration folder.
 */
describe("aihydro-session reads nothing from the AI-Hydro home", () => {
	const dir = path.resolve(__dirname, "..")
	const sources = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".ts"))
		.map((f) => ({ f, text: fs.readFileSync(path.join(dir, f), "utf8") }))

	it("has no filesystem import, no AI-Hydro home helper and no .aihydro path", () => {
		const offenders: string[] = []
		for (const { f, text } of sources) {
			if (/from\s+["'](?:node:)?fs(?:\/promises)?["']/.test(text)) offenders.push(`${f}: fs import`)
			if (/aihydroHome|aihydroPath/.test(text)) offenders.push(`${f}: home helper`)
			if (/["'`]\.aihydro["'`/]|~\/\.aihydro/.test(text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) {
				offenders.push(`${f}: .aihydro path`)
			}
		}
		expect(offenders).to.deep.equal([])
	})

	it("scanned the expected files", () => {
		expect(sources.map((s) => s.f)).to.include.members(["studyBinding.ts", "sessionSurfaces.ts", "researchSnapshot.ts"])
	})
})
