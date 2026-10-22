import { expect } from "chai"
import { describe, it } from "mocha"
import { acceptAskResponse } from "../askResponseBinding"
import { TaskState } from "../TaskState"

/** Mirrors what Task.ask does when it posts an ask: clears the previous response and records the ask ts. */
function postAsk(state: TaskState, ts: number) {
	state.askResponse = undefined
	state.askResponseText = undefined
	state.askResponseImages = undefined
	state.askResponseFiles = undefined
	state.lastMessageTs = ts
}

describe("acceptAskResponse (W2-E1 M-1: response bound to the ask ts)", () => {
	it("accepts a response whose ts matches the pending ask", () => {
		const state = new TaskState()
		postAsk(state, 100)
		expect(acceptAskResponse(state, { response: "yesButtonClicked", text: "go", askTs: 100 })).to.deep.equal({ stale: false })
		expect(state.askResponse).to.equal("yesButtonClicked")
		expect(state.askResponseText).to.equal("go")
	})

	it("ignores a mismatched ts and the ask stays pending", () => {
		const state = new TaskState()
		postAsk(state, 100)
		expect(acceptAskResponse(state, { response: "yesButtonClicked", askTs: 99 })).to.deep.equal({ stale: true })
		expect(state.askResponse).to.equal(undefined)
		expect(state.lastMessageTs).to.equal(100)
		// The genuine answer still works afterwards.
		expect(acceptAskResponse(state, { response: "noButtonClicked", askTs: 100 })).to.deep.equal({ stale: false })
		expect(state.askResponse).to.equal("noButtonClicked")
	})

	it("treats ts 0 and undefined as the legacy/internal path and accepts them", () => {
		for (const askTs of [0, undefined]) {
			const state = new TaskState()
			postAsk(state, 100)
			expect(acceptAskResponse(state, { response: "yesButtonClicked", askTs })).to.deep.equal({ stale: false })
			expect(state.askResponse).to.equal("yesButtonClicked")
		}
	})

	it("drops a bound response when no ask is pending", () => {
		const state = new TaskState()
		expect(acceptAskResponse(state, { response: "yesButtonClicked", askTs: 5 })).to.deep.equal({ stale: true })
		expect(state.askResponse).to.equal(undefined)
	})

	it("race: an ask superseded after the click was generated does not answer the new ask", () => {
		const state = new TaskState()
		postAsk(state, 100) // command A is pending; the webview generates "Run" bound to 100
		const click = { response: "yesButtonClicked" as const, askTs: 100 }
		postAsk(state, 200) // before the click arrives the agent posts a different ask B
		expect(acceptAskResponse(state, click)).to.deep.equal({ stale: true })
		expect(state.askResponse, "B must still be waiting for its own answer").to.equal(undefined)
		expect(acceptAskResponse(state, { response: "yesButtonClicked", askTs: 200 })).to.deep.equal({ stale: false })
		expect(state.askResponse).to.equal("yesButtonClicked")
	})

	it("race: a say that moves lastMessageTs also supersedes the ask", () => {
		const state = new TaskState()
		postAsk(state, 100)
		state.lastMessageTs = 150 // Task.say moved it; Task.ask treats the ask as ignored
		expect(acceptAskResponse(state, { response: "yesButtonClicked", askTs: 100 })).to.deep.equal({ stale: true })
		expect(state.askResponse).to.equal(undefined)
	})
})
