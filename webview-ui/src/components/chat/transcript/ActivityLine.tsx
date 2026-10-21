import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { useEffect, useState } from "react"
import { formatDuration } from "./summary"
import { usePrefersReducedMotion } from "./usePrefersReducedMotion"

interface ActivityLineProps {
	/** What the live tail is doing, from the messages: a running call, or a request in flight. */
	activity: { kind: "running"; name: string; sinceTs: number } | { kind: "thinking" } | { kind: "working" }
}

/**
 * The live line under an open group: "Running <tool> · 12 s" or "Thinking…". Under prefers-reduced-motion the
 * spinner does not turn and the elapsed time is not ticked (it shows the value at the last render). Not a live
 * region: assistive-technology status goes through the one throttled region (TranscriptStatus).
 */
export function ActivityLine({ activity }: ActivityLineProps) {
	const reduced = usePrefersReducedMotion()
	const [now, setNow] = useState(() => Date.now())
	const ticking = activity.kind === "running" && !reduced
	useEffect(() => {
		if (!ticking) {
			return
		}
		const id = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(id)
	}, [ticking])

	const text =
		activity.kind === "running"
			? `Running ${activity.name} · ${formatDuration(Math.max(0, now - activity.sinceTs))}`
			: activity.kind === "thinking"
				? "Thinking…"
				: "Working…"
	return (
		<div className="transcript-line transcript-activity" data-testid="transcript-activity">
			<i aria-hidden className={`codicon codicon-loading${reduced ? "" : " codicon-modifier-spin"}`} />
			<span>{text}</span>
		</div>
	)
}

/** What a group's live tail is doing, derived from its last members. */
export function liveActivity(
	members: readonly AiHydroMessage[],
	isRunningCall: (m: AiHydroMessage) => boolean,
	nameOf: (m: AiHydroMessage) => string,
): ActivityLineProps["activity"] {
	for (let i = members.length - 1; i >= 0; i--) {
		const m = members[i]
		if (m.say === "api_req_started") {
			let finished = false
			try {
				const info = JSON.parse(m.text ?? "{}")
				finished = typeof info.cost === "number" || info.cancelReason != null
			} catch {
				// unparseable request info: treat as in flight
			}
			return finished ? { kind: "working" } : { kind: "thinking" }
		}
		if ((m.say === "tool" || m.say === "command" || m.say === "use_mcp_server" || m.type === "ask") && isRunningCall(m)) {
			return { kind: "running", name: nameOf(m), sinceTs: m.ts }
		}
		if (m.say === "reasoning") {
			return { kind: "thinking" }
		}
	}
	return { kind: "working" }
}
