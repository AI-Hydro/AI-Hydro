import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"

/**
 * The only exit of an in-process subagent. Deliberately NOT in tools/init.ts: it is not part of any top-level
 * variant, so a parent never sees it and it cannot appear in the registry-driven prompt. The subagent prompt builder
 * (core/task/subagents/subagentPrompt.ts) renders it for children only.
 */
export const report_findings_spec: AiHydroToolSpec = {
	variant: ModelFamily.GENERIC,
	id: AiHydroDefaultTool.REPORT_FINDINGS,
	name: "report_findings",
	description:
		"Hand your findings back to the agent that started you, and finish. Call this once, when you have what was asked or have run out of useful reading. The host records the report; you cannot write anything else. Report only what you read in this session: name the files, give line numbers where you can, and put what you could not establish in open_questions instead of guessing.",
	parameters: [
		{
			name: "summary",
			required: true,
			instruction: "A short answer to the question you were given (at most a few sentences).",
			usage: "What you found, in a few sentences",
		},
		{
			name: "key_findings",
			required: false,
			instruction:
				"One finding per line, each starting with '- '. Each should be checkable: a file path, a line range, a tool name and what it returned.",
			usage: "- path/to/file.py:12-30 does X\n- tool_name returned Y",
		},
		{
			name: "files_read",
			required: false,
			instruction: "Paths of the files you actually read, one per line.",
			usage: "path/one\npath/two",
		},
		{
			name: "open_questions",
			required: false,
			instruction: "What you could not establish and what would settle it, one per line, each starting with '- '.",
			usage: "- Is Z set anywhere outside src/?",
		},
	],
}
