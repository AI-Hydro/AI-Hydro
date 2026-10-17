import { describe, expect, it } from "vitest"
import { claimAgentCommand, escapeHtml } from "../agentCommandDedupe"

describe("claimAgentCommand", () => {
	it("accepts an event once and rejects its replay", () => {
		const seen = new Set<string>()
		const event = { type: "command.fly_to", timestampMs: 5, payloadJson: '{"longitude":1}' }
		expect(claimAgentCommand(seen, event)).toBe(true)
		expect(claimAgentCommand(seen, { ...event })).toBe(false)
		expect(claimAgentCommand(seen, { ...event, timestampMs: 6 })).toBe(true)
	})
})

describe("escapeHtml", () => {
	it("neutralises markup in layer names and properties", () => {
		expect(escapeHtml('<img src=x onerror="a()">')).not.toContain("<")
		expect(escapeHtml("a&b")).toBe("a&#38;b")
		expect(escapeHtml(undefined)).toBe("")
	})
})
