import type { CallState } from "@shared/aihydro/askOutcome"
import type { AiHydroSayTool } from "@shared/ExtensionMessage"

/**
 * The tool card for the `spawn_subagents` ask: exactly what will run, before anything does. The Run and Deny buttons
 * are the inline approval group below it (no "Always": a launch is asked every time). Everything here comes from the
 * host's own launch descriptor, including the sentence on what the profile cannot do.
 */
export function SubagentLaunchCard({ tool, state }: { tool: AiHydroSayTool; state?: CallState }) {
	const launch = tool.subagents
	if (!launch) {
		return null
	}
	const count = launch.prompts.length
	const minutes = Math.round(launch.budget.wallClockMs / 60_000)
	return (
		<section
			aria-label="Start read-only explorers"
			className="tool-message-card rounded-sm border border-[var(--vscode-editorGroup-border)] px-[10px] py-[8px]"
			data-testid="subagent-launch">
			<div className="chat-row-header">
				<span aria-hidden="true" className="codicon codicon-organization" />
				<span className="font-bold">
					{state === "pending"
						? `Start ${count} read-only explorer${count === 1 ? "" : "s"}`
						: state === "denied"
							? `Did not start ${count} read-only explorer${count === 1 ? "" : "s"}`
							: `Started ${count} read-only explorer${count === 1 ? "" : "s"}`}
				</span>
			</div>
			<ol className="my-[6px] list-decimal pl-[22px]" data-testid="subagent-launch-prompts">
				{launch.prompts.map((prompt, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list shown once
					<li className="ph-no-capture whitespace-pre-wrap break-words" key={index}>
						{prompt}
					</li>
				))}
			</ol>
			<div className="text-[12px] text-[var(--vscode-descriptionForeground)]" data-testid="subagent-launch-limits">
				{launch.limits}
			</div>
			<div className="pt-[2px] text-[12px] text-[var(--vscode-descriptionForeground)]" data-testid="subagent-launch-budget">
				Each uses model {launch.model}, up to {launch.budget.maxToolCalls} tool calls and about {minutes} minutes. Up to 3
				run at once. Any read that needs your approval asks you in the chat, named after the explorer.
			</div>
		</section>
	)
}
