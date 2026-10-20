import { Boolean } from "@shared/proto/cline/common"
import { isAiHydroCliInstalled } from "@/utils/cli-detector"
import { Controller } from ".."

/**
 * Check if the AI-Hydro CLI is installed. Runs `aihydro version` only when subagents are explicitly enabled.
 * @param controller The controller instance
 * @returns Boolean indicating if CLI is installed
 */
export async function checkCliInstallation(controller: Controller): Promise<Boolean> {
	// Never execute a binary named `aihydro` from PATH unless subagents are explicitly enabled.
	if (!controller.stateManager.getGlobalSettingsKey("subagentsEnabled")) {
		return Boolean.create({ value: false })
	}
	try {
		const isInstalled = await isAiHydroCliInstalled()
		return Boolean.create({ value: isInstalled })
	} catch (error) {
		console.error("Failed to check CLI installation:", error)
		return Boolean.create({ value: false })
	}
}
