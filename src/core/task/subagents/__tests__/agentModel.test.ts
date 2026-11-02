import type { ApiConfiguration } from "@shared/api"
import { expect } from "chai"
import { describe, it } from "mocha"
import { type AgentDefinition, EXPLORER_DEFINITION, REVIEWER_DEFINITION } from "../agentDefinition"
import { resolveChildApi } from "../agentModel"

const base = (): ApiConfiguration => ({
	actModeApiProvider: "anthropic",
	actModeApiModelId: "claude-parent",
	planModeApiProvider: "anthropic",
	planModeApiModelId: "claude-parent-plan",
	apiKey: "secret",
})

describe("resolveChildApi", () => {
	it("a definition that inherits uses the parent's model, and the configuration is not even read", () => {
		let read = 0
		const result = resolveChildApi(
			() => {
				read++
				return base()
			},
			"act",
			EXPLORER_DEFINITION,
			{ explorer: { modelId: "cheap" } },
		)
		expect(result).to.deep.equal({ ok: true, mode: "act", overridden: false, otherProvider: false })
		expect(read).to.equal(0)
	})

	it("a setting-driven definition with no entry also inherits", () => {
		const result = resolveChildApi(base, "act", REVIEWER_DEFINITION, undefined)
		expect(result).to.include({ ok: true, overridden: false })
		expect(resolveChildApi(base, "act", REVIEWER_DEFINITION, {})).to.include({ overridden: false })
		expect(resolveChildApi(base, "act", REVIEWER_DEFINITION, null)).to.include({ overridden: false })
	})

	it("sets the model id on a copy for the parent's provider and leaves the parent's configuration alone", () => {
		const parent = base()
		const result = resolveChildApi(() => parent, "act", REVIEWER_DEFINITION, { reviewer: { modelId: " claude-judge " } })
		expect(result.ok).to.equal(true)
		if (result.ok) {
			expect(result.config?.actModeApiModelId).to.equal("claude-judge")
			expect(result.config?.planModeApiModelId).to.equal("claude-parent-plan")
			expect(result).to.include({ overridden: true, otherProvider: false, providerId: "anthropic" })
			expect(result.config?.apiKey).to.equal("secret")
		}
		expect(parent.actModeApiModelId).to.equal("claude-parent")
	})

	it("uses the key of the mode, and each provider's own model key (and clears its saved model info)", () => {
		const plan = resolveChildApi(base, "plan", REVIEWER_DEFINITION, { reviewer: { modelId: "p" } })
		expect(plan.ok && plan.config?.planModeApiModelId).to.equal("p")
		const openrouter = resolveChildApi(
			() => ({
				actModeApiProvider: "openrouter",
				actModeOpenRouterModelId: "a/b",
				actModeOpenRouterModelInfo: { supportsPromptCache: false },
			}),
			"act",
			REVIEWER_DEFINITION,
			{ reviewer: { modelId: "c/d" } },
		)
		expect(openrouter.ok).to.equal(true)
		if (openrouter.ok) {
			expect(openrouter.config?.actModeOpenRouterModelId).to.equal("c/d")
			expect(openrouter.config?.actModeOpenRouterModelInfo).to.equal(undefined)
		}
	})

	it("a different provider is honoured only for a definition that allows it (D7), and the card is told", () => {
		const other = resolveChildApi(base, "act", REVIEWER_DEFINITION, {
			reviewer: { modelId: "gpt-x", providerId: "openai-native" },
		})
		expect(other.ok).to.equal(true)
		if (other.ok) {
			expect(other).to.include({ overridden: true, otherProvider: true, providerId: "openai-native" })
			expect(other.config?.actModeApiProvider).to.equal("openai-native")
			expect(other.config?.actModeApiModelId).to.equal("gpt-x")
		}
		const strict: AgentDefinition = { ...REVIEWER_DEFINITION, id: "strict", crossProvider: false }
		const refused = resolveChildApi(base, "act", strict, { strict: { modelId: "gpt-x", providerId: "openai-native" } })
		expect(refused.ok).to.equal(false)
		if (!refused.ok) {
			expect(refused.error).to.include("may not use a different provider")
		}
		// naming the parent's own provider is not a different provider
		const same = resolveChildApi(base, "act", strict, { strict: { modelId: "m", providerId: "anthropic" } })
		expect(same).to.include({ ok: true, otherProvider: false })
	})

	it("fails loudly on what cannot be applied: a malformed entry, an unknown provider, a provider with no model key", () => {
		for (const entry of ["x", 3, { modelId: "" }, { modelId: 4 }, { modelId: "m", providerId: 5 }, null]) {
			const result = resolveChildApi(base, "act", REVIEWER_DEFINITION, { reviewer: entry })
			expect(result.ok, JSON.stringify(entry)).to.equal(false)
		}
		for (const providerId of ["no-such", "constructor", "__proto__", "vscode-lm", "dify", "sapaicore"]) {
			const result = resolveChildApi(base, "act", REVIEWER_DEFINITION, { reviewer: { modelId: "m", providerId } })
			expect(result.ok, providerId).to.equal(false)
			if (!result.ok) {
				expect(result.error).to.include("cannot be set on provider")
			}
		}
	})

	it("a file's model id applies on the parent's provider, and a setting beats it", () => {
		const file: AgentDefinition = {
			...EXPLORER_DEFINITION,
			id: "mine",
			extends: "explorer",
			source: "global",
			modelId: "from-file",
		}
		const fromFile = resolveChildApi(base, "act", file, undefined)
		expect(fromFile.ok && fromFile.config?.actModeApiModelId).to.equal("from-file")
		// a file cannot be pointed at another provider: there is no field for it
		expect(fromFile.ok && fromFile.otherProvider).to.equal(false)
		const settingFile: AgentDefinition = { ...file, model: "setting" }
		const fromSetting = resolveChildApi(base, "act", settingFile, { mine: { modelId: "from-setting" } })
		expect(fromSetting.ok && fromSetting.config?.actModeApiModelId).to.equal("from-setting")
		// a setting under the built-in a file extends applies to the file too
		const viaBase = resolveChildApi(
			base,
			"act",
			{ ...REVIEWER_DEFINITION, id: "my-rev", extends: "reviewer", source: "global" },
			{ reviewer: { modelId: "rev-model" } },
		)
		expect(viaBase.ok && viaBase.config?.actModeApiModelId).to.equal("rev-model")
	})
})
