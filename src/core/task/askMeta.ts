import type { SubagentOrigin } from "@shared/aihydro/subagents"
import type { AiHydroMessage } from "@shared/ExtensionMessage"

/**
 * Host-supplied facts about who raised an ask. Only the host's own code passes this (the parent-ask bridge for a
 * subagent); it is never read from model output or a webview message.
 */
export interface AskMeta {
	subagentOrigin?: SubagentOrigin
}

/** The fields of an ask message that `meta` contributes. Empty for an ordinary ask. */
export function askMessageMeta(meta: AskMeta | undefined): Pick<AiHydroMessage, "subagentOrigin"> {
	return meta?.subagentOrigin ? { subagentOrigin: meta.subagentOrigin } : {}
}
