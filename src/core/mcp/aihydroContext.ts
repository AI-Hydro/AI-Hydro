/**
 * Per-call context for ai-hydro MCP tools (ADR-004 amendment, slice 2 P4).
 *
 * Sent two ways for one release: the MCP request `_meta["aihydro/context"]`
 * (preferred) and the legacy hidden `_chat_id` / `_workspace` arguments.
 */
export const AIHYDRO_CONTEXT_META_KEY = "aihydro/context"

/**
 * Which agent made a call, when it was not the main agent. Sent in `_meta["aihydro/context"].agent` for a subagent's
 * MCP calls. The server does not read it yet (it reads only `study_id`, `workspace`, `chat_id` and `client`), so it is
 * NOT sealed into RunRecords until the server does (audit WP-H8): the extension's per-child record is the only place
 * that says which agent made a call. `chat_id` stays the parent's and `client` stays "vscode" on purpose, because
 * evaluation sealing rejects a different client label.
 */
export interface AiHydroAgentIdentity {
	agent_id: string
	parent_agent_id: string
	role: string
}

export interface AiHydroCallContext {
	args: Record<string, unknown> | undefined
	meta: Record<string, unknown>
}

export function buildAiHydroCallContext(
	args: Record<string, unknown> | undefined,
	chatId: string,
	workspaceRoot: string | undefined,
	modelIdReturned?: string,
	projectId?: string,
	agent?: AiHydroAgentIdentity,
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
				// The chat's project (`prj_...`, X1-P1). Meta only: the server reads it from `_meta` and there is no
				// legacy argument for it. Omitted when the chat has no project (older server, or not yet created).
				...(projectId ? { project_id: projectId } : {}),
				// Model id the provider reported actually serving the turn that issued this call (may differ
				// from the requested alias); omitted when the provider does not report one.
				...(modelIdReturned ? { model_id_returned: modelIdReturned } : {}),
				// Present only on a subagent's calls: the main agent's context is byte-identical to before.
				...(agent ? { agent } : {}),
			},
		},
	}
}
