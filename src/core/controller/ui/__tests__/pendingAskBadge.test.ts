import { AskResponseRequest } from "@shared/proto/cline/task"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { askResponse } from "../../task/askResponse"
import { clearPending, getPendingAsk, markPending, type PendingAskBadge, setPendingAskSink } from "../pendingAskBadge"

describe("pendingAskBadge (W2-E2)", () => {
	let seen: (PendingAskBadge | undefined)[]
	beforeEach(() => {
		clearPending()
		seen = []
		setPendingAskSink((p) => seen.push(p))
		seen.length = 0
	})
	afterEach(() => {
		clearPending()
		setPendingAskSink(undefined)
	})

	it("marks a badged ask and clears it on the response", async () => {
		markPending(100, "command")
		expect(getPendingAsk()?.ts).to.equal(100)
		expect(seen.at(-1)?.tooltip).to.be.a("string")
		const controller = {
			task: { taskState: { lastMessageTs: 100 }, handleWebviewAskResponse: async () => ({ stale: false }) },
		} as any
		await askResponse(controller, AskResponseRequest.create({ responseType: "yesButtonClicked", askTs: 100 }))
		expect(getPendingAsk()).to.equal(undefined)
		expect(seen.at(-1)).to.equal(undefined)
	})

	it("a stale response does not clear the badge of the ask that replaced it", async () => {
		markPending(200, "use_mcp_server")
		const controller = {
			task: { taskState: { lastMessageTs: 200 }, handleWebviewAskResponse: async () => ({ stale: true }) },
		} as any
		await askResponse(controller, AskResponseRequest.create({ responseType: "yesButtonClicked", askTs: 100 }))
		expect(getPendingAsk()?.ts).to.equal(200)
	})

	it("a stale clearPending(oldTs) is a no-op", () => {
		markPending(200, "tool")
		clearPending(100)
		expect(getPendingAsk()?.ts).to.equal(200)
		clearPending(200)
		expect(getPendingAsk()).to.equal(undefined)
	})

	it("a superseded ask clears only itself (the Task.ask finally block)", () => {
		markPending(100, "command")
		markPending(200, "command") // the replacing ask marks first or last; either order must end on 200
		clearPending(100)
		expect(getPendingAsk()?.ts).to.equal(200)
	})

	it("clearTask and abort clear unconditionally", () => {
		markPending(100, "followup")
		clearPending()
		expect(getPendingAsk()).to.equal(undefined)
		expect(seen.at(-1)).to.equal(undefined)
	})

	it("non-badged kinds never mark", () => {
		for (const ask of ["completion_result", "resume_task", "resume_completed_task", "command_output"] as const) {
			markPending(300, ask)
			expect(getPendingAsk()).to.equal(undefined)
		}
		expect(seen).to.deep.equal([])
	})

	it("a sink registered later is given what is pending (view re-resolved)", () => {
		markPending(100, "command")
		const late: (PendingAskBadge | undefined)[] = []
		setPendingAskSink((p) => late.push(p))
		expect(late[0]?.ts).to.equal(100)
	})

	it("a throwing sink does not break the ask", () => {
		setPendingAskSink(() => {
			throw new Error("view gone")
		})
		markPending(100, "command")
		expect(getPendingAsk()?.ts).to.equal(100)
	})
})
