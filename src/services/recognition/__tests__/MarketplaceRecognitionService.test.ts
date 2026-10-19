import { HostProvider } from "@hosts/host-provider"
import { Setting } from "@shared/proto/host/env"
import { expect } from "chai"
import axios from "axios"
import sinon from "sinon"
import { StateManager } from "@/core/storage/StateManager"
import { MarketplaceRecognitionService } from "../MarketplaceRecognitionService"

describe("MarketplaceRecognitionService telemetry gate", () => {
	let hostSetting: Setting
	let extensionSetting: string
	let postStub: sinon.SinonStub
	let getStub: sinon.SinonStub

	beforeEach(() => {
		hostSetting = Setting.ENABLED
		extensionSetting = "enabled"
		sinon.stub(HostProvider, "env").get(() => ({ getTelemetrySettings: async () => ({ isEnabled: hostSetting }) }) as never)
		sinon.stub(StateManager, "get").returns({ getGlobalSettingsKey: () => extensionSetting } as never)
		postStub = sinon.stub(axios, "post").resolves({ data: {} })
		getStub = sinon.stub(axios, "get").resolves({ data: { items: [] } })
		sinon.stub(console, "debug")
	})
	afterEach(() => sinon.restore())

	const event = { marketplace: "mcp", itemId: "x", eventType: "install" } as const

	it("sends events when VS Code and AI-Hydro telemetry are both on", async () => {
		await MarketplaceRecognitionService.recordEvent(event)
		expect(postStub.calledOnce).to.equal(true)
	})

	it("sends nothing (events, counts, stars) when VS Code telemetry is off", async () => {
		hostSetting = Setting.DISABLED
		await MarketplaceRecognitionService.recordEvent(event)
		const counts = await MarketplaceRecognitionService.getCounts("mcp")
		const star = await MarketplaceRecognitionService.setStar("mcp", "x", true)
		expect(postStub.called).to.equal(false)
		expect(getStub.called).to.equal(false)
		expect(counts.size).to.equal(0)
		expect(star.starred).to.equal(false)
	})

	it("sends nothing when the extension's own telemetry setting is disabled", async () => {
		extensionSetting = "disabled"
		await MarketplaceRecognitionService.recordEvent(event)
		expect(postStub.called).to.equal(false)
	})

	it("fails closed if the setting cannot be read", async () => {
		sinon.restore()
		sinon.stub(HostProvider, "env").get(() => {
			throw new Error("not initialised")
		})
		postStub = sinon.stub(axios, "post").resolves({ data: {} })
		sinon.stub(console, "debug")
		await MarketplaceRecognitionService.recordEvent(event)
		expect(postStub.called).to.equal(false)
	})
})
