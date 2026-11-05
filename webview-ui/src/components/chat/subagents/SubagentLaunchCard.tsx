import type { CallState } from "@shared/aihydro/askOutcome"
import type { SubagentLaunch, SubagentLaunchFacts, SubagentSignal } from "@shared/aihydro/subagents"
import type { AiHydroSayTool } from "@shared/ExtensionMessage"

const SIGNAL_WORDS: Record<SubagentSignal, string> = {
	bulk: "many files",
	independent: "separate questions",
	user_asked: "model says you asked",
	independent_check: "independent check",
}

/**
 * The line the host writes under the model's "Why:". Every part is a fact the host computed (or the model's signal word,
 * checked against a closed list), so it reads as the host speaking, apart from the model's own sentence above it.
 */
function hostLine(launch: SubagentLaunch, facts: SubagentLaunchFacts | undefined): string {
	const parts: string[] = [launch.signal ? SIGNAL_WORDS[launch.signal] : "no signal named"]
	if (facts) {
		if (facts.contextUsedPercent !== undefined) {
			parts.push(`Context ${facts.contextUsedPercent}% used`)
		}
		parts.push(`${facts.launchesSoFar} launch${facts.launchesSoFar === 1 ? "" : "es"} so far`)
		parts.push(`${facts.deniedSoFar} denied`)
		parts.push(`${facts.agentsSoFar} of ${facts.maxAgents} agents used`)
		if (facts.readsAsk) {
			parts.push("Reads will ask you")
		}
	}
	return `Signal: ${parts.join(" · ")}`
}

/**
 * The tool card for the `spawn_subagents` ask: exactly what will run, before anything does. The Run and Deny buttons
 * are the inline approval group below it (no "Always": a launch is asked every time). Everything here comes from the
 * host's own launch descriptor, including the sentence on what the profile cannot do. The one line the model wrote
 * ("Why:") is labelled as the model's and sits above the host's own facts; no button depends on either.
 */
export function SubagentLaunchCard({ tool, state }: { tool: AiHydroSayTool; state?: CallState }) {
	const launch = tool.subagents
	if (!launch) {
		return null
	}
	const count = launch.prompts.length
	const noun = (launch.label ?? "subagent").toLowerCase()
	const plural = count === 1 ? "" : "s"
	const minutes = Math.round(launch.budget.wallClockMs / 60_000)
	const taskBudget = launch.taskBudget
	const facts = launch.facts
	return (
		<section
			aria-label={`Start read-only ${noun}s`}
			className="tool-message-card rounded-sm border border-[var(--vscode-editorGroup-border)] px-[10px] py-[8px]"
			data-testid="subagent-launch">
			<div className="chat-row-header">
				<span aria-hidden="true" className="codicon codicon-organization" />
				<span className="font-bold">
					{state === "pending"
						? `Start ${count} read-only ${noun}${plural}`
						: state === "denied"
							? `Did not start ${count} read-only ${noun}${plural}`
							: `Started ${count} read-only ${noun}${plural}`}
				</span>
			</div>
			<div className="pt-[4px] text-[12px]" data-testid="subagent-launch-why">
				<span className="font-bold">Why: </span>
				<span className="ph-no-capture break-words">{launch.purpose ?? "No reason given"}</span>
			</div>
			<div className="pb-[2px] text-[12px] text-[var(--vscode-descriptionForeground)]" data-testid="subagent-launch-signal">
				{hostLine(launch, facts)}
			</div>
			{facts?.singlePromptIndependent && (
				<div className="text-[12px] text-[var(--vscode-descriptionForeground)]" data-testid="subagent-launch-single">
					{`One ${noun}, so nothing runs in parallel.`}
				</div>
			)}
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
			{launch.advisory && (
				<div
					className="pt-[2px] text-[12px] text-[var(--vscode-descriptionForeground)]"
					data-testid="subagent-launch-advisory">
					{launch.advisory}
				</div>
			)}
			<div className="pt-[2px] text-[12px] text-[var(--vscode-descriptionForeground)]" data-testid="subagent-launch-budget">
				Each uses model {launch.model}
				{launch.sameModelAsLead ? " (same model as the lead)" : ""}
				{launch.provider ? ` on ${launch.provider}` : ""}, up to {launch.budget.maxToolCalls} tool calls and about{" "}
				{minutes} minutes. Up to 3 run at once. Any read that needs your approval asks you in the chat, named after the{" "}
				{noun}.
			</div>
			{launch.otherProvider && (
				<div className="pt-[2px] text-[12px]" data-testid="subagent-launch-provider">
					{`The prompts below, and anything the ${noun}${plural} read, go to ${launch.provider ?? "another provider"}, not the provider this chat uses.`}
				</div>
			)}
			{launch.studyBrief && (
				<div
					className="pt-[2px] text-[12px] text-[var(--vscode-descriptionForeground)]"
					data-testid="subagent-launch-brief">
					{`Each ${noun} also gets a short study brief the host read from the server (study, gauge, period, plan). The model did not write it.`}
				</div>
			)}
			{taskBudget && (
				<div
					className="pt-[2px] text-[12px] text-[var(--vscode-descriptionForeground)]"
					data-testid="subagent-launch-task-budget">
					{taskBudget.priced
						? `Each ${noun} stops at $${launch.budget.maxCostUsd.toFixed(2)}. All subagents in this task together stop at $${taskBudget.budgetUsd.toFixed(2)}; ${taskBudget.unpricedChildren > 0 ? "at least " : ""}$${taskBudget.spentUsd.toFixed(2)} used so far. A cap is a stop, not a guarantee: a request already under way when it is reached still finishes, and ${noun}s launched together can each spend before the others are stopped, so the final cost can run over.`
						: `This model has no verified price, so its cost is unknown and the dollar caps ($${launch.budget.maxCostUsd.toFixed(2)} per ${noun}, $${taskBudget.budgetUsd.toFixed(2)} per task) cannot stop it, and the task budget does not apply. The per-${noun} output-token, tool-call and time limits above are the only limits, and the task may start ${facts ? `at most ${facts.maxAgents} agents in all (${facts.agentsSoFar} so far)` : "only a limited number of agents"}.`}
				</div>
			)}
		</section>
	)
}
