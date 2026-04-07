/**
 * Enhanced Type-Safe Variant Configuration Template
 *
 * This template provides a type-safe way to create new prompt variants
 * with compile-time validation and IntelliSense support.
 *
 * Usage:
 * 1. Copy this file to variants/{variant-name}/config.ts
 * 2. Replace the placeholder values with your variant configuration
 * 3. Use the builder pattern for type safety
 * 4. Run validation to ensure correctness
 */
import { ModelFamily } from "@/shared/prompts"
import { AiHydroDefaultTool } from "@/shared/tools"
import { PromptVariant } from ".."
import { SystemPromptSection } from "../templates/placeholders"
import { baseTemplate } from "./generic/template"
import { createVariant } from "./variant-builder"
import { validateVariant } from "./variant-validator"

// Type-safe variant configuration using the builder pattern
export const config: Omit<PromptVariant, "id"> = createVariant(ModelFamily.GENERIC) // Change to your target model family
	.description("Brief description of this variant and its intended use case")
	.version(1)
	.tags("production", "stable") // Add relevant tags
	.labels({
		stable: 1,
		production: 1,
	})
	.template(baseTemplate)
	.components(
		// Define component order - this is type-safe and will show available options
		SystemPromptSection.AGENT_ROLE,
		SystemPromptSection.TOOL_USE,
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
		// Define tool order - this is type-safe and will show available options.
		// If a tool is listed here but no variant was registered, it will fall back to the generic variant.
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
		MODEL_FAMILY: "your-model-family", // Replace with appropriate model family
	})
	.config({
		// Add any model-specific configuration
		// modelName: "your-model-name",
		// temperature: 0.7,
		// maxTokens: 4096,
	})
	// Optional: Override specific components
	// .overrideComponent(SystemPromptSection.RULES, {
	//     template: customRulesTemplate,
	// })
	// Optional: Override specific tools
	// .overrideTool(AiHydroDefaultTool.BASH, {
	//     enabled: false,
	// })
	.build()

// Compile-time validation (optional but recommended)
const validationResult = validateVariant({ ...config, id: "template" }, { strict: true })
if (!validationResult.isValid) {
	console.error("Variant configuration validation failed:", validationResult.errors)
	throw new Error(`Invalid variant configuration: ${validationResult.errors.join(", ")}`)
}

if (validationResult.warnings.length > 0) {
	console.warn("Variant configuration warnings:", validationResult.warnings)
}

// Export type information for better IDE support
export type VariantConfig = typeof config

/**
 * Type-safe helper functions for common variant patterns
 */

// Minimal variant for lightweight models
export const createMinimalVariant = (family: ModelFamily) =>
	createVariant(family)
		.description("Minimal variant for lightweight models")
		.components(
			SystemPromptSection.AGENT_ROLE,
			SystemPromptSection.TOOL_USE,
			SystemPromptSection.RULES,
			SystemPromptSection.SYSTEM_INFO,
		)
		.tools(AiHydroDefaultTool.FILE_READ, AiHydroDefaultTool.FILE_NEW, AiHydroDefaultTool.ATTEMPT)

// Full-featured variant for advanced models
export const createAdvancedVariant = (family: ModelFamily) =>
	createVariant(family)
		.description("Full-featured variant for advanced models")
		.components(
			SystemPromptSection.AGENT_ROLE,
			SystemPromptSection.TOOL_USE,
			SystemPromptSection.MCP,
			SystemPromptSection.EDITING_FILES,
			SystemPromptSection.ACT_VS_PLAN,
			SystemPromptSection.CLI_SUBAGENTS,
			SystemPromptSection.TODO,
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
