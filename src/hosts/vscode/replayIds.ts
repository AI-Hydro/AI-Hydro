/** Session (study) and run ids accepted from a webview for opening Replay. The charset the panel operations use. */
export const REPLAY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Both ids, checked. Returns undefined when either is missing or has a character a path or command could use. */
export function validReplayIds(sessionId: unknown, runId: unknown): { sessionId: string; runId: string } | undefined {
	const session = typeof sessionId === "string" ? sessionId : ""
	const run = typeof runId === "string" ? runId : ""
	return REPLAY_ID_PATTERN.test(session) && REPLAY_ID_PATTERN.test(run) ? { sessionId: session, runId: run } : undefined
}
