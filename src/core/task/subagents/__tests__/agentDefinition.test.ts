import { expect } from "chai"
import { describe, it } from "mocha"
import { AiHydroDefaultTool } from "@/shared/tools"
import { allowedToolsOf } from "../../agentPolicy"
import {
	BUILTIN_DEFINITIONS,
	canonicalJson,
	capFor,
	DEFAULT_AGENT_ID,
	EXPLORER_DEFINITION,
	REVIEWER_DEFINITION,
	reportToolFor,
	resolveDefinition,
	sha256Hex,
} from "../agentDefinition"

describe("agentDefinition", () => {
	const all = { canCall: () => true, workspaceTrusted: true, parentIsChild: false }

	it("the explorer allowlist is read-only built-ins and never a write, command, completion or interaction tool", () => {
		expect([...EXPLORER_DEFINITION.builtinAllow].sort()).to.deep.equal(
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
			expect(EXPLORER_DEFINITION.builtinAllow, forbidden).to.not.include(forbidden)
		}
		expect(EXPLORER_DEFINITION.canSpawn).to.equal(false)
	})

	it("explorer snapshot: its callable set, policy, schema, ceiling, budget and model are what they were before definitions existed", () => {
		// A literal, on purpose: a change to the explorer must change this test in the same diff and be seen in review.
		expect(allowedToolsOf(EXPLORER_DEFINITION)).to.deep.equal([
			"read_file",
			"search_files",
			"list_files",
			"load_mcp_documentation",
			"use_mcp_tool",
			"access_mcp_resource",
			"report_findings",
		])
		expect({
			id: EXPLORER_DEFINITION.id,
			displayName: EXPLORER_DEFINITION.displayName,
			source: EXPLORER_DEFINITION.source,
			mcpPolicy: EXPLORER_DEFINITION.mcpPolicy,
			reportSchema: EXPLORER_DEFINITION.reportSchema,
			autoApproveCeiling: EXPLORER_DEFINITION.autoApproveCeiling,
			model: EXPLORER_DEFINITION.model,
			crossProvider: EXPLORER_DEFINITION.crossProvider,
			canSpawn: EXPLORER_DEFINITION.canSpawn,
			budget: EXPLORER_DEFINITION.budget,
			limits: EXPLORER_DEFINITION.limits,
		}).to.deep.equal({
			id: "explorer",
			displayName: "Explorer",
			source: "builtin",
			mcpPolicy: "read",
			reportSchema: "findings",
			autoApproveCeiling: "read",
			model: "inherit",
			crossProvider: false,
			canSpawn: false,
			budget: { maxToolCalls: 30, wallClockMs: 600_000, maxOutputTokens: 40_000, contextStopFraction: 0.8, maxCostUsd: 2 },
			limits: "No file writes, no commands, no network or browser tools, no questions to you, and no claims. It reads this workspace and calls read-only tools on the trusted AI-Hydro server.",
		})
		const caps = capFor(all, EXPLORER_DEFINITION)!
		expect(caps.reportTool).to.equal("report_findings")
		expect(caps.mcpEnabled).to.equal(true)
		expect(caps.autoApproveCeiling).to.equal("read")
	})

	it("the reviewer is the explorer's tools with a review exit: no tool is added, so no authority is", () => {
		expect([...REVIEWER_DEFINITION.builtinAllow]).to.deep.equal([...EXPLORER_DEFINITION.builtinAllow])
		expect(REVIEWER_DEFINITION.mcpPolicy).to.equal("read")
		expect(REVIEWER_DEFINITION.reportSchema).to.equal("review")
		expect(REVIEWER_DEFINITION.autoApproveCeiling).to.equal("read")
		expect(REVIEWER_DEFINITION.canSpawn).to.equal(false)
		expect(allowedToolsOf(REVIEWER_DEFINITION)).to.include("report_review")
		expect(allowedToolsOf(REVIEWER_DEFINITION)).to.not.include("report_findings")
		expect(allowedToolsOf(EXPLORER_DEFINITION)).to.not.include("report_review")
		// a different model or provider where the user set one (D7), and only then
		expect(REVIEWER_DEFINITION.model).to.equal("setting")
		expect(REVIEWER_DEFINITION.crossProvider).to.equal(true)
		expect(reportToolFor("review")).to.equal("report_review")
		expect(reportToolFor("findings")).to.equal("report_findings")
	})

	it("no built-in lists a write, a command, the network, completion or spawn", () => {
		const forbidden: AiHydroDefaultTool[] = [
			AiHydroDefaultTool.FILE_NEW,
			AiHydroDefaultTool.FILE_EDIT,
			AiHydroDefaultTool.MULTI_FILE_EDIT,
			AiHydroDefaultTool.BASH,
			AiHydroDefaultTool.WEB_FETCH,
			AiHydroDefaultTool.BROWSER,
			AiHydroDefaultTool.ATTEMPT,
			AiHydroDefaultTool.ASK,
			AiHydroDefaultTool.SPAWN_SUBAGENTS,
			AiHydroDefaultTool.NEW_RULE,
			AiHydroDefaultTool.PREVIEW_HTML,
		]
		for (const definition of BUILTIN_DEFINITIONS.values()) {
			expect(definition.canSpawn, definition.id).to.equal(false)
			expect(definition.source, definition.id).to.equal("builtin")
			for (const tool of forbidden) {
				expect(definition.builtinAllow, `${definition.id} ${tool}`).to.not.include(tool)
			}
		}
	})

	it("each built-in has a stable sha256 of its canonical record, and they differ", () => {
		const hashes = [...BUILTIN_DEFINITIONS.values()].map((d) => d.sha256)
		for (const hash of hashes) {
			expect(hash).to.match(/^[0-9a-f]{64}$/)
		}
		expect(new Set(hashes).size).to.equal(hashes.length)
		const { sha256, ...record } = EXPLORER_DEFINITION
		expect(sha256).to.equal(sha256Hex(canonicalJson(record)))
		// canonical JSON is key-order independent
		expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).to.equal(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }))
	})

	it("capFor is the intersection with what the parent can call, never a union", () => {
		const caps = capFor(
			{ ...all, canCall: (t) => t !== AiHydroDefaultTool.MCP_USE && t !== AiHydroDefaultTool.SEARCH },
			EXPLORER_DEFINITION,
		)!
		expect(caps.builtinAllow).to.not.include(AiHydroDefaultTool.MCP_USE)
		expect(caps.builtinAllow).to.not.include(AiHydroDefaultTool.SEARCH)
		expect(caps.mcpEnabled).to.equal(false)
		expect(caps.builtinAllow).to.include(AiHydroDefaultTool.FILE_READ)
		// nothing outside the definition appears even when the parent can call it
		for (const tool of caps.builtinAllow) {
			expect(EXPLORER_DEFINITION.builtinAllow).to.include(tool)
		}
	})

	it("an untrusted workspace removes the auto-approve ceiling; a trusted one is read", () => {
		for (const definition of BUILTIN_DEFINITIONS.values()) {
			expect(capFor(all, definition)!.autoApproveCeiling, definition.id).to.equal("read")
			expect(capFor({ ...all, workspaceTrusted: false }, definition)!.autoApproveCeiling, definition.id).to.equal("none")
		}
	})

	it("a child cannot spawn: capFor returns nothing for a child parent, and canSpawn is false", () => {
		for (const definition of BUILTIN_DEFINITIONS.values()) {
			expect(capFor({ ...all, parentIsChild: true }, definition), definition.id).to.equal(undefined)
			expect(capFor(all, definition)!.canSpawn, definition.id).to.equal(false)
		}
	})

	it("resolveDefinition knows the built-ins and never defaults", () => {
		expect(resolveDefinition(DEFAULT_AGENT_ID)).to.equal(EXPLORER_DEFINITION)
		expect(resolveDefinition("reviewer")).to.equal(REVIEWER_DEFINITION)
		for (const bad of ["general", "data-runner", "", undefined, null, 3, "__proto__", "toString", "constructor"]) {
			expect(resolveDefinition(bad), String(bad)).to.equal(undefined)
		}
	})

	it("a file definition can be found, but never shadows a built-in", () => {
		const fileDefinition = { ...EXPLORER_DEFINITION, id: "mine", source: "global" as const }
		const extra = new Map([
			["mine", fileDefinition],
			["explorer", fileDefinition],
		])
		expect(resolveDefinition("mine", extra)).to.equal(fileDefinition)
		expect(resolveDefinition("explorer", extra)).to.equal(EXPLORER_DEFINITION)
	})
})
