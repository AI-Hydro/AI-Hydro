import { expect } from "chai"
import { describe, it } from "mocha"
import type * as vscode from "vscode"
import { removeRetiredRuleDialectState } from "../state-migrations"

function makeContext(initial: Record<string, unknown>) {
	const workspaceState = new Map<string, unknown>(Object.entries(initial))
	const context = {
		workspaceState: {
			get: (key: string) => workspaceState.get(key),
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					workspaceState.delete(key)
				} else {
					workspaceState.set(key, value)
				}
			},
		},
	} as unknown as vscode.ExtensionContext
	return { context, workspaceState }
}

describe("removeRetiredRuleDialectState (X0-6b)", () => {
	it("clears the Cursor and Windsurf toggles and keeps the AI-Hydro and workflow toggles", async () => {
		const { context, workspaceState } = makeContext({
			localCursorRulesToggles: { "/w/.cursorrules": true },
			localWindsurfRulesToggles: { "/w/.windsurfrules": false },
			localAiHydroRulesToggles: { "/w/.aihydrorules": true },
			workflowToggles: { "/w/.aihydrorules/workflows/a.md": true },
		})
		await removeRetiredRuleDialectState(context)
		expect(workspaceState.has("localCursorRulesToggles")).to.equal(false)
		expect(workspaceState.has("localWindsurfRulesToggles")).to.equal(false)
		expect(workspaceState.get("localAiHydroRulesToggles")).to.deep.equal({ "/w/.aihydrorules": true })
		expect(workspaceState.get("workflowToggles")).to.deep.equal({ "/w/.aihydrorules/workflows/a.md": true })
	})

	it("is idempotent across two activations", async () => {
		const { context, workspaceState } = makeContext({ localCursorRulesToggles: { a: true } })
		await removeRetiredRuleDialectState(context)
		await removeRetiredRuleDialectState(context)
		expect([...workspaceState.keys()]).to.deep.equal([])
	})
})
