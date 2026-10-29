import type { EmptyRequest } from "@shared/proto/cline/common"
import { ToolsEnvStatus } from "@shared/proto/cline/mcp"
import { ExtensionRegistryInfo } from "@/registry"
import { getToolsEnvController } from "@/core/mcp/toolsEnv/instance"
import { toolsEnvStatusToProto } from "@/core/mcp/toolsEnv/toProto"
import type { Controller } from "../index"

/** Current managed tools environment status ("checking" when the host has not started it yet). */
export async function getToolsEnvStatus(_controller: Controller, _request: EmptyRequest): Promise<ToolsEnvStatus> {
	const tools = getToolsEnvController()
	return tools ? toolsEnvStatusToProto(tools, ExtensionRegistryInfo.version) : ToolsEnvStatus.create({ phase: "checking" })
}
