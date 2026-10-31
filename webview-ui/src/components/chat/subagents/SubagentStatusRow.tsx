import { parseSubagentStatus, type SubagentChildSummary } from "@shared/aihydro/subagents"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { useId, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { STATUS_ICON, statusLabel, usageLine } from "./subagentText"

export const SUBAGENT_STATUS_TESTID = "subagent-status"

const NEEDS_YOU = "var(--vscode-editorWarning-foreground)"

function ChildLine({ child, interrupted }: { child: SubagentChildSummary; interrupted: boolean }) {
	const [open, setOpen] = useState(false)
	const detailId = useId()
	// A row the host never finished (the window was closed mid-run) must not keep claiming that work is going on.
	const live = child.status === "running" || child.status === "waiting" || child.status === "queued"
	const stale = interrupted && live
	const attention = child.status === "waiting" && !stale
	const calls = child.calls ?? []
	return (
		<li className="flex flex-col" data-status={child.status} data-testid="subagent-child">
			<button
				aria-controls={detailId}
				aria-expanded={open}
				className="flex min-h-[24px] w-full flex-wrap items-center gap-x-[6px] gap-y-0 bg-transparent text-left text-[var(--vscode-foreground)] border-0 py-[2px] cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)]"
				onClick={() => setOpen((value) => !value)}
				type="button">
				<span
					aria-hidden="true"
					className={`codicon codicon-chevron-${open ? "down" : "right"} text-[12px] opacity-70`}
				/>
				<span
					aria-hidden="true"
					className={`codicon codicon-${stale ? "debug-disconnect" : STATUS_ICON[child.status]}`}
					style={attention ? { color: NEEDS_YOU } : undefined}
				/>
				<span className="shrink-0 whitespace-nowrap font-semibold">{child.label}</span>
				<span className="min-w-0" style={attention ? { color: NEEDS_YOU } : undefined}>
					{stale ? "Interrupted: the task was closed before this finished" : statusLabel(child)}
				</span>
				{child.lastTool && child.status === "running" && !stale && (
					<span className="max-w-[12em] truncate opacity-70" title={child.lastTool}>
						{child.lastTool}
					</span>
				)}
				<span className="ml-auto whitespace-nowrap pl-[24px] text-[12px] opacity-70">{usageLine(child)}</span>
			</button>
			{open && (
				<div className="pl-[34px] pb-[4px] text-[12px] text-[var(--vscode-descriptionForeground)]" id={detailId}>
					<div className="ph-no-capture">{child.promptHead}</div>
					{calls.length === 0 ? (
						<div>No tool calls yet.</div>
					) : (
						<ol className="m-0 list-decimal pl-[18px]" data-testid="subagent-calls">
							{calls.map((call, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: an append-only list of calls
								<li key={index}>
									{call.tool ?? call.name}
									{call.result === "ok" ? "" : ` (${call.result})`}
								</li>
							))}
						</ol>
					)}
					{child.recordPath && <div className="ph-no-capture">Record: {child.recordPath}</div>}
				</div>
			)}
		</li>
	)
}

/**
 * One row per spawn call, never folded (the presenter passes it through). It is rewritten in place by the host, so
 * this component is a pure function of the row's text. Read-only: Stop is the composer's, and a child's approval is
 * answered on the approval card in the chat, not here.
 */
export function SubagentStatusRow({ message }: { message: AiHydroMessage }) {
	const { aihydroMessages } = useExtensionState()
	const payload = parseSubagentStatus(message.text)
	if (!payload) {
		return null
	}
	// Unfinished, and a resume row came after it: the task was reopened, so nothing here is still running.
	const interrupted =
		!payload.done &&
		(aihydroMessages ?? []).some((m) => m.ts > message.ts && (m.ask === "resume_task" || m.ask === "resume_completed_task"))
	const active = interrupted
		? 0
		: payload.children.filter(
				(child) => child.status === "running" || child.status === "waiting" || child.status === "queued",
			).length
	return (
		<section
			aria-label="Read-only explorers"
			className="my-[4px] rounded-sm border border-[var(--vscode-editorGroup-border)] bg-[var(--vscode-editor-background)] px-[8px] py-[6px] text-[13px]"
			data-testid={SUBAGENT_STATUS_TESTID}>
			<div className="flex items-center gap-[6px] pb-[2px] text-[12px] text-[var(--vscode-descriptionForeground)]">
				<span aria-hidden="true" className="codicon codicon-organization" />
				<span>
					{payload.children.length === 0
						? "Starting explorers"
						: `${payload.children.length} read-only explorer${payload.children.length === 1 ? "" : "s"}`}
					{payload.done ? " · finished" : interrupted ? " · interrupted" : active ? ` · ${active} active` : ""}
				</span>
			</div>
			<ul aria-label="Explorers" className="m-0 flex list-none flex-col p-0">
				{payload.children.map((child) => (
					<ChildLine child={child} interrupted={interrupted} key={child.childId} />
				))}
			</ul>
		</section>
	)
}
