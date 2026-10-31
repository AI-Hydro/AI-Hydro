import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"
import type * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { resetLegacySubagentsEnabled } from "../state-migrations"
import { readGlobalStateFromDisk } from "../utils/state-helpers"

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

	it("the first read of global state after the migration sees false (what StateManager caches)", async () => {
		HostProvider.reset()
		HostProvider.initialize(
			(() => {}) as any,
			(() => {}) as any,
			{ workspaceClient: { getWorkspacePaths: async () => ({ paths: [] }) } } as any,
			() => {},
			async () => "",
			async () => "",
			"/mock/extension",
			path.join(os.tmpdir(), "aihydro-reset-storage"),
		)
		const state = new Map<string, unknown>([["subagentsEnabled", true]])
		const context = {
			globalState: {
				get: (key: string) => state.get(key),
				update: async (k: string, v: unknown) => void state.set(k, v),
				keys: () => [...state.keys()],
			},
			workspaceState: { get: () => undefined, update: async () => {}, keys: () => [] },
			secrets: { get: async () => undefined },
			globalStorageUri: { fsPath: "/tmp" },
		} as unknown as vscode.ExtensionContext
		expect((await readGlobalStateFromDisk(context)).subagentsEnabled).to.equal(true) // the stale value, before
		await resetLegacySubagentsEnabled(context)
		expect((await readGlobalStateFromDisk(context)).subagentsEnabled).to.equal(false)
		HostProvider.reset()
	})

	it("common.ts runs the reset before StateManager.initialize (a cache filled first would keep the stale true)", () => {
		const source = fs.readFileSync(path.resolve(__dirname, "../../../common.ts"), "utf8")
		const reset = source.indexOf("await resetLegacySubagentsEnabled(context)")
		const init = source.indexOf("await StateManager.initialize(context)")
		expect(reset).to.be.greaterThan(-1)
		expect(init).to.be.greaterThan(-1)
		expect(reset).to.be.lessThan(init)
	})
})
