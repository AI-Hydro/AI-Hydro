import type { HeaderFacts, LiftedLine } from "@shared/aihydro/transcriptPresenter"

/** "12s", "1m 52s", "1h 5m". Sub-second spans read "<1s": a measured span is never shown as zero. */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000))
	if (total < 1) {
		return "<1s"
	}
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	if (h > 0) {
		return `${h}h ${m}m`
	}
	return m > 0 ? `${m}m ${s}s` : `${s}s`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export interface GroupSummary {
	/** Visible header text, built only from presenter facts. */
	text: string
	/** Accessible name: leads with what ran and what went wrong, then the visible text verbatim. */
	label: string
}

/**
 * The group header. Every part comes from `HeaderFacts` (and the lifted lines' tones for the problem counts), so a
 * fact the messages do not support is absent: cost reads through its honesty label ("no cost recorded", "at least
 * $0.0214"), never a made-up zero; agent time and waiting time are separate; retries, reuse, calls that did not run
 * and revisions are counted rather than folded away.
 */
export function summarizeGroup(facts: HeaderFacts, lifted: readonly LiftedLine[], live: boolean): GroupSummary {
	const errors = lifted.filter((l) => l.tone === "error").length
	const warnings = lifted.filter((l) => l.tone === "warning").length
	const notices = lifted.filter((l) => l.tone === "notice").length

	const parts: string[] = [`${live ? "Working" : "Worked"} ${formatDuration(facts.agentMs)}`]
	if (facts.waitingMs >= 1000) {
		parts.push(`${formatDuration(facts.waitingMs)} waiting for you`)
	}
	if (facts.toolCount > 0) {
		parts.push(plural(facts.toolCount, "tool"))
	}
	if (facts.notRunCount > 0) {
		parts.push(`${facts.notRunCount} not run`)
	}
	if (facts.cost.status !== "none") {
		parts.push(facts.cost.label)
	}
	if (facts.retryCount > 0) {
		parts.push(plural(facts.retryCount, "retry", "retries"))
	}
	if (facts.failedRequestCount > 0) {
		parts.push(`${plural(facts.failedRequestCount, "request")} failed`)
	}
	if (facts.reuseCount > 0) {
		parts.push(`${facts.reuseCount} reused`)
	}
	if (facts.revisionCount > 0) {
		parts.push(plural(facts.revisionCount, "revision"))
	}

	const problems: string[] = []
	if (errors > 0) {
		problems.push(`${errors} failed`)
	}
	if (warnings > 0) {
		problems.push(plural(warnings, "warning"))
	}
	if (notices > 0) {
		problems.push(plural(notices, "notice"))
	}
	const ran =
		facts.toolCount > 0 ? `${live ? "Running" : "Ran"} ${plural(facts.toolCount, "tool")}` : live ? "Working" : "Worked"
	// The accessible name contains the visible summary verbatim (label in name), led by what ran and what went wrong.
	const label = `${[ran, ...problems].join(", ")}. ${parts.join(" · ")}`
	return { text: parts.join(" · "), label }
}
