import { AskResponseRequest } from "@shared/proto/cline/task"
import { expect } from "chai"
import { describe, it } from "mocha"
import { Task } from "@/core/task"
import { TaskState } from "@/core/task/TaskState"
import { askResponse } from "../askResponse"

/** W2-E1 (N6): the ask ts survives the controller RPC and Task.handleWebviewAskResponse reaches the binding check. */
describe("ask_ts forwarding", () => {
	it("controller askResponse passes request.askTs to the task and returns its stale verdict", async () => {
		const calls: unknown[][] = []
		const controller = {
			task: {
				handleWebviewAskResponse: async (...args: unknown[]) => {
					calls.push(args)
					return { stale: true }
				},
			},
		} as any
		const result = await askResponse(
			controller,
			AskResponseRequest.create({ responseType: "yesButtonClicked", text: "t", askTs: 4242 }),
		)
		expect(calls).to.have.length(1)
		expect(calls[0][0]).to.equal("yesButtonClicked")
		expect(calls[0][4]).to.equal(4242)
		expect(result.stale).to.equal(true)
	})

	it("controller askResponse with a bound request and no task reports stale; unbound does not", async () => {
		expect((await askResponse({ task: undefined } as any, AskResponseRequest.create({ askTs: 5 }))).stale).to.equal(true)
		expect((await askResponse({ task: undefined } as any, AskResponseRequest.create({}))).stale).to.equal(false)
	})

	it("Task.handleWebviewAskResponse drops a mismatched ts and records a matching one (through the real binding)", async () => {
		const taskState = new TaskState()
		taskState.lastMessageTs = 100
		const host = { taskState }
		const handle = Task.prototype.handleWebviewAskResponse

		expect(await handle.call(host, "yesButtonClicked", "x", [], [], 99)).to.deep.equal({ stale: true })
		expect(taskState.askResponse).to.equal(undefined)

		expect(await handle.call(host, "yesButtonClicked", "x", [], [], 100)).to.deep.equal({ stale: false })
		expect(taskState.askResponse).to.equal("yesButtonClicked")
		expect(taskState.askResponseText).to.equal("x")
	})

	it("Task.handleWebviewAskResponse treats a missing ts as the unbound internal path", async () => {
		const taskState = new TaskState()
		taskState.lastMessageTs = 100
		expect(await Task.prototype.handleWebviewAskResponse.call({ taskState }, "noButtonClicked")).to.deep.equal({
			stale: false,
		})
		expect(taskState.askResponse).to.equal("noButtonClicked")
	})
})
