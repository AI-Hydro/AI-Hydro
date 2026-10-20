import { expect } from "chai"
import type { AiHydroMessage } from "../../ExtensionMessage"
import { convertAiHydroMessageToProto, convertProtoToAiHydroMessage } from "../../proto-conversions/aihydro-message"

const roundTrip = (m: AiHydroMessage) => convertProtoToAiHydroMessage(convertAiHydroMessageToProto(m))

describe("host evidence survives the proto/partial path (W2-0h)", () => {
	it("info notices keep class, severity and detail", () => {
		const m: AiHydroMessage = {
			ts: 1,
			type: "say",
			say: "info",
			text: "Context window exceeded: dropped 4 earlier messages",
			infoNotice: { class: "context_truncated", severity: "warning", detail: { deletedRange: [2, 5], newlyDropped: 4 } },
		}
		expect(roundTrip(m).infoNotice).to.deep.equal(m.infoNotice)
		expect(roundTrip(m).text).to.equal(m.text)
	})

	it("mcp level, exit code (known, zero, unknown) and policy class round-trip", () => {
		expect(roundTrip({ ts: 1, type: "say", say: "mcp_notification", text: "x", mcpLevel: "error" }).mcpLevel).to.equal(
			"error",
		)
		const cmd = (exitCode?: number | "unknown"): AiHydroMessage => ({
			ts: 2,
			type: "say",
			say: "command",
			text: "false",
			exitCode,
			policyClass: "subagent_launch",
		})
		expect(roundTrip(cmd(2)).exitCode).to.equal(2)
		expect(roundTrip(cmd(0)).exitCode).to.equal(0)
		expect(roundTrip(cmd("unknown")).exitCode).to.equal("unknown")
		expect(roundTrip(cmd(undefined))).to.not.have.property("exitCode")
		expect(roundTrip(cmd(1)).policyClass).to.equal("subagent_launch")
	})

	it("an old row (plain string info, no evidence) gains no evidence fields", () => {
		const out = roundTrip({ ts: 3, type: "say", say: "info", text: "malformed tool call; retried" })
		expect(out).to.deep.equal({ ts: 3, type: "say", say: "info", text: "malformed tool call; retried" })
	})
})
