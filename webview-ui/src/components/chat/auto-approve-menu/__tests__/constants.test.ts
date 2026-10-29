import { describe, expect, it } from "vitest"
import { ACTION_METADATA, NOTIFICATIONS_SETTING } from "../constants"

const flat = [...ACTION_METADATA.flatMap((a) => (a.subAction ? [a, a.subAction] : [a])), NOTIFICATIONS_SETTING]

describe("auto-run menu copy (X0-4b)", () => {
	it("does not use the retired coding-assistant wording", () => {
		const banned = [/auto-approve/i, /use the browser/i, /execute all commands/i]
		for (const action of flat) {
			for (const text of [action.label, action.shortName, action.description]) {
				for (const re of banned) {
					expect(text, `${action.id}: ${text}`).not.toMatch(re)
				}
			}
		}
	})

	it("keeps every policy action id, including both danger sub-actions", () => {
		expect(flat.map((a) => a.id)).toEqual([
			"enableAutoApprove",
			"enableAll",
			"readFiles",
			"readFilesExternally",
			"editFiles",
			"editFilesExternally",
			"executeSafeCommands",
			"executeAllCommands",
			"useBrowser",
			"useMcp",
			"enableNotifications",
		])
	})
})
