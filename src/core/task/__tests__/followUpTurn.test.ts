import { expect } from "chai"
import sinon from "sinon"
import { formatResponse } from "../../prompts/responses"
import { createGateState } from "../answerAuditGate"
import { FocusChainManager } from "../focus-chain"

// A2: a message the user sends after a finished answer is conversation, not a restarted task.
describe("follow-up turns are conversation (A2)", () => {
	describe("resume text", () => {
		const resume = (
			follow: boolean | undefined,
			mode: "act" | "plan" = "act",
			text: string | undefined = "whats the status?",
		) => formatResponse.taskResumption(mode, "13 hours ago", "/ws", false, text, false, follow)

		it("a finished task plus a message answers directly: no reassess, no retry, no new-instruction framing", () => {
			const [head, user] = resume(true)
			expect(head).to.include("new message after the task finished")
			expect(head).to.include("Answer it directly")
			expect(head).to.include("Do not repeat earlier results")
			expect(head).to.include("only if the answer needs new information")
			expect(head).to.not.match(/reassess|retry|interrupted/i)
			expect(user).to.include("whats the status?")
			expect(user).to.not.include("New instructions for task continuation")
		})

		it("an interrupted (not completed) task keeps the resumption text, and Plan mode is unchanged", () => {
			expect(resume(false)[0]).to.match(/reassess/)
			expect(resume(undefined)[0]).to.match(/retry the last step/)
			expect(resume(true, "plan")[0]).to.include("PLAN MODE")
		})

		it("without a user message the interrupted text is used (nothing to answer)", () => {
			expect(resume(true, "act", "")[0]).to.match(/reassess/)
		})
	})

	describe("to-do prompt", () => {
		function manager(over: Record<string, unknown>, mode = "act") {
			const taskState: any = {
				apiRequestCount: 1,
				apiRequestsSinceLastTodoUpdate: 0,
				currentFocusChainChecklist: undefined,
				...over,
			}
			return new FocusChainManager({
				taskId: "t1",
				taskState,
				mode,
				stateManager: { getGlobalSettingsKey: () => mode } as any,
				postStateToWebview: async () => {},
				say: sinon.stub().resolves(1),
				focusChainSettings: { enabled: true, remindAiHydroInterval: 6 } as any,
			} as any)
		}

		it("is added on a first request, and skipped when that request is a follow-up", () => {
			expect(manager({}).shouldIncludeFocusChainInstructions()).to.equal(true)
			expect(manager({ followUpTurn: true }).shouldIncludeFocusChainInstructions()).to.equal(false)
		})

		it("Plan mode keeps its optional list even on a follow-up", () => {
			expect(manager({ followUpTurn: true }, "plan").shouldIncludeFocusChainInstructions()).to.equal(true)
		})
	})

	describe("Task.acceptFollowUpAnswer", () => {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { Task } = require("../index")
		function build(state: Record<string, unknown>) {
			const executeTool = sinon.stub().resolves(true)
			const task = Object.create(Task.prototype)
			task.taskState = { followUpTurn: false, followUpHeldText: {}, answerAuditGate: createGateState(), ...state }
			task.toolExecutor = { executeTool }
			return { task, executeTool }
		}

		it("a text-only reply in a follow-up becomes the attempt_completion result, and the state stays on", async () => {
			const { task, executeTool } = build({
				followUpTurn: true,
				followUpHeldText: { 0: "Complete.", 1: "Two runs on record." },
			})
			expect(await task.acceptFollowUpAnswer()).to.equal(true)
			const block = executeTool.firstCall.args[0]
			expect(block).to.deep.include({ type: "tool_use", name: "attempt_completion", partial: false })
			expect(block.params.result).to.equal("Complete.\n\nTwo runs on record.")
			expect(task.taskState.followUpTurn).to.equal(true)
			expect(task.taskState.followUpHeldText).to.deep.equal({})
		})

		it("the reply runs with the in-flight mark (so its row is a reply, not a result) and the mark and progress line are cleared after", async () => {
			const seen: boolean[] = []
			const { task } = build({ followUpTurn: true, followUpHeldText: { 0: "Redoing now." }, followUpProgressShown: true })
			task.toolExecutor.executeTool = async () => {
				seen.push(task.taskState.followUpAnswerInFlight)
				return true
			}
			task.messageStateHandler = {
				getAiHydroMessages: () => [],
				setAiHydroMessages() {},
				saveAiHydroMessagesAndUpdateHistory: async () => {},
			}
			await task.acceptFollowUpAnswer()
			expect(seen).to.deep.equal([true])
			expect(task.taskState.followUpAnswerInFlight).to.equal(false)
			expect(task.taskState.followUpProgressShown).to.equal(false)
		})

		it("held text shows one activity line while it is pending", async () => {
			const say = sinon.stub().resolves(undefined)
			const task = Object.create(Task.prototype)
			task.say = say
			task.toolExecutor = { executeTool: sinon.stub().resolves(true) }
			task.taskState = {
				followUpTurn: true,
				followUpHeldText: {},
				followUpProgressShown: false,
				presentAssistantMessageLocked: false,
				currentStreamingContentIndex: 0,
				assistantMessageContent: [{ type: "text", content: "Re-running for 2005-2015.", partial: true }],
				didCompleteReadingStream: false,
			}
			await Task.prototype.presentAssistantMessage.call(task)
			task.taskState.presentAssistantMessageLocked = false
			await Task.prototype.presentAssistantMessage.call(task)
			expect(say.callCount).to.equal(1)
			expect(say.firstCall.args[0]).to.equal("answer_audit")
			expect(say.firstCall.args[4]).to.equal(true)
		})

		it("outside a follow-up (a running task) nothing is accepted, so the tool nudge still applies", async () => {
			const { task, executeTool } = build({ followUpTurn: false, followUpHeldText: { 0: "thinking out loud" } })
			expect(await task.acceptFollowUpAnswer()).to.equal(false)
			expect(executeTool.called).to.equal(false)
		})

		it("while a follow-up streams its text is held, not shown; a tool call flushes it first and ends the state", async () => {
			const say = sinon.stub().resolves(undefined)
			const executeTool = sinon.stub().resolves(true)
			const task = Object.create(Task.prototype)
			task.say = say
			task.toolExecutor = { executeTool }
			task.presentAssistantMessage = Task.prototype.presentAssistantMessage
			task.taskState = {
				followUpTurn: true,
				followUpHeldText: {},
				presentAssistantMessageLocked: false,
				currentStreamingContentIndex: 0,
				assistantMessageContent: [{ type: "text", content: "Checking the run log.", partial: false }],
				didCompleteReadingStream: false,
			}
			await Task.prototype.presentAssistantMessage.call(task)
			// Only the drafting activity line is shown; the text itself is held.
			expect(say.args.map((a: any[]) => a[0])).to.deep.equal(["answer_audit"])
			expect(task.taskState.followUpHeldText[0]).to.equal("Checking the run log.")

			task.taskState.currentStreamingContentIndex = 1
			task.taskState.assistantMessageContent.push({ type: "tool_use", name: "read_file", params: {}, partial: false })
			await Task.prototype.presentAssistantMessage.call(task)
			expect(say.lastCall.args).to.deep.equal(["text", "Checking the run log."])
			expect(executeTool.calledOnce).to.equal(true)
			expect(task.taskState.followUpTurn).to.equal(false)
			expect(task.taskState.followUpHeldText).to.deep.equal({})
		})

		it("an empty reply is not an answer", async () => {
			const { task, executeTool } = build({ followUpTurn: true, followUpHeldText: { 0: "  " } })
			expect(await task.acceptFollowUpAnswer()).to.equal(false)
			expect(executeTool.called).to.equal(false)
		})
	})
})
