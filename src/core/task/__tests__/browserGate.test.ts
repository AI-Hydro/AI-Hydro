import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { expect } from "chai"
import { describe, it } from "mocha"
import { BROWSER_TOOL_OFF_MESSAGE, browserToolRefusal } from "../browserGate"

describe("browser tool gate (X0-5)", () => {
	it("refuses browser_action under the shipped default settings", () => {
		expect(browserToolRefusal("browser_action", DEFAULT_BROWSER_SETTINGS)).to.equal(BROWSER_TOOL_OFF_MESSAGE)
	})

	it("refuses browser_action when the user has the tool disabled", () => {
		expect(browserToolRefusal("browser_action", { ...DEFAULT_BROWSER_SETTINGS, disableToolUse: true })).to.be.a("string")
	})

	it("allows browser_action once the user has turned the tool on", () => {
		expect(browserToolRefusal("browser_action", { ...DEFAULT_BROWSER_SETTINGS, disableToolUse: false })).to.equal(undefined)
	})

	it("never touches any other tool, whatever the setting", () => {
		for (const tool of ["read_file", "use_mcp_tool", "execute_command", undefined]) {
			expect(browserToolRefusal(tool, { ...DEFAULT_BROWSER_SETTINGS, disableToolUse: true }), String(tool)).to.equal(
				undefined,
			)
		}
	})

	it("ships with the browser off", () => {
		expect(DEFAULT_BROWSER_SETTINGS.disableToolUse).to.equal(true)
	})
})
