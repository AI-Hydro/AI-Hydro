import * as assert from "node:assert"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "mocha"

interface MenuEntry {
	command?: string
	submenu?: string
	group?: string
	when?: string
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"))
const menus: Record<string, MenuEntry[]> = pkg.contributes.menus
const sidebar = menus["view/title"].filter((m) => (m.when ?? "").includes("aihydro.SidebarProvider"))

describe("sidebar view/title consolidation (chat audit C7)", () => {
	it("shows at most 4 inline (navigation) entries", () => {
		const inline = sidebar.filter((m) => (m.group ?? "").startsWith("navigation"))
		assert.ok(inline.length <= 4, `expected at most 4 inline entries, found ${inline.length}`)
		const inlineCommands = inline.filter((m) => m.command).map((m) => m.command)
		assert.deepStrictEqual(inlineCommands, [
			"aihydro.plusButtonClicked",
			"aihydro.mapButtonClicked",
			"aihydro.historyButtonClicked",
		])
	})

	it("declares the Science views submenu and every submenu is defined", () => {
		const submenus: Array<{ id: string }> = pkg.contributes.submenus
		for (const entry of sidebar.filter((m) => m.submenu)) {
			assert.ok(
				submenus.some((s) => s.id === entry.submenu),
				`submenu ${entry.submenu} is not declared`,
			)
			assert.ok(menus[entry.submenu as string]?.length, `submenu ${entry.submenu} has no entries`)
		}
	})

	it("keeps all 11 original commands reachable, with unchanged ids and titles", () => {
		const reachable = new Set<string>()
		for (const entry of sidebar) {
			if (entry.command) {
				reachable.add(entry.command)
			}
			if (entry.submenu) {
				for (const sub of menus[entry.submenu] ?? []) {
					if (sub.command) {
						reachable.add(sub.command)
					}
				}
			}
		}
		const expected = [
			"aihydro.plusButtonClicked",
			"aihydro.mcpButtonClicked",
			"aihydro.mapButtonClicked",
			"aihydro.htmlPreviewButtonClicked",
			"aihydro.historyButtonClicked",
			"aihydro.connectorsButtonClicked",
			"aihydro.skillsButtonClicked",
			"aihydro.experimentTableButtonClicked",
			"aihydro.sessionReplayButtonClicked",
			"aihydro.evidenceBoardButtonClicked",
			"aihydro.settingsButtonClicked",
		]
		assert.deepStrictEqual([...reachable].sort(), [...expected].sort())
		const declared = new Set<string>(pkg.contributes.commands.map((c: { command: string }) => c.command))
		for (const id of expected) {
			assert.ok(declared.has(id), `${id} must stay a declared command`)
		}
	})

	it("puts the science views in the submenu", () => {
		const sub = (menus["aihydro.scienceViews"] ?? []).map((m) => m.command)
		assert.deepStrictEqual(sub, [
			"aihydro.evidenceBoardButtonClicked",
			"aihydro.experimentTableButtonClicked",
			"aihydro.sessionReplayButtonClicked",
			"aihydro.htmlPreviewButtonClicked",
		])
	})
})
