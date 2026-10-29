import { type ToolsEnvAction } from "@shared/aihydro/toolsEnv"
import { ToolsEnvActionRequest, ToolsEnvStatus } from "@shared/proto/cline/mcp"
import { ExtensionRegistryInfo } from "@/registry"
import { getToolsEnvController } from "@/core/mcp/toolsEnv/instance"
import { toolsEnvStatusToProto } from "@/core/mcp/toolsEnv/toProto"
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
export async function runToolsEnvAction(_controller: Controller, request: ToolsEnvActionRequest): Promise<ToolsEnvStatus> {
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
	}
	return toolsEnvStatusToProto(tools, ExtensionRegistryInfo.version)
}
