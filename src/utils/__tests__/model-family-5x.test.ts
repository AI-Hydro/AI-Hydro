import { describe, it } from "mocha"
import "should"
import { isClaude5ModelFamily, isGemini3ModelFamily, isNextGenModelFamily } from "../model-utils"

describe("model family detection", () => {
	it("recognises Claude 5.x ids across providers", () => {
		for (const id of [
			"claude-fable-5-1",
			"claude-opus-5-5",
			"claude-sonnet-5-5",
			"claude-haiku-5-5",
			"claude-opus-5",
			"anthropic.claude-opus-5-5",
			"anthropic/claude-sonnet-5.5",
			"claude-mythos-5-1",
		]) {
			isClaude5ModelFamily(id).should.equal(true, id)
			isNextGenModelFamily(id).should.equal(true, id)
		}
	})

	it("does not mistake Claude 3.5 / 4.5 ids for 5.x", () => {
		for (const id of [
			"claude-3-5-sonnet-20241022",
			"claude-3-5-haiku-20241022",
			"claude-sonnet-4-5-20250929",
			"claude-opus-4-5-20251101",
		]) {
			isClaude5ModelFamily(id).should.equal(false, id)
		}
	})

	it("recognises Gemini 3.x (including the registry default) as next-gen", () => {
		isGemini3ModelFamily("gemini-3.1-pro-preview").should.equal(true)
		isNextGenModelFamily("gemini-3.1-pro-preview").should.equal(true)
		isGemini3ModelFamily("gemini-2.5-pro").should.equal(false)
		isGemini3ModelFamily("gemini-30-x").should.equal(false)
	})

	it("keeps unknown/basic models out of the next-gen set", () => {
		isNextGenModelFamily("llama-3-70b").should.equal(false)
	})
})
