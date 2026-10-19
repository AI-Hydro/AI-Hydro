import type { HydroCommandResult } from "./mapHydrologyBridge"

/**
 * Collect everything the hydrology search reported as wrong, so the UI can say
 * "USGS lookup incomplete" instead of an empty list that reads as "no results".
 * Accepts the server's `problems` list (strings or {message|code}) plus a failed command.
 */
export function collectHydroSearchProblems(r: HydroCommandResult): string[] {
	const out: string[] = []
	const raw = (r.result as { problems?: unknown } | undefined)?.problems
	if (Array.isArray(raw)) {
		for (const p of raw) {
			if (typeof p === "string" && p.trim()) {
				out.push(p.trim())
			} else if (p && typeof p === "object") {
				const o = p as { message?: unknown; code?: unknown; source?: unknown }
				const text = typeof o.message === "string" ? o.message : typeof o.code === "string" ? o.code : ""
				if (text.trim()) {
					out.push(typeof o.source === "string" && o.source ? `${o.source}: ${text.trim()}` : text.trim())
				}
			}
		}
	}
	if (!r.ok && out.length === 0) {
		out.push(r.error || r.message || "hydrology search failed")
	}
	return out
}
