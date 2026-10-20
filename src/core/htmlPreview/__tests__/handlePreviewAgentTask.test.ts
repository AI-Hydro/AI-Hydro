import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import * as sinon from "sinon"
import type { Controller } from "@/core/controller"
import { handlePreviewAgentTaskMessage } from "../handlePreviewAgentTask"
import * as starter from "../startPreviewAgentTask"

describe("handlePreviewAgentTaskMessage trust gate", () => {
	afterEach(() => sinon.restore())

	function controllerWith(canExecute: (id: string) => boolean): Controller {
		return { getArtifactPreviewService: () => ({ canExecute }) } as unknown as Controller
	}

	it("refuses a request without an artifact id", async () => {
		const start = sinon.stub(starter, "startPreviewAgentTask").resolves({ ok: true })
		const replies: Record<string, unknown>[] = []
		await handlePreviewAgentTaskMessage(controllerWith(() => true), { requestId: "r1", prompt: "do it" }, (r) => {
			replies.push(r)
		})
		expect(start.called).to.be.false
		expect(replies[0]).to.include({ ok: false, requestId: "r1" })
	})

	it("refuses a document that is static, unsigned, unknown or not allowed", async () => {
		const start = sinon.stub(starter, "startPreviewAgentTask").resolves({ ok: true })
		const replies: Record<string, unknown>[] = []
		await handlePreviewAgentTaskMessage(
			controllerWith(() => false),
			{ requestId: "r2", prompt: "do it", artifactId: "file_1" },
			(r) => {
				replies.push(r)
			},
		)
		expect(start.called).to.be.false
		expect(replies[0]).to.include({ ok: false })
		expect(String(replies[0].error)).to.match(/denied/)
	})

	it("starts the task for a trusted, allowed document", async () => {
		const start = sinon.stub(starter, "startPreviewAgentTask").resolves({ ok: true })
		const replies: Record<string, unknown>[] = []
		await handlePreviewAgentTaskMessage(
			controllerWith((id) => id === "file_1"),
			{ requestId: "r3", prompt: "review these", artifactId: "file_1" },
			(r) => {
				replies.push(r)
			},
		)
		expect(start.calledOnce).to.be.true
		expect(start.firstCall.args[1]).to.equal("review these")
		expect(replies[0]).to.include({ ok: true })
	})
})
