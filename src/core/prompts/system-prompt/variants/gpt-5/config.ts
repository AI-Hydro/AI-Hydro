import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { baseTemplate, rules_template } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.GPT_5)
	.description("Prompt tailored to GPT-5")
	.version(1)
	.tags("gpt", "gpt-5", "advanced", "production")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
		SystemPromptSection.TODO,
		SystemPromptSection.MCP,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.TASK_PROGRESS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.FEEDBACK,
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
		AiHydroDefaultTool.WEB_FETCH,
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
		MODEL_FAMILY: ModelFamily.GPT_5,
	})
	.config({})
	// Override the RULES component with custom template
	.overrideComponent(SystemPromptSection.RULES, {
		template: rules_template,
	})
	.build()

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "gpt-5" }, { strict: true })
if (!validationResult.isValid) {
	console.error("GPT-5 variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid GPT-5 variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("GPT-5 variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type GPT5VariantConfig = typeof config
