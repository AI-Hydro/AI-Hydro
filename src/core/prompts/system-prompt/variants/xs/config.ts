import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import { SystemPromptSection } from "../../templates/placeholders"
import { createVariant } from "../variant-builder"
import { validateVariant } from "../variant-validator"
import { xsComponentOverrides } from "./overrides"
import { baseTemplate } from "./template"

// Type-safe variant configuration using the builder pattern
export const config = createVariant(ModelFamily.XS)
	.description("Prompt for models with a small context window.")
	.version(1)
	.tags("local", "xs", "compact")
	.labels({
		stable: 1,
		production: 1,
		advanced: 1,
	})
	.template(baseTemplate)
	.components(
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.RULES,
		SystemPromptSection.ACT_VS_PLAN,
		SystemPromptSection.CLI_SUBAGENTS,
		SystemPromptSection.CAPABILITIES,
		SystemPromptSection.EDITING_FILES,
		SystemPromptSection.OBJECTIVE,
		SystemPromptSection.SYSTEM_INFO,
		SystemPromptSection.USER_INSTRUCTIONS,
	)
	.tools(
		AiHydroDefaultTool.BASH,
		AiHydroDefaultTool.FILE_READ,
		AiHydroDefaultTool.FILE_NEW,
		AiHydroDefaultTool.FILE_EDIT,
		AiHydroDefaultTool.SEARCH,
		AiHydroDefaultTool.LIST_FILES,
		AiHydroDefaultTool.ASK,
		AiHydroDefaultTool.ATTEMPT,
		AiHydroDefaultTool.NEW_TASK,
		AiHydroDefaultTool.PLAN_MODE,
	)
	.placeholders({
		MODEL_FAMILY: ModelFamily.XS,
	})
	.config({})
	.build()

// Apply component overrides after building the base configuration
// This is necessary because the builder pattern doesn't support bulk overrides
Object.assign(config.componentOverrides, xsComponentOverrides)

// Compile-time validation
const validationResult = validateVariant({ ...config, id: "xs" }, { strict: true })
if (!validationResult.isValid) {
	console.error("XS variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid XS variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("XS variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type XsVariantConfig = typeof config
