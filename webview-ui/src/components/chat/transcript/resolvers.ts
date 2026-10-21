import { effectClass } from "@shared/aihydro/mcpEffectClass"
import { isUnderProtectedRoots } from "@shared/aihydro/protectedPathMatch"
import type { PresentOptions } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import type { McpServer } from "@shared/mcp"

/**
 * The two facts a message does not carry (see PresentOptions): the effect class of an MCP call, and whether a path
 * is protected. Both feed the presenter's lifting rule, so both fail toward "lift":
 *  - effect class is read from tool annotations ONLY for a server the host reports as trusted (`server.trust`, the
 *    verdict of isServerTrusted). An untrusted, unknown or disabled server answers UNKNOWN, so its self-declared
 *    readOnlyHint can never fold a call into a group;
 *  - protected paths come from the host-computed root list in the extension state; see protectedPathMatch.ts.
 */
export function makeTranscriptResolvers(
	mcpServers: readonly McpServer[],
	protectedRoots: readonly string[],
): Pick<PresentOptions, "effectClassFor" | "isProtectedPath"> {
	return {
		effectClassFor: (message: AiHydroMessage) => {
			const kind = message.type === "ask" ? message.ask : message.say
			if (kind !== "use_mcp_server") {
				return undefined
			}
			let call: { serverName?: unknown; toolName?: unknown } = {}
			try {
				call = JSON.parse(message.text ?? "{}") ?? {}
			} catch {
				return "UNKNOWN"
			}
			const server = mcpServers.find((s) => s.name === call.serverName)
			if (!server || server.disabled || server.trust?.trusted !== true) {
				return "UNKNOWN"
			}
			const tool = server.tools?.find((t) => t.name === call.toolName)
			return tool ? effectClass(tool.annotations) : "UNKNOWN"
		},
		isProtectedPath: (path: string) => isUnderProtectedRoots(path, protectedRoots),
	}
}
