import { expect } from "chai"
import { describe, it } from "mocha"
import type { Controller } from "../../index"
import { refreshCoursesMarketplace } from "../refreshCoursesMarketplace"
import { refreshModulesMarketplace } from "../refreshModulesMarketplace"

const failing = {
	silentlyRefreshModulesMarketplaceRPC: async () => undefined,
	silentlyRefreshCoursesMarketplaceRPC: async () => undefined,
} as unknown as Controller

const empty = {
	silentlyRefreshModulesMarketplaceRPC: async () => ({ items: [] }),
	silentlyRefreshCoursesMarketplaceRPC: async () => ({ items: [] }),
} as unknown as Controller

describe("marketplace refresh errors", () => {
	it("rejects (error state) when the module catalogue could not be fetched", async () => {
		let err: unknown
		await refreshModulesMarketplace(failing, {} as never).catch((e) => (err = e))
		expect(String(err)).to.match(/Could not load the modules catalogue/)
	})
	it("rejects when the course catalogue could not be fetched", async () => {
		let err: unknown
		await refreshCoursesMarketplace(failing, {} as never).catch((e) => (err = e))
		expect(String(err)).to.match(/Could not load the courses catalogue/)
	})
	it("returns an empty catalogue only when the index genuinely is empty", async () => {
		expect((await refreshModulesMarketplace(empty, {} as never)).items).to.have.length(0)
		expect((await refreshCoursesMarketplace(empty, {} as never)).items).to.have.length(0)
	})
})
