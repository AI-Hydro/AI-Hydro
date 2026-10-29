import { EmptyRequest } from "@shared/proto/cline/common"
import type { ToolsEnvStatus as ProtoToolsEnvStatus } from "@shared/proto/cline/mcp"
import { emptyToolsEnvStatus, type ToolsEnvPhase, type ToolsEnvStatus, type ToolsTrustVerdict } from "@shared/aihydro/toolsEnv"
import { useEffect, useState } from "react"
import { McpServiceClient } from "@/services/grpc-client"

const PHASES: readonly string[] = ["checking", "ready", "installing", "missing", "unhealthy", "failed", "custom"]
const TRUSTS: readonly string[] = ["trusted", "untrusted", "unregistered"]

export interface ToolsEnvView extends ToolsEnvStatus {
	extensionVersion: string
	diagnostics: string
}

/** Proto message to the shared status shape; unknown enum strings fall back rather than crash the chip. */
export function fromProto(p: Partial<ProtoToolsEnvStatus>): ToolsEnvView {
	return {
		...emptyToolsEnvStatus({
			phase: (PHASES.includes(p.phase ?? "") ? p.phase : "checking") as ToolsEnvPhase,
			healthy: !!p.healthy,
			version: p.version ?? "",
			trust: (TRUSTS.includes(p.trust ?? "") ? p.trust : "unregistered") as ToolsTrustVerdict,
			trustReason: p.trustReason ?? "",
			message: p.message ?? "",
			errorCode: p.errorCode ?? "",
			venvPath: p.venvPath ?? "",
			interpreterPath: p.interpreterPath ?? "",
			basePython: p.basePython ?? "",
			serverName: p.serverName ?? "",
			serverCommand: p.serverCommand ?? "",
			...(p.requirement ? { requirement: p.requirement } : {}),
		}),
		extensionVersion: p.extensionVersion ?? "",
		diagnostics: p.diagnostics ?? "",
	}
}

/** Live tools-environment status from the host. `undefined` until the first message arrives. */
export function useToolsEnvStatus(): ToolsEnvView | undefined {
	const [status, setStatus] = useState<ToolsEnvView | undefined>(undefined)
	useEffect(() => {
		let cancelled = false
		const unsubscribe = McpServiceClient.subscribeToToolsEnvStatus(EmptyRequest.create({}), {
			onResponse: (p) => {
				if (!cancelled) {
					setStatus(fromProto(p))
				}
			},
			onError: (error) => console.error("Error in tools status subscription:", error),
			onComplete: () => {},
		})
		return () => {
			cancelled = true
			unsubscribe?.()
		}
	}, [])
	return status
}
