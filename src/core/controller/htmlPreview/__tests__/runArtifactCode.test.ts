import { ArtifactCodeLanguage, RunArtifactCodeRequest } from "@shared/proto/cline/html_preview"
import { expect } from "chai"
import * as sinon from "sinon"
import type { Controller } from "../.."
import * as approval from "../ensurePythonExecutionAllowed"
import { runArtifactCode } from "../runArtifactCode"

describe("runArtifactCode", () => {
	let mockController: Partial<Controller>
	let executeStub: sinon.SinonStub
	let allowStub: sinon.SinonStub
	let trustSource: "learning-pack" | "recorded-tool" | "unsigned-module" | "document"
	let executionAllowed: boolean

	beforeEach(() => {
		trustSource = "learning-pack"
		executionAllowed = true
		executeStub = sinon.stub().resolves({
			stdout: "hi\n",
			stderr: "",
			status: "ok",
			error: "",
			resultRepr: "",
			imagesPngBase64: [],
			videosMp4Base64: [],
			truncated: false,
		})
		allowStub = sinon.stub(approval, "ensurePythonExecutionAllowed").resolves(true)

		mockController = {
			context: {} as Controller["context"],
			getArtifactPreviewService: (() => ({
				get: () => ({
					id: "artifact_1",
					dirFsPath: "/tmp",
					trustSource,
				}),
				canExecute: () => executionAllowed && (trustSource === "learning-pack" || trustSource === "recorded-tool"),
			})) as unknown as Controller["getArtifactPreviewService"],
			getArtifactKernelService: (() => ({
				execute: executeStub,
				getInfoOrDefault: sinon.stub().resolves({
					executionCount: 1,
					kernelDirty: true,
				}),
			})) as unknown as Controller["getArtifactKernelService"],
			resolvePreviewModuleId: (id: string) => (id === "artifact_1" ? "water-balance" : id),
			previewSessionService: {
				appendEvent: sinon.stub(),
			} as unknown as Controller["previewSessionService"],
		}
	})

	afterEach(() => {
		sinon.restore()
	})

	it("returns denied when approval fails", async () => {
		allowStub.resolves(false)
		const result = await runArtifactCode(
			mockController as Controller,
			RunArtifactCodeRequest.create({
				artifactId: "artifact_1",
				language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
				code: "print(1)",
			}),
		)
		expect(result.status).to.equal("denied")
		expect(executeStub.called).to.be.false
	})

	it("executes python when approved", async () => {
		const result = await runArtifactCode(
			mockController as Controller,
			RunArtifactCodeRequest.create({
				artifactId: "artifact_1",
				profileId: "profile_abc",
				language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
				code: "print('hi')",
				cellId: "cell-1",
			}),
		)
		expect(result.status).to.equal("success")
		expect(result.stdout).to.equal("hi\n")
		expect(executeStub.calledOnce).to.be.true
		expect(executeStub.firstCall.args[0]).to.equal("print('hi')")
		expect(executeStub.firstCall.args[1]).to.equal("artifact_1")
		expect(executeStub.firstCall.args[2]).to.equal("profile_abc")
		expect(executeStub.firstCall.args[4]).to.equal("cell-1")
		const appendEvent = mockController.previewSessionService?.appendEvent as sinon.SinonStub
		expect(appendEvent.calledTwice).to.be.true
		for (const call of appendEvent.getCalls()) {
			expect(call.args[0].moduleId).to.equal("water-balance")
			expect(JSON.parse(call.args[0].payloadJson).moduleId).to.equal("water-balance")
		}
	})

	describe("trust gate", () => {
		const request = () =>
			RunArtifactCodeRequest.create({
				artifactId: "artifact_1",
				language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
				code: "print(1)",
			})

		it("denies a static document without prompting or starting a kernel", async () => {
			trustSource = "document"
			const result = await runArtifactCode(mockController as Controller, request())
			expect(result.status).to.equal("denied")
			expect(result.error).to.equal("denied: document is not an executable module")
			expect(allowStub.called, "must not even prompt").to.be.false
			expect(executeStub.called, "must not run").to.be.false
		})

		it("denies an unsigned marketplace module, even if an allowance somehow exists", async () => {
			trustSource = "unsigned-module"
			executionAllowed = true
			const result = await runArtifactCode(mockController as Controller, request())
			expect(result.status).to.equal("denied")
			expect(result.error).to.match(/unsigned marketplace module/)
			expect(executeStub.called).to.be.false
		})

		it("denies a trusted document the user has not allowed", async () => {
			executionAllowed = false
			const result = await runArtifactCode(mockController as Controller, request())
			expect(result.status).to.equal("denied")
			expect(result.error).to.match(/Allow execution/)
			expect(allowStub.called).to.be.false
			expect(executeStub.called).to.be.false
		})

		it("still honours the machine-level Python execution setting for an allowed trusted document", async () => {
			allowStub.resolves(false)
			const result = await runArtifactCode(mockController as Controller, request())
			expect(result.status).to.equal("denied")
			expect(executeStub.called).to.be.false
		})

		it("runs a recorded-tool artifact once allowed", async () => {
			trustSource = "recorded-tool"
			const result = await runArtifactCode(mockController as Controller, request())
			expect(result.status).to.equal("success")
			expect(executeStub.calledOnce).to.be.true
		})
	})

	it("requires artifact_id", async () => {
		const result = await runArtifactCode(
			mockController as Controller,
			RunArtifactCodeRequest.create({
				language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
				code: "print(1)",
			}),
		)
		expect(result.status).to.equal("error")
		expect(executeStub.called).to.be.false
	})
})
