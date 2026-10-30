import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import { SIDEBAR_VIEWS } from "../../../core/controller/ui/sidebarView"

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../package.json"), "utf8"))

/** The view-title buttons that open a sidebar sub-view show as toggled while that view is open (Nav-3). */
describe("sidebar view buttons are toggled by aihydro.sidebarView", () => {
	const expected: Record<string, string> = {
		"aihydro.historyButtonClicked": "history",
		"aihydro.settingsButtonClicked": "settings",
		"aihydro.mcpButtonClicked": "mcp",
		"aihydro.connectorsButtonClicked": "connectors",
		"aihydro.skillsButtonClicked": "skills",
	}
	for (const [command, view] of Object.entries(expected)) {
		it(`${command} toggles on ${view}`, () => {
			const entry = pkg.contributes.commands.find((c: { command: string }) => c.command === command)
			expect(entry, command).to.not.equal(undefined)
			expect(entry.toggled).to.equal(`aihydro.sidebarView == ${view}`)
			expect(SIDEBAR_VIEWS as readonly string[]).to.include(view)
		})
	}
})
