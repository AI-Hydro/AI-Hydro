import { type ToolsEnvAction } from "@shared/aihydro/toolsEnv"
import { ToolsEnvActionRequest, ToolsEnvStatus } from "@shared/proto/cline/mcp"
import { getToolsEnvController } from "@/core/mcp/toolsEnv/instance"
import { toolsEnvStatusToProto } from "@/core/mcp/toolsEnv/toProto"
import { ExtensionRegistryInfo } from "@/registry"
import type { Controller } from "../index"

const ACTIONS: ReadonlySet<string> = new Set<ToolsEnvAction>([
	"install",
	"repair",
	"retry",
	"cancel",
	"showLog",
	"trust",
	"copyDiagnostics",
	"useManaged",
])
/** Long-running: the webview follows the status stream instead of waiting on the RPC. */
const BACKGROUND: ReadonlySet<string> = new Set(["install", "repair", "retry", "useManaged"])

/**
 * Run a chip action. "trust" only re-shows the host's modal confirmation (the webview cannot trust a launcher by
 * itself), so a compromised or confused webview cannot widen trust.
 */
export async function runToolsEnvAction(controller: Controller, request: ToolsEnvActionRequest): Promise<ToolsEnvStatus> {
	const tools = getToolsEnvController()
	if (!tools) {
		return ToolsEnvStatus.create({ phase: "checking" })
	}
	if (ACTIONS.has(request.action)) {
		const run = tools.runAction(request.action as ToolsEnvAction).catch((error) => {
			console.error(`Tools action ${request.action} failed:`, error)
		})
		if (!BACKGROUND.has(request.action)) {
			await run
		}
		// The dialog was confirmed: apply it everywhere now (auto-run grants, the study chip), no reload.
		if (request.action === "trust" && tools.getStatus().trust === "trusted") {
			await controller.onFirstPartyTrustConfirmed().catch((error) => console.error("Trust refresh failed:", error))
		}
	}
	return toolsEnvStatusToProto(tools, ExtensionRegistryInfo.version)
}
