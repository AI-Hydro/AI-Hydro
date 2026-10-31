import type { AiHydroMessage } from "@shared/ExtensionMessage"

export const ORIGIN_CHIP_TESTID = "subagent-origin"

/** The line above an approval a subagent asked for: whose request it is, and what that explorer is doing. */
export function SubagentOriginChip({ message }: { message: AiHydroMessage }) {
	const origin = message.type === "ask" ? message.subagentOrigin : undefined
	if (!origin) {
		return null
	}
	return (
		<div
			className="flex flex-wrap items-baseline gap-x-[6px] pb-[4px] text-[12px] text-[var(--vscode-descriptionForeground)]"
			data-testid={ORIGIN_CHIP_TESTID}>
			<span className="inline-flex items-center gap-[4px] rounded-sm border border-[var(--vscode-editorGroup-border)] px-[6px] py-[1px] text-[var(--vscode-foreground)]">
				<span aria-hidden="true" className="codicon codicon-organization" />
				From {origin.label} · read-only
			</span>
			{origin.promptHead && <span className="ph-no-capture truncate">{origin.promptHead}</span>}
		</div>
	)
}
