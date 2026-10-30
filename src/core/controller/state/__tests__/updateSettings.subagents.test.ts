import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import * as assert from "assert"
import * as sinon from "sinon"
import { Controller } from "../.."
import { updateSettings } from "../updateSettings"

/**
 * `subagentsEnabled` gates the in-process explorer subagents. The retired `aihydro` CLI subagent was macOS-only; the
 * setting is now platform independent, so enabling it must not depend on `process.platform`.
 */
describe("updateSettings subagentsEnabled", () => {
	let mockController: Controller
	let originalPlatform: NodeJS.Platform

	beforeEach(() => {
		originalPlatform = process.platform
		mockController = {
			stateManager: {
				getGlobalSettingsKey: sinon.stub(),
				setGlobalState: sinon.stub(),
				setApiConfiguration: sinon.stub(),
			},
			postStateToWebview: sinon.stub().resolves({}),
			task: undefined,
			updateTelemetrySetting: sinon.stub(),
		} as unknown as Controller
	})

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform, writable: true, configurable: true })
		sinon.restore()
	})

	for (const platform of ["darwin", "win32", "linux"] as const) {
		it(`enables subagents on ${platform}`, async () => {
			Object.defineProperty(process, "platform", { value: platform })
			;(mockController.stateManager.getGlobalSettingsKey as sinon.SinonStub).returns(false)

			await updateSettings(mockController, UpdateSettingsRequest.create({ subagentsEnabled: true }))

			assert.ok((mockController.stateManager.setGlobalState as sinon.SinonStub).calledWith("subagentsEnabled", true))
		})
	}

	it("disables subagents", async () => {
		;(mockController.stateManager.getGlobalSettingsKey as sinon.SinonStub).returns(true)

		await updateSettings(mockController, UpdateSettingsRequest.create({ subagentsEnabled: false }))

		assert.ok((mockController.stateManager.setGlobalState as sinon.SinonStub).calledWith("subagentsEnabled", false))
	})

	it("does not touch subagentsEnabled when the request does not carry it", async () => {
		await updateSettings(mockController, UpdateSettingsRequest.create({ strictPlanModeEnabled: true }))

		assert.ok(
			!(mockController.stateManager.setGlobalState as sinon.SinonStub).calledWith("subagentsEnabled", sinon.match.any),
		)
		assert.ok((mockController.postStateToWebview as sinon.SinonStub).called)
	})
})
