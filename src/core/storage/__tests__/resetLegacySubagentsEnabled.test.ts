import { expect } from "chai"
import { describe, it } from "mocha"
import type * as vscode from "vscode"
import { resetLegacySubagentsEnabled } from "../state-migrations"

function makeContext(initial: Record<string, unknown>, failUpdate = false) {
	const state = new Map<string, unknown>(Object.entries(initial))
	const context = {
		globalState: {
			get: (key: string) => state.get(key),
			update: async (key: string, value: unknown) => {
				if (failUpdate) {
					throw new Error("disk full")
				}
				state.set(key, value)
			},
		},
	} as unknown as vscode.ExtensionContext
	return { context, state }
}

describe("resetLegacySubagentsEnabled", () => {
	it("a stored true from the CLI era is reset to off, once", async () => {
		const { context, state } = makeContext({ subagentsEnabled: true })
		await resetLegacySubagentsEnabled(context)
		expect(state.get("subagentsEnabled")).to.equal(false)
		expect(state.get("migrations.subagentsEnabledReset.v1")).to.equal(true)
	})

	it("a choice made after the reset is kept on the next start", async () => {
		const { context, state } = makeContext({ subagentsEnabled: true })
		await resetLegacySubagentsEnabled(context)
		state.set("subagentsEnabled", true) // the user turns explorers on
		await resetLegacySubagentsEnabled(context)
		expect(state.get("subagentsEnabled")).to.equal(true)
	})

	it("absent or false stays as it is and the marker is set", async () => {
		for (const initial of [{}, { subagentsEnabled: false }]) {
			const { context, state } = makeContext(initial)
			await resetLegacySubagentsEnabled(context)
			expect(state.get("subagentsEnabled") ?? false).to.equal(false)
			expect(state.get("migrations.subagentsEnabledReset.v1")).to.equal(true)
		}
	})

	it("a failed write leaves the marker unset so the next start retries, and does not throw", async () => {
		const { context, state } = makeContext({ subagentsEnabled: true }, true)
		await resetLegacySubagentsEnabled(context)
		expect(state.get("migrations.subagentsEnabledReset.v1")).to.equal(undefined)
	})
})
