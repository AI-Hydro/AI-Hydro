import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import type { Controller } from ".."
import { createInstallFlowGate } from "./openInstallLearningPack"

const gate = createInstallFlowGate()

/**
 * Open an installed Learning Pack from the Studio empty state ("Open an installed course"). It runs the same command
 * as the Command Palette (`aihydro.learningPacks.open`), which resumes the pack at its saved module. It installs
 * nothing and takes no pack id or path from the caller. The debounce keeps a runaway caller from stacking pickers.
 */
export async function openInstalledLearningPack(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await gate(() => vscode.commands.executeCommand(ExtensionRegistryInfo.commands.LearningPacksOpen))
	return Empty.create({})
}
