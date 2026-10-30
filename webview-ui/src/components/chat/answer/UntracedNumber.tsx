import React, { createContext, useId, useState } from "react"
import { RunChip } from "../RunChip"
import { runHintText, type UntracedPlan } from "./auditFindings"

/** The numbers the audit could not trace, provided by the answer card to the markdown inside it. */
export const UntracedPlanContext = createContext<UntracedPlan | undefined>(undefined)

/** Stable string for a plan, so a change of findings re-renders the prose. */
export const planKey = (plan: UntracedPlan | undefined): string =>
	plan
		? [...plan.entries()]
				.map(([q, ts]) => `${q}:${ts.map((t) => `${t.status}|${t.runHint?.runId ?? ""}`).join(",")}`)
				.join(";")
		: ""

interface Props {
	status: string
	runId?: string
	jsonPath?: string
	children?: React.ReactNode
}

/**
 * A number in the answer prose that the audit could not trace. A subtle dotted underline; hover or keyboard focus
 * opens a short note ("Not linked to a run", and the run it likely came from). The accessible description is always
 * present, so a screen reader hears it on focus without opening anything. Linking the number is the agent's job.
 */
export const UntracedNumber: React.FC<Props> = ({ status, runId, jsonPath, children }) => {
	const [open, setOpen] = useState(false)
	const id = useId()
	const hint = runId ? runHintText({ runId, jsonPath: jsonPath ?? "" }) : undefined
	const description = hint ? `${status}. ${hint}.` : `${status}.`
	return (
		<span
			className="relative inline"
			data-testid="untraced-number"
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
					setOpen(false)
				}
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape" && open) {
					e.stopPropagation()
					setOpen(false)
				}
			}}
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}>
			<span
				aria-describedby={id}
				onFocus={() => setOpen(true)}
				role="note"
				style={{
					textDecorationLine: "underline",
					textDecorationStyle: "dotted",
					textDecorationColor: "var(--vscode-editorWarning-foreground)",
					textUnderlineOffset: 3,
					cursor: "help",
				}}
				tabIndex={0}>
				{children}
			</span>
			<span className="sr-only" id={id}>
				{description}
			</span>
			{open && (
				<span
					className="absolute z-50 left-0 top-full mt-1 w-60 max-w-[80vw] rounded-md shadow-lg p-2 text-xs leading-snug font-normal"
					style={{
						background: "var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background))",
						border: "1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border))",
						color: "var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground))",
						whiteSpace: "normal",
					}}>
					<span className="block">{status}</span>
					{hint && runId && (
						<span className="block mt-1">
							{hint}
							<RunChip jsonPath={jsonPath ?? ""} runId={runId} variant="inline" />
						</span>
					)}
				</span>
			)}
		</span>
	)
}
