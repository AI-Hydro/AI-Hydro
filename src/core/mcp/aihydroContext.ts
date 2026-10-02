/**
 * Per-call context for ai-hydro MCP tools (ADR-004 amendment, slice 2 P4).
 *
 * Sent two ways for one release: the MCP request `_meta["aihydro/context"]`
 * (preferred) and the legacy hidden `_chat_id` / `_workspace` arguments.
 */
export const AIHYDRO_CONTEXT_META_KEY = "aihydro/context"

export interface AiHydroCallContext {
	args: Record<string, unknown> | undefined
	meta: Record<string, unknown>
}

export function buildAiHydroCallContext(
	args: Record<string, unknown> | undefined,
	chatId: string,
	workspaceRoot: string | undefined,
): AiHydroCallContext {
	return {
		args: {
			...(args ?? {}),
			_chat_id: chatId,
			...(workspaceRoot ? { _workspace: workspaceRoot } : {}),
		},
		meta: {
			[AIHYDRO_CONTEXT_META_KEY]: {
				chat_id: chatId,
				...(workspaceRoot ? { workspace: workspaceRoot } : {}),
				client: "vscode",
			},
		},
	}
}
