import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import type { Controller } from ".."

/** Minimum gap between two accepted calls. The flow opens a modal picker, so a second call within it is noise. */
export const INSTALL_FLOW_MIN_GAP_MS = 2000

/**
 * Host-side debounce: a call while the flow is open, or within the gap after the last accepted call, is dropped.
 * Defence in depth behind the webview's real-click requirement; it keeps a runaway caller from stacking dialogs.
 */
export function createInstallFlowGate(now: () => number = Date.now, minGapMs = INSTALL_FLOW_MIN_GAP_MS) {
	let lastAccepted = Number.NEGATIVE_INFINITY
	let open = false
	return async function run(flow: () => PromiseLike<unknown>): Promise<boolean> {
		const at = now()
		if (open || at - lastAccepted < minGapMs) return false
		lastAccepted = at
		open = true
		try {
			await flow()
		} finally {
			open = false
		}
		return true
	}
}

const gate = createInstallFlowGate()

/**
 * Open the standard "Install Learning Pack" flow from the Studio trust bar (the "Install Learning Pack..." button
 * shown on a read-only course copy). It runs the same command as the Command Palette and the Explorer menu: a file
 * picker, then the whole-pack approval dialog (Cancel, Install Once, Trust Publisher and Install). This RPC installs
 * nothing by itself and takes no path or option from the caller, so it cannot be used to install a chosen file.
 */
export async function openInstallLearningPack(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await gate(() => vscode.commands.executeCommand(ExtensionRegistryInfo.commands.LearningPacksInstall))
	return Empty.create({})
}
