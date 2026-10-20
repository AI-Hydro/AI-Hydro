/**
 * The condense budget must be sane for EVERY registered model: a response reservation that is a large share of a
 * small window once produced a zero or negative budget (condense on every request).
 */
import * as api from "@shared/api"
import "should"
import { getContextWindowInfo, MAX_OUTPUT_RESERVE_FRACTION } from "../context-window-utils"

function allModels(): [string, any][] {
	const out: [string, any][] = []
	for (const [exportName, value] of Object.entries(api)) {
		if (!/Models$/.test(exportName) || typeof value !== "object" || value === null) {
			continue
		}
		for (const [id, info] of Object.entries(value as Record<string, any>)) {
			if (info && typeof info === "object" && typeof info.contextWindow === "number") {
				out.push([`${exportName}/${id}`, info])
			}
		}
	}
	return out
}

const budget = (contextWindow: number, maxTokens: number | undefined) =>
	getContextWindowInfo({ getModel: () => ({ id: "x", info: { contextWindow, maxTokens } }) } as any).maxAllowedSize

describe("condense budget across the model registry", () => {
	const models = allModels()

	it("covers a meaningful number of models", () => {
		models.length.should.be.above(100)
	})

	it("maxAllowedSize > 0.5 x window and input + reserved output fits, for every model", () => {
		const bad: string[] = []
		for (const [name, info] of models) {
			if (info.contextWindow >= Number.MAX_SAFE_INTEGER) {
				continue // unbounded sentinel
			}
			const { contextWindow, maxAllowedSize } = getContextWindowInfo({ getModel: () => ({ id: name, info }) } as any)
			const reserve = Math.min(info.maxTokens ?? 0, MAX_OUTPUT_RESERVE_FRACTION * contextWindow)
			if (!(maxAllowedSize > 0.5 * contextWindow) || maxAllowedSize + reserve > contextWindow + 1e-6) {
				bad.push(`${name}: window ${contextWindow} maxTokens ${info.maxTokens} -> ${maxAllowedSize}`)
			}
		}
		bad.should.eql([])
	})

	it("pins the known shapes", () => {
		budget(1_000_000, 128_000).should.equal(852_000)
		budget(131_072, 129_024).should.be.approximately(131_072 - 0.2 * 131_072 - 0.05 * 131_072, 1)
		budget(64_000, 64_000).should.equal(37_000) // the 64k branch is already tighter than the reservation
		budget(200_000, 8_192).should.equal(160_000)
		budget(128_000, undefined).should.equal(98_000)
	})
})
