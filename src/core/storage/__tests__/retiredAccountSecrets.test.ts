import { expect } from "chai"
import { describe, it } from "mocha"
import type * as vscode from "vscode"
import { removeRetiredAccountSecrets } from "../state-migrations"

/** A tiny in-memory ExtensionContext: only the secret store and global state the migration touches. */
function makeContext(initialSecrets: Record<string, string>, failDelete = false) {
	const secrets = new Map(Object.entries(initialSecrets))
	const globalState = new Map<string, unknown>()
	const deleted: string[] = []
	const context = {
		secrets: {
			get: async (key: string) => secrets.get(key),
			delete: async (key: string) => {
				if (failDelete) {
					throw new Error("keychain locked")
				}
				deleted.push(key)
				secrets.delete(key)
			},
		},
		globalState: {
			get: (key: string) => globalState.get(key),
			update: async (key: string, value: unknown) => {
				globalState.set(key, value)
			},
		},
	} as unknown as vscode.ExtensionContext
	return { context, secrets, globalState, deleted }
}

describe("removeRetiredAccountSecrets (X0-6)", () => {
	const STALE = { clineAccountId: "refresh-token", "cline:clineAccountId": '{"idToken":"x"}' }
	const PROVIDER_KEYS = {
		openRouterApiKey: "or-key",
		apiKey: "anthropic-key",
		deepSeekApiKey: "ds-key",
		openAiApiKey: "oa-key",
	}

	it("deletes exactly the two retired account secrets and no provider key", async () => {
		const { context, secrets, deleted } = makeContext({ ...STALE, ...PROVIDER_KEYS })
		await removeRetiredAccountSecrets(context)
		expect(deleted.sort()).to.deep.equal(["cline:clineAccountId", "clineAccountId"])
		for (const [key, value] of Object.entries(PROVIDER_KEYS)) {
			expect(secrets.get(key), key).to.equal(value)
		}
		expect(secrets.has("clineAccountId")).to.equal(false)
		expect(secrets.has("cline:clineAccountId")).to.equal(false)
	})

	it("is idempotent across two activations: the second run touches nothing", async () => {
		const { context, deleted, globalState } = makeContext({ ...STALE, ...PROVIDER_KEYS })
		await removeRetiredAccountSecrets(context)
		const afterFirst = deleted.length
		await removeRetiredAccountSecrets(context)
		expect(deleted.length).to.equal(afterFirst)
		expect(globalState.get("migrations.retiredAccountSecrets.v1")).to.equal(true)
	})

	it("does nothing harmful when there is nothing to delete", async () => {
		const { context, secrets } = makeContext(PROVIDER_KEYS)
		await removeRetiredAccountSecrets(context)
		expect(secrets.size).to.equal(Object.keys(PROVIDER_KEYS).length)
	})

	it("a failing delete does not throw and leaves the marker unset so the next start retries", async () => {
		const { context, globalState } = makeContext({ ...STALE, ...PROVIDER_KEYS }, true)
		await removeRetiredAccountSecrets(context)
		expect(globalState.has("migrations.retiredAccountSecrets.v1")).to.equal(false)
	})
})
