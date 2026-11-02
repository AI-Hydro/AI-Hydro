import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

/**
 * AC9 / S6: no subagent module names a claim-mutating or approval tool. A claim is created, revised and approved by
 * the owner outside the agent (ADR-002b); an explorer has no route to any of them, and this keeps it that way by
 * construction rather than by prompt.
 */
const SRC = path.resolve(__dirname, "../../../..")
const SUBAGENT_FILES = [
	"core/task/subagents/agentDefinition.ts",
	"core/task/subagents/agentFiles.ts",
	"core/task/subagents/agentModel.ts",
	"core/task/subagents/launchBrake.ts",
	"core/task/subagents/childRuntime.ts",
	"core/task/subagents/ParentAskBridge.ts",
	"core/task/subagents/SubagentRunner.ts",
	"core/task/subagents/SubagentSupervisor.ts",
	"core/task/subagents/subagentPrompt.ts",
	"core/task/subagents/subagentCost.ts",
	"core/task/subagents/subagentRecord.ts",
	"core/task/subagents/subagentReports.ts",
	"core/task/subagents/taskLedger.ts",
	"core/task/tools/handlers/ReportFindingsHandler.ts",
	"core/task/tools/handlers/ReportReviewHandler.ts",
	"core/prompts/system-prompt/tools/report_findings.ts",
	"core/prompts/system-prompt/tools/report_review.ts",
	"shared/aihydro/subagents.ts",
]

/**
 * Tool names the server really registers (checked against the tool list below, so a name that does not exist fails),
 * plus the owner's approval command, which is not an MCP tool.
 */
const FORBIDDEN_TOOLS = [
	"add_claim",
	"update_claim_status",
	"promote_claim_to_registry",
	"add_assumption",
	"bind_claim_to_item",
	"bind_map_to_claim",
	"register_research_plan",
	"write_research_interpretation",
	"clear_session",
]
const FORBIDDEN = [...FORBIDDEN_TOOLS, "aihydro-approve"]

const SURFACE: { tools: Record<string, unknown> } = JSON.parse(
	fs.readFileSync(path.join(SRC, "core/task/__tests__/fixtures/aihydro-tool-surface.json"), "utf8"),
)

describe("subagent boundaries", () => {
	it("every subagent module exists (the list above is current)", () => {
		for (const file of SUBAGENT_FILES) {
			expect(fs.existsSync(path.join(SRC, file)), file).to.equal(true)
		}
		const dir = path.join(SRC, "core/task/subagents")
		const present = fs.readdirSync(dir).filter((name) => name.endsWith(".ts"))
		for (const name of present) {
			expect(SUBAGENT_FILES, `${name} is not in the boundary list`).to.include(`core/task/subagents/${name}`)
		}
	})

	it("the forbidden tool names are tools the server registers (the list names nothing that does not exist)", () => {
		for (const name of FORBIDDEN_TOOLS) {
			expect(Object.hasOwn(SURFACE.tools, name), name).to.equal(true)
		}
	})

	for (const file of SUBAGENT_FILES) {
		it(`${file} names no claim or approval tool`, () => {
			const text = fs.readFileSync(path.join(SRC, file), "utf8")
			for (const name of FORBIDDEN) {
				expect(text, name).to.not.include(name)
			}
		})
	}

	it("no subagent module imports the CLI path or reads the profile environment variable", () => {
		for (const file of SUBAGENT_FILES) {
			const text = fs.readFileSync(path.join(SRC, file), "utf8")
			expect(text, file).to.not.match(/AIHYDRO_PROFILE|cli-subagents|subagent_command/)
		}
	})

	it("child code never calls the parent's say (it would move lastMessageTs and supersede a pending ask)", () => {
		const runner = fs.readFileSync(path.join(SRC, "core/task/subagents/SubagentRunner.ts"), "utf8")
		const bridge = fs.readFileSync(path.join(SRC, "core/task/subagents/ParentAskBridge.ts"), "utf8")
		expect(runner).to.not.match(/callbacks\.say|parent\.say|parentSay/)
		expect(bridge).to.not.match(/\bsay\(/)
	})
})
