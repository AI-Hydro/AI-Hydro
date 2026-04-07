import { isMultiRootWorkspace } from "@/core/workspace/utils/workspace-detection"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/cline/common"

// Canonical header names for extra client/host context
export const AiHydroHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const
export type AiHydroHeaderName = (typeof AiHydroHeaders)[keyof typeof AiHydroHeaders]

export async function buildAiHydroExtraHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {}
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[AiHydroHeaders.PLATFORM] = host.platform || "unknown"
		headers[AiHydroHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[AiHydroHeaders.CLIENT_TYPE] = host.clineType || "unknown"
		headers[AiHydroHeaders.CLIENT_VERSION] = host.clineVersion || "unknown"
	} catch (error) {
		console.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[AiHydroHeaders.PLATFORM] = "unknown"
		headers[AiHydroHeaders.PLATFORM_VERSION] = "unknown"
		headers[AiHydroHeaders.CLIENT_TYPE] = "unknown"
		headers[AiHydroHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[AiHydroHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	try {
		const isMultiRoot = await isMultiRootWorkspace()
		headers[AiHydroHeaders.IS_MULTIROOT] = isMultiRoot ? "true" : "false"
	} catch (error) {
		console.log("Failed to detect multi-root workspace", error)
		headers[AiHydroHeaders.IS_MULTIROOT] = "false"
	}

	return headers
}
