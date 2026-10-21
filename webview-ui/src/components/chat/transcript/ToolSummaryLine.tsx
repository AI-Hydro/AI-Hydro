import { deriveCallState } from "@shared/aihydro/askOutcome"
import { presentToolCall } from "@shared/aihydro/toolCallPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import type { ReactNode } from "react"
import { usePrefersReducedMotion } from "./usePrefersReducedMotion"

export const isCallMessage = (m: AiHydroMessage): boolean => {
	const kind = m.type === "ask" ? m.ask : m.say
	return kind === "command" || kind === "tool" || kind === "use_mcp_server"
}

type Json = Record<string, unknown>
function parse(text: string | undefined): Json | undefined {
	try {
		const v = JSON.parse(text ?? "")
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined
	} catch {
		return undefined
	}
}
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined)

export interface CallLineModel {
	/** What was called: a tool name, a native action, or "Command". */
	name: string
	/** The target in one short piece of text: a path, a pattern, the command. */
	target?: string
	runId?: string
	refused?: boolean
}

/** "readFile" -> "read file". Generic: no tool names are listed anywhere. */
const humanise = (id: string) =>
	id
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.toLowerCase()

export function describeCall(m: AiHydroMessage, members: readonly AiHydroMessage[]): CallLineModel {
	const kind = m.type === "ask" ? m.ask : m.say
	if (kind === "command") {
		const line = (m.text ?? "").split("\nOutput:")[0].split("\n")[0].trim()
		return { name: "Command", target: line || undefined }
	}
	const o = parse(m.text)
	if (kind === "use_mcp_server") {
		const server = str(o?.serverName) ?? ""
		const tool = str(o?.toolName) ?? str(o?.uri) ?? "MCP call"
		const at = members.findIndex((x) => x.ts === m.ts && x.type === m.type)
		const result = members.slice(at + 1).find((x) => x.say === "mcp_server_response")
		const model = presentToolCall(server, tool, str(o?.arguments), result?.text)
		return {
			name: tool,
			runId: model.runId,
			refused: !!model.refusal,
			target: model.typedArgs[0] ? `${model.typedArgs[0].name}: ${model.typedArgs[0].value}` : undefined,
		}
	}
	const tool = str(o?.tool)
	return {
		name: tool ? humanise(tool) : "Tool call",
		target: str(o?.path) ?? str(o?.filePath) ?? str(o?.regex) ?? str(o?.command) ?? str(o?.url),
	}
}

const STATE_TEXT: Record<string, { icon: string; text: string }> = {
	executed: { icon: "codicon-check", text: "done" },
	approved: { icon: "codicon-check", text: "approved" },
	running: { icon: "codicon-loading", text: "running" },
	failed: { icon: "codicon-error", text: "failed" },
	denied: { icon: "codicon-circle-slash", text: "denied" },
	pending: { icon: "codicon-question", text: "waiting for you" },
	unknown: { icon: "codicon-question", text: "no result recorded" },
}

interface ToolSummaryLineProps {
	message: AiHydroMessage
	/** The group's members (for the result that belongs to an MCP call). */
	members: readonly AiHydroMessage[]
	/** The raw stream, for the call state. */
	allMessages: readonly AiHydroMessage[]
	expanded: boolean
	onToggle: () => void
	panelId: string
	children?: ReactNode
}

/**
 * One line per call inside an expanded group: icon, what, target, and the recorded state in words. The line is a
 * button that reveals the full row (the existing card) beneath it.
 */
export function ToolSummaryLine({ message, members, allMessages, expanded, onToggle, panelId, children }: ToolSummaryLineProps) {
	const reduced = usePrefersReducedMotion()
	const model = describeCall(message, members)
	const state = deriveCallState(message, allMessages)
	const shown = model.refused ? { icon: "codicon-circle-slash", text: "refused" } : (STATE_TEXT[state] ?? STATE_TEXT.unknown)
	return (
		<li className="transcript-call" data-state={state}>
			<button
				aria-controls={panelId}
				aria-expanded={expanded}
				className="transcript-btn transcript-btn-line"
				onClick={onToggle}
				type="button">
				<i aria-hidden className={`codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}`} />
				<span className="transcript-call-name">{model.name}</span>
				{model.target && <span className="transcript-call-target">{model.target}</span>}
				{model.runId && <span className="transcript-call-run">run {model.runId}</span>}
				<span className="transcript-call-state">
					<i
						aria-hidden
						className={`codicon ${shown.icon}${shown.icon === "codicon-loading" && !reduced ? " codicon-modifier-spin" : ""}`}
					/>
					<span>{shown.text}</span>
				</span>
			</button>
			<div hidden={!expanded} id={panelId}>
				{expanded ? children : null}
			</div>
		</li>
	)
}
