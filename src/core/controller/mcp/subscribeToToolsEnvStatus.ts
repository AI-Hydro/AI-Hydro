import type { EmptyRequest } from "@shared/proto/cline/common"
import { ToolsEnvStatus } from "@shared/proto/cline/mcp"
import { ExtensionRegistryInfo } from "@/registry"
import { getToolsEnvController } from "@/core/mcp/toolsEnv/instance"
import { toolsEnvStatusToProto } from "@/core/mcp/toolsEnv/toProto"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"

/** Stream the tools status: the current value first, then every change. */
export async function subscribeToToolsEnvStatus(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ToolsEnvStatus>,
	requestId?: string,
): Promise<void> {
	const tools = getToolsEnvController()
	if (!tools) {
		await responseStream(ToolsEnvStatus.create({ phase: "checking" }), false)
		return
	}
	const send = () =>
		responseStream(toolsEnvStatusToProto(tools, ExtensionRegistryInfo.version), false).catch((error) => {
			console.error("Error sending tools status:", error)
		})
	const subscription = tools.onDidChange(() => void send())
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			() => subscription.dispose(),
			{ type: "toolsEnvStatus_subscription" },
			responseStream,
		)
	}
	await send()
}
