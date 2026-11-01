import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import type { AiHydroToolSpec } from "../spec"

const id = AiHydroDefaultTool.ATTEMPT

const generic: AiHydroToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "attempt_completion",
	description: `After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses, use this tool to present the result of your work to the user. Optionally you may provide a CLI command to showcase the result of your work. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
Do not use this tool while a previous tool call's result is still missing. If you could not finish the task, use this tool anyway with outcome partial (some of it is done) or infeasible (it cannot be done with the data and tools available) and list what is unmet. Saying so is correct; presenting unfinished work as complete, or filling a gap with an invented or assumed value, is not.`,
	parameters: [
		{
			name: "result",
			required: true,
			instruction: "The result of the tool use. This should be a clear, specific description of the result.",
			usage: "Your final result description here",
		},
		{
			name: "outcome",
			required: false,
			instruction:
				"done (the default, leave it out), partial (part of the task is not done) or infeasible (the task cannot be done as asked). Use partial or infeasible whenever data, a run or a step you needed is missing, failed or was assumed.",
			usage: "done | partial | infeasible (optional)",
		},
		{
			name: "unmet",
			required: false,
			instruction:
				"With outcome partial or infeasible: what was not done and why, one item per line (for example: no observed streamflow for 2010-2015; the forcing fetch timed out).",
			usage: "One unmet item per line (optional)",
		},
		{
			name: "command",
			required: false,
			instruction:
				"A CLI command to execute to show a live demo of the result to the user. For example, use \`open report.html\` to display a generated report or figure. But DO NOT use commands like \`echo\` or \`cat\` that merely print text. This command should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions",
			usage: "Your command here (optional)",
		},
		// Different than the vanilla ASK_PROGRESS_PARAMETER
		{
			name: "task_progress",
			required: false,
			instruction:
				"A checklist showing task progress after this tool use is completed. (See 'Updating Task Progress' section for more details)",
			usage: "Checklist here (required if you used task_progress in previous tool uses)",
			dependencies: [AiHydroDefaultTool.TODO],
			description:
				"If you were using task_progress to update the task progress, you must include the completed list in the result as well.",
		},
	],
}

export const attempt_completion_variants = [generic]
