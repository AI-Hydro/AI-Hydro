import { describe, expect, it } from "vitest"
import { isChatRunning, nothingHasFocus } from "./chatRunning"

describe("isChatRunning", () => {
	it("is false with no messages, after the answer, and for a resume offer", () => {
		expect(isChatRunning([])).toBe(false)
		expect(isChatRunning([{ say: "task" }, { say: "completion_result" }])).toBe(false)
		expect(isChatRunning([{ say: "task" }, { ask: "completion_result" }])).toBe(false)
		expect(isChatRunning([{ say: "task" }, { ask: "resume_task" }])).toBe(false)
	})
	it("is true while streaming, running a tool, or waiting on an approval", () => {
		expect(isChatRunning([{ say: "task" }, { say: "api_req_started" }])).toBe(true)
		expect(isChatRunning([{ say: "task" }, { ask: "use_mcp_server" }])).toBe(true)
	})
})

describe("nothingHasFocus", () => {
	it("is true on the body and false when a control has focus", () => {
		document.body.innerHTML = '<button id="b">x</button>'
		expect(nothingHasFocus()).toBe(true)
		document.getElementById("b")?.focus()
		expect(nothingHasFocus()).toBe(false)
		document.body.innerHTML = ""
	})
})
