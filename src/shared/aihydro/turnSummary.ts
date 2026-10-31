import type { AiHydroMessage } from "../ExtensionMessage"
import { extractEvidence, proseForEvidence } from "./evidenceMarkers"

/**
 * "This turn" facts for the answer card: what the recorded messages of the turn say was produced. Counts only; it
 * never states an approval (the card looks claim approval up in the ledger) and never infers success. Pure.
 */
export interface TurnSummary {
	/** Distinct run ids named by a tool result (`_run_id`) or cited in the answer. */
	runIds: string[]
	/** Distinct claim ids named by a tool result (`claim_id`) or cited in the answer. */
	claimIds: string[]
	/** Distinct paths of files the turn wrote (edit or create). */
	filesChanged: string[]
}

const RUN_ID_KEY = /"_run_id"\s*:\s*"([A-Za-z0-9][A-Za-z0-9._-]*)"/g
const CLAIM_ID_KEY = /"claim_id"\s*:\s*"([A-Za-z0-9][A-Za-z0-9._-]*)"/g
/** `[run:<id>]` with no `#path`: it names the run but not the value, so it is not a valid marker (and is never a chip). */
const PATHLESS_RUN = /\[run:([A-Za-z0-9][A-Za-z0-9._-]*)\]/g
const WRITE_TOOLS = new Set(["editedExistingFile", "newFileCreated"])

function collect(text: string | undefined, re: RegExp, into: Set<string>) {
	if (!text) {
		return
	}
	for (const m of text.matchAll(re)) {
		into.add(m[1])
	}
}

/** The turn is the run of messages after the last user message (task or feedback) before `answerTs`. */
export function summarizeTurn(messages: readonly AiHydroMessage[], answerTs: number): TurnSummary {
	let start = 0
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i]
		if (m.ts >= answerTs) {
			break
		}
		if (m.type === "say" && (m.say === "task" || m.say === "user_feedback")) {
			start = i + 1
		}
	}
	const runs = new Set<string>()
	const claims = new Set<string>()
	const files = new Set<string>()
	for (const m of messages.slice(start)) {
		if (m.ts > answerTs) {
			break
		}
		if (m.ts === answerTs) {
			const ev = extractEvidence(m.text)
			ev.runs.forEach((r) => runs.add(r.runId))
			// The answer does name these runs; "no runs or claims" would be false. (They still audit as malformed.)
			collect(proseForEvidence(m.text ?? ""), PATHLESS_RUN, runs)
			ev.claims.forEach((c) => claims.add(c))
			continue
		}
		if (m.type === "say" && m.say === "mcp_server_response") {
			collect(m.text, RUN_ID_KEY, runs)
			collect(m.text, CLAIM_ID_KEY, claims)
		} else if ((m.type === "say" && m.say === "tool") || (m.type === "ask" && m.ask === "tool")) {
			try {
				const t = JSON.parse(m.text ?? "{}")
				if (WRITE_TOOLS.has(t?.tool) && typeof t.path === "string") {
					files.add(t.path)
				}
			} catch {
				/* not a tool payload */
			}
		}
	}
	return { runIds: [...runs], claimIds: [...claims], filesChanged: [...files] }
}
