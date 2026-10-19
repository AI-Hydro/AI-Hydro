import { readFileSync } from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

// A cloned repository ships .vscode/settings.json. Settings that choose which
// interpreter runs, or whether Python runs at all, must not be settable there.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "..", "..", "..", "package.json"), "utf8")) as {
	contributes: { configuration: { properties: Record<string, { scope?: string }> } }
}

describe("Studio kernel settings scope", () => {
	for (const key of [
		"aihydro.htmlPreview.pythonInterpreter",
		"aihydro.htmlPreview.pythonExecution",
		"aihydro.htmlPreview.pythonTimeoutSeconds",
		"aihydro.htmlPreview.shareKernelAcrossArtifacts",
	]) {
		it(`${key} is machine scope, so workspace (repository) settings cannot change it`, () => {
			expect(pkg.contributes.configuration.properties[key]?.scope).to.equal("machine")
		})
	}
})
