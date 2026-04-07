import type { ToggleClineRuleRequest, ToggleClineRules } from "@shared/proto/cline/file"
import type { Controller } from "../index"
import { toggleAiHydroRule } from "./toggleAiHydroRule"

export async function toggleClineRule(controller: Controller, request: ToggleClineRuleRequest): Promise<ToggleClineRules> {
	return toggleAiHydroRule(controller, request)
}
