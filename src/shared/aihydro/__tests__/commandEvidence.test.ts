import { expect } from "chai"
import { describeExit, execOutcomeFor, execOutcomeForExit } from "../commandEvidence"

describe("commandEvidence (W2-0h: exit codes)", () => {
	it("zero completes, non-zero fails, unobserved is unknown and never success", () => {
		expect(execOutcomeForExit(0)).to.equal("completed")
		expect(execOutcomeForExit(1)).to.equal("failed")
		expect(execOutcomeForExit(124)).to.equal("failed")
		expect(execOutcomeForExit(-1)).to.equal("failed")
		expect(execOutcomeForExit("unknown")).to.equal("unknown")
		expect(execOutcomeForExit(undefined)).to.equal("unknown")
	})

	it("a command row is judged by its exit code; other calls are completed unless the result was an error", () => {
		expect(execOutcomeFor({ type: "say", say: "command", exitCode: 2 }, false)).to.equal("failed")
		expect(execOutcomeFor({ type: "ask", ask: "command", exitCode: 0 }, false)).to.equal("completed")
		expect(execOutcomeFor({ type: "ask", ask: "command", exitCode: "unknown" }, false)).to.equal("unknown")
		// no exit recorded at all (detached, cancelled, standalone host): still not success
		expect(execOutcomeFor({ type: "say", say: "command" }, false)).to.equal("unknown")
		expect(execOutcomeFor({ type: "say", say: "command", exitCode: 0 }, true)).to.equal("failed")
		expect(execOutcomeFor({ type: "say", say: "tool" }, false)).to.equal("completed")
		expect(execOutcomeFor({ type: "ask", ask: "use_mcp_server" }, true)).to.equal("failed")
	})

	it("states the exit code to the model, or that it is unavailable", () => {
		expect(describeExit(0)).to.equal("exit code 0")
		expect(describeExit(3)).to.equal("exit code 3")
		expect(describeExit("unknown")).to.equal("exit code unavailable")
		expect(describeExit(undefined)).to.equal("exit code unavailable")
	})
})
