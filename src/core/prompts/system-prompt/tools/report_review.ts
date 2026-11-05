import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"

/**
 * The exit of a reviewer subagent. Like report_findings it is NOT in tools/init.ts: no top-level variant lists it, so a
 * parent never sees it. The subagent prompt builder renders it for a child whose definition returns a review.
 */
export const report_review_spec: AiHydroToolSpec = {
	variant: ModelFamily.GENERIC,
	id: AiHydroDefaultTool.REPORT_REVIEW,
	name: "report_review",
	description:
		"Hand your check back to the agent that started you, and finish. Call this once, when you have checked each statement you were given or have run out of useful reading. The host records it; you cannot write anything else. A statement you could not check against something you read or were given is 'unverifiable': say so. Never mark a statement 'unsupported' unless what you read contradicts it or shows it does not follow.",
	parameters: [
		{
			name: "summary",
			required: true,
			instruction: "A short account of what you checked and how (at most a few sentences).",
			usage: "What you checked, against what, in a few sentences",
		},
		{
			name: "verdicts",
			required: true,
			instruction:
				"One line per statement, in the form 'supported | <statement> | <what you read that shows it>' with the first part one of supported, unsupported or unverifiable. Name the source (a path and lines, a run id, a tool and what it returned).",
			usage: "supported | NSE is 0.62 | run watershed.ab12#key_outputs.nse is 0.62\nunverifiable | The basin is snow-dominated | no snow data was given or readable",
		},
		{
			name: "open_questions",
			required: false,
			instruction: "What you could not establish and what would settle it, one per line, each starting with '- '.",
			usage: "- Which gauge record was used for the observed series?",
		},
	],
}
