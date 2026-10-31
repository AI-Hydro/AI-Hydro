import { expect } from "chai"
import { describe, it } from "mocha"
import { AiHydroDefaultTool } from "@/shared/tools"
import { capFor, EXPLORER_PROFILE, resolveProfile } from "../agentProfile"

describe("agentProfile", () => {
	const all = { canCall: () => true, workspaceTrusted: true, parentIsChild: false }

	it("the explorer allowlist is read-only built-ins and never a write, command, completion or interaction tool", () => {
		expect([...EXPLORER_PROFILE.builtinAllow].sort()).to.deep.equal(
			[
				AiHydroDefaultTool.FILE_READ,
				AiHydroDefaultTool.SEARCH,
				AiHydroDefaultTool.LIST_FILES,
				AiHydroDefaultTool.MCP_DOCS,
				AiHydroDefaultTool.MCP_USE,
				AiHydroDefaultTool.MCP_ACCESS,
			].sort(),
		)
		for (const forbidden of [
			AiHydroDefaultTool.WEB_FETCH,
			AiHydroDefaultTool.ASK,
			AiHydroDefaultTool.ATTEMPT,
			AiHydroDefaultTool.PLAN_MODE,
			AiHydroDefaultTool.CONDENSE,
			AiHydroDefaultTool.SUMMARIZE_TASK,
			AiHydroDefaultTool.TODO,
			AiHydroDefaultTool.NEW_TASK,
			AiHydroDefaultTool.BASH,
		]) {
			expect(EXPLORER_PROFILE.builtinAllow, forbidden).to.not.include(forbidden)
		}
		expect(EXPLORER_PROFILE.canSpawn).to.equal(false)
	})

	it("capFor is the intersection with what the parent can call, never a union", () => {
		const caps = capFor(
			{ ...all, canCall: (t) => t !== AiHydroDefaultTool.MCP_USE && t !== AiHydroDefaultTool.SEARCH },
			EXPLORER_PROFILE,
		)!
		expect(caps.builtinAllow).to.not.include(AiHydroDefaultTool.MCP_USE)
		expect(caps.builtinAllow).to.not.include(AiHydroDefaultTool.SEARCH)
		expect(caps.mcpEnabled).to.equal(false)
		expect(caps.builtinAllow).to.include(AiHydroDefaultTool.FILE_READ)
		// nothing outside the profile appears even when the parent can call it
		for (const tool of caps.builtinAllow) {
			expect(EXPLORER_PROFILE.builtinAllow).to.include(tool)
		}
	})

	it("an untrusted workspace removes the auto-approve ceiling; a trusted one is read", () => {
		expect(capFor(all, EXPLORER_PROFILE)!.autoApproveCeiling).to.equal("read")
		expect(capFor({ ...all, workspaceTrusted: false }, EXPLORER_PROFILE)!.autoApproveCeiling).to.equal("none")
	})

	it("a child cannot spawn: capFor returns nothing for a child parent, and canSpawn is false", () => {
		expect(capFor({ ...all, parentIsChild: true }, EXPLORER_PROFILE)).to.equal(undefined)
		expect(capFor(all, EXPLORER_PROFILE)!.canSpawn).to.equal(false)
	})

	it("resolveProfile knows only explorer and never defaults", () => {
		expect(resolveProfile("explorer")).to.equal(EXPLORER_PROFILE)
		for (const bad of ["general", "data-runner", "", undefined, null, 3, "__proto__", "toString", "constructor"]) {
			expect(resolveProfile(bad), String(bad)).to.equal(undefined)
		}
	})
})
