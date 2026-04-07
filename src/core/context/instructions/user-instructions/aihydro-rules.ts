import { getRuleFilesTotalContent, synchronizeRuleToggles } from "@core/context/instructions/user-instructions/rule-helpers"
import { formatResponse } from "@core/prompts/responses"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { AiHydroRulesToggles } from "@shared/aihydro-rules"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"

export const getGlobalAiHydroRules = async (globalAiHydroRulesFilePath: string, toggles: AiHydroRulesToggles) => {
	if (await fileExistsAtPath(globalAiHydroRulesFilePath)) {
		if (await isDirectory(globalAiHydroRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalAiHydroRulesFilePath)
				const rulesFilesTotalContent = await getRuleFilesTotalContent(rulesFilePaths, globalAiHydroRulesFilePath, toggles)
				if (rulesFilesTotalContent) {
					const aihydroRulesFileInstructions = formatResponse.aihydroRulesGlobalDirectoryInstructions(
						globalAiHydroRulesFilePath,
						rulesFilesTotalContent,
					)
					return aihydroRulesFileInstructions
				}
			} catch {
				console.error(`Failed to read .aihydrorules directory at ${globalAiHydroRulesFilePath}`)
			}
		} else {
			console.error(`${globalAiHydroRulesFilePath} is not a directory`)
			return undefined
		}
	}

	return undefined
}

export const getLocalAiHydroRules = async (cwd: string, toggles: AiHydroRulesToggles) => {
	const aihydroRulesFilePath = path.resolve(cwd, GlobalFileNames.aihydroRules)

	let aihydroRulesFileInstructions: string | undefined

	if (await fileExistsAtPath(aihydroRulesFilePath)) {
		if (await isDirectory(aihydroRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(aihydroRulesFilePath, [[".aihydrorules", "workflows"]])

				const rulesFilesTotalContent = await getRuleFilesTotalContent(rulesFilePaths, cwd, toggles)
				if (rulesFilesTotalContent) {
					aihydroRulesFileInstructions = formatResponse.aihydroRulesLocalDirectoryInstructions(
						cwd,
						rulesFilesTotalContent,
					)
				}
			} catch {
				console.error(`Failed to read .aihydrorules directory at ${aihydroRulesFilePath}`)
			}
		} else {
			try {
				if (aihydroRulesFilePath in toggles && toggles[aihydroRulesFilePath] !== false) {
					const ruleFileContent = (await fs.readFile(aihydroRulesFilePath, "utf8")).trim()
					if (ruleFileContent) {
						aihydroRulesFileInstructions = formatResponse.aihydroRulesLocalFileInstructions(cwd, ruleFileContent)
					}
				}
			} catch {
				console.error(`Failed to read .aihydrorules file at ${aihydroRulesFilePath}`)
			}
		}
	}

	return aihydroRulesFileInstructions
}

export async function refreshAiHydroRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: AiHydroRulesToggles
	localToggles: AiHydroRulesToggles
}> {
	// Global toggles
	const globalAiHydroRulesToggles = controller.stateManager.getGlobalSettingsKey("globalAiHydroRulesToggles")
	const globalAiHydroRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalAiHydroRulesFilePath, globalAiHydroRulesToggles)
	controller.stateManager.setGlobalState("globalAiHydroRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localAiHydroRulesToggles = controller.stateManager.getWorkspaceStateKey("localAiHydroRulesToggles")
	const localAiHydroRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.aihydroRules)
	const updatedLocalToggles = await synchronizeRuleToggles(localAiHydroRulesFilePath, localAiHydroRulesToggles, "", [
		[".aihydrorules", "workflows"],
	])
	controller.stateManager.setWorkspaceState("localAiHydroRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
