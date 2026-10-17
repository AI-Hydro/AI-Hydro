import { expect } from "chai"
import { describe, it } from "mocha"
import type { McpHub } from "@/services/mcp/McpHub"
import { getSystemPrompt } from "../index"
import type { SystemPromptContext } from "../types"

const ctxFor = (modelId: string): SystemPromptContext =>
	({
		cwd: "/test/project",
		ide: "TestIde",
		supportsBrowserUse: false,
		mcpHub: { getServers: () => [] } as unknown as McpHub,
		focusChainSettings: { enabled: false },
		browserSettings: { viewport: { width: 1280, height: 720 } },
		isTesting: true,
		providerInfo: { providerId: "test", model: { id: modelId, info: { supportsPromptCache: false } } },
	}) as unknown as SystemPromptContext

// One id per prompt variant family: generic, next-gen (Claude 4 / 5, Gemini 3), gpt-5.
const MODELS = ["gpt-3", "claude-sonnet-4-20250514", "claude-opus-5-5", "gemini-3.1-pro-preview", "gpt-5.4"]

describe("system prompt: scientific conduct and removed contradictions", () => {
	for (const modelId of MODELS) {
		describe(modelId, () => {
			it("does not tell the model to assume a command succeeded", async () => {
				const prompt = await getSystemPrompt(ctxFor(modelId))
				expect(prompt).to.not.match(/assume the terminal executed/i)
			})

			it("contains the scientific conduct section (no unsourced numbers, honest failures, abstain, observed vs modelled)", async () => {
				const prompt = await getSystemPrompt(ctxFor(modelId))
				expect(prompt).to.include("Scientific conduct")
				expect(prompt).to.match(/Never report a number/)
				expect(prompt).to.match(/failed validation/)
				expect(prompt).to.match(/Abstain when the evidence is insufficient/)
				expect(prompt).to.match(/observed data/i)
				expect(prompt).to.match(/modelled, simulated, or estimated/)
			})

			it("has no web-development advice in the rules or objective", async () => {
				const prompt = await getSystemPrompt(ctxFor(modelId))
				expect(prompt).to.not.include("easily run without additional setup")
				expect(prompt).to.not.include("web application")
				expect(prompt).to.not.include("open index.html")
				expect(prompt).to.not.include("todo app")
			})

			it("does not make list_skills a mandatory pre-flight", async () => {
				const prompt = await getSystemPrompt(ctxFor(modelId))
				expect(prompt).to.not.match(/Mandatory Pre-Flight/)
				expect(prompt).to.not.match(/you MUST call the `list_skills`/)
			})
		})
	}

	it("generic variant states the single skills policy: consult when relevant", async () => {
		const prompt = await getSystemPrompt(ctxFor("gpt-3"))
		expect(prompt).to.match(/\*\*Skills:\*\* Consult the skill catalog/)
		expect(prompt).to.match(/not a mandatory pre-flight/)
	})
})
