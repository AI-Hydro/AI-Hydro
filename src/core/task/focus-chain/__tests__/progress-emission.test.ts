import { expect } from "chai"
import sinon from "sinon"
import { FocusChainManager } from "../index"

function makeManager() {
	const say = sinon.stub().resolves(1)
	const taskState: any = { apiRequestsSinceLastTodoUpdate: 3, currentFocusChainChecklist: undefined }
	const manager: any = new FocusChainManager({
		taskId: "t1",
		taskState,
		mode: "act",
		stateManager: {} as any,
		postStateToWebview: async () => {},
		say,
		focusChainSettings: { enabled: true, remindAiHydroInterval: 6 } as any,
	})
	// Never touch the real task directory in unit tests.
	manager.writeFocusChainToDisk = sinon.stub().resolves()
	return { manager: manager as FocusChainManager, say, taskState }
}

describe("FocusChainManager task_progress emission", () => {
	it("emits a task_progress row only when the list content changes", async () => {
		const { manager, say, taskState } = makeManager()
		const a = "- [x] load\n- [ ] analyse"
		const b = "- [x] load\n- [x] analyse"

		await manager.updateFCListFromToolResponse(a)
		await manager.updateFCListFromToolResponse(a)
		await manager.updateFCListFromToolResponse(`${a}\n`) // whitespace-only difference
		expect(say.callCount).to.equal(1)

		await manager.updateFCListFromToolResponse(b)
		await manager.updateFCListFromToolResponse(b)
		expect(say.callCount).to.equal(2)
		expect(say.secondCall.args).to.deep.equal(["task_progress", b])

		// Going back to an earlier state is a change relative to the last row, so it is emitted.
		await manager.updateFCListFromToolResponse(a)
		expect(say.callCount).to.equal(3)
		// The reminder counter still resets for an unchanged list.
		expect(taskState.apiRequestsSinceLastTodoUpdate).to.equal(0)
	})
})
