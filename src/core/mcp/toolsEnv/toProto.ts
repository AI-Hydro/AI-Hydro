import type { ToolsEnvStatus as ProtoToolsEnvStatus } from "@shared/proto/cline/mcp"
import { ToolsEnvStatus as ProtoStatus } from "@shared/proto/cline/mcp"
import type { ToolsEnvStatus } from "@shared/aihydro/toolsEnv"
import type { ToolsEnvController } from "./ToolsEnvController"

export function toolsEnvStatusToProto(controller: ToolsEnvController, extensionVersion: string): ProtoToolsEnvStatus {
	const s: ToolsEnvStatus = controller.getStatus()
	return ProtoStatus.create({
		phase: s.phase,
		healthy: s.healthy,
		version: s.version,
		trust: s.trust,
		trustReason: s.trustReason,
		message: s.message,
		errorCode: s.errorCode,
		venvPath: s.venvPath,
		interpreterPath: s.interpreterPath,
		basePython: s.basePython,
		serverName: s.serverName,
		serverCommand: s.serverCommand,
		requirement: s.requirement,
		extensionVersion,
		diagnostics: controller.diagnostics(),
	})
}
