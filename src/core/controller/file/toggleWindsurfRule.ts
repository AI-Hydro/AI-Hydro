import type { ToggleWindsurfRuleRequest } from "@shared/proto/cline/file"
import { ClineRulesToggles as AiHydroRulesToggles } from "@shared/proto/cline/file"
import type { Controller } from "../index"

/**
 * Toggles a Windsurf rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Windsurf rule toggles
 */
export async function toggleWindsurfRule(
	controller: Controller,
	request: ToggleWindsurfRuleRequest,
): Promise<AiHydroRulesToggles> {
	const { rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean") {
		console.error("toggleWindsurfRule: Missing or invalid parameters", {
			rulePath,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleWindsurfRule")
	}

	// Update the toggles
	const toggles = controller.stateManager.getWorkspaceStateKey("localWindsurfRulesToggles")
	toggles[rulePath] = enabled
	controller.stateManager.setWorkspaceState("localWindsurfRulesToggles", toggles)

	// Return the toggles directly
	return AiHydroRulesToggles.create({ toggles: toggles })
}
