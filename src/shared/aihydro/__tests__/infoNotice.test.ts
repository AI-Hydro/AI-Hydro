import { expect } from "chai"
import { INFO_CLASS_SEVERITY, INFO_CLASSES, infoNoticeFor, isElevatedMcpLevel } from "../infoNotice"

describe("infoNotice (W2-0h)", () => {
	it("every class has a severity, and the helper agrees with the table", () => {
		for (const c of INFO_CLASSES) {
			expect(INFO_CLASS_SEVERITY[c], c).to.be.oneOf(["info", "warning"])
			expect(infoNoticeFor(c)).to.deep.equal({ class: c, severity: INFO_CLASS_SEVERITY[c] })
		}
	})

	it("repair is informational; every refusal or loss is a warning", () => {
		expect(infoNoticeFor("native_call_repaired").severity).to.equal("info")
		for (const c of ["context_truncated", "malformed_tool_call", "native_call_not_run", "unknown_tool"] as const) {
			expect(infoNoticeFor(c).severity, c).to.equal("warning")
		}
	})

	it("carries optional detail", () => {
		expect(infoNoticeFor("context_truncated", { newlyDropped: 4 }).detail).to.deep.equal({ newlyDropped: 4 })
		expect(infoNoticeFor("unknown_tool")).to.not.have.property("detail")
	})

	it("MCP levels: warning and above are elevated; debug/info and a missing level are not", () => {
		for (const l of ["warning", "error", "critical", "alert", "emergency"]) {
			expect(isElevatedMcpLevel(l), l).to.equal(true)
		}
		for (const l of ["debug", "info", "notice", undefined]) {
			expect(isElevatedMcpLevel(l), String(l)).to.equal(false)
		}
	})
})
