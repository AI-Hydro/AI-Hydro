import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { baseTemplate } from "./template"

export const config = createVariant(ModelFamily.GENERIC)
	.description("The fallback prompt for generic use cases and models.")
	.version(1)
	.tags("fallback", "stable")
	.labels({
		stable: 1,
		fallback: 1,
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.MCP,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.TODO,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.RULES,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.USER_INSTRUCTIONS,
	)
	.tools(
		AiHydroDefaultTool.BASH,
		AiHydroDefaultTool.FILE_READ,
		AiHydroDefaultTool.FILE_NEW,
		AiHydroDefaultTool.FILE_EDIT,
		AiHydroDefaultTool.SEARCH,
		AiHydroDefaultTool.LIST_FILES,
		AiHydroDefaultTool.LIST_CODE_DEF,
		AiHydroDefaultTool.BROWSER,
		AiHydroDefaultTool.MCP_USE,
		AiHydroDefaultTool.MCP_ACCESS,
		AiHydroDefaultTool.ASK,
		AiHydroDefaultTool.ATTEMPT,
		AiHydroDefaultTool.NEW_TASK,
		AiHydroDefaultTool.PLAN_MODE,
		AiHydroDefaultTool.MCP_DOCS,
		AiHydroDefaultTool.TODO,
	)
	.placeholders({
		MODEL_FAMILY: "generic",
	})
	.config({})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "generic" }, { strict: true })
if (!validationResult.isValid) {
	console.error("Generic variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid generic variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("Generic variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GenericVariantConfig = typeof config
