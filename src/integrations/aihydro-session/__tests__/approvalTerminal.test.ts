import { expect } from "chai"
import { describe, it } from "mocha"
import { APPROVAL_TERMINAL_CLEARED_ENV, openApprovalTerminal } from "../approvalTerminal"

describe("openApprovalTerminal agent-context hygiene (T27)", () => {
	function capture() {
		const created: { name: string; env?: Record<string, string | null | undefined> }[] = []
		const sent: [string, boolean | undefined][] = []
		const host = {
			createTerminal: (options: { name: string; env?: Record<string, string | null | undefined> }) => {
				created.push(options)
				return { show: () => {}, sendText: (t: string, n?: boolean) => sent.push([t, n]) }
			},
		}
		return { created, sent, host }
	}

	it("T27 creates a terminal that never sets the agent marker and explicitly clears it", () => {
		const { created, host } = capture()
		expect(openApprovalTerminal("aihydro-approve s c", host)).to.equal(true)
		expect(created).to.have.length(1)
		const env = created[0].env ?? {}
		// Never set (a truthy value would make the CLI refuse the human)...
		for (const key of ["AIHYDRO_AGENT_CONTEXT", "AIHYDRO_ACTIVE", "AIHYDRO_PROFILE"]) {
			expect(env[key], key).to.not.be.a("string")
			// ...and explicitly cleared: null is how TerminalOptions.env removes a variable.
			expect(Object.prototype.hasOwnProperty.call(env, key) && env[key] === null, key).to.equal(true)
		}
	})

	it("still types the command without a newline", () => {
		const { sent, host } = capture()
		openApprovalTerminal("aihydro-approve s c", host)
		expect(sent).to.deep.equal([["aihydro-approve s c", false]])
	})

	it("the cleared set is frozen so nothing can add a marker to it", () => {
		expect(Object.isFrozen(APPROVAL_TERMINAL_CLEARED_ENV)).to.equal(true)
		expect(Object.values(APPROVAL_TERMINAL_CLEARED_ENV).every((v) => v === null)).to.equal(true)
	})
})
