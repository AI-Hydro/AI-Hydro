/** The host replays recent events on every (re)subscribe, so an agent command must be acted on once per event. */
export function claimAgentCommand(
	seen: Set<string>,
	event: { type?: string; timestampMs?: number; payloadJson?: string },
): boolean {
	const key = `${event.type}:${event.timestampMs ?? 0}:${event.payloadJson ?? ""}`
	if (seen.has(key)) return false
	seen.add(key)
	return true
}

export function escapeHtml(value: unknown): string {
	return String(value ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}
