import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import type { Controller } from ".."

/**
 * Open the standard "Install Learning Pack" flow from the Studio trust bar (the "Install Learning Pack..." button
 * shown on a read-only course copy). It runs the same command as the Command Palette and the Explorer menu: a file
 * picker, then the whole-pack approval dialog (Cancel, Install Once, Trust Publisher and Install). This RPC installs
 * nothing by itself and takes no path or option from the caller, so it cannot be used to install a chosen file.
 */
export async function openInstallLearningPack(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.LearningPacksInstall)
	return Empty.create({})
}
