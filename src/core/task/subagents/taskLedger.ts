import { parseSubagentStatus, type SubagentTaskBudget } from "@shared/aihydro/subagents"

/** Rows of the parent's transcript the ledger reads: only the status rows that earlier spawns left. */
interface LedgerRow {
	type?: string
	say?: string
	text?: string
}

/**
 * What all of a task's subagents have cost, against `agentBudgetUsd` (plan 5.7, D6). One ledger per spawn call, seeded
 * from the `subagent_status` rows earlier calls left in the transcript, so the total survives a resume and no second
 * store can disagree with what the user saw. Children of the current call add to it as they go, so one spawn that
 * overruns stops the others at their next request.
 *
 * The cap is a stop, not a guarantee to the cent: a request in flight when the cap is crossed still finishes and bills.
 * A child whose cost is unknown adds nothing and is counted, so `spentUsd` is a lower bound when `unpricedChildren > 0`.
 */
export class TaskAgentLedger {
	private spent: number
	private unpriced: number

	constructor(
		readonly budgetUsd: number,
		spentUsd = 0,
		unpricedChildren = 0,
	) {
		this.spent = spentUsd
		this.unpriced = unpricedChildren
	}

	/** The ledger as earlier spawns in this transcript left it. */
	static fromMessages(rows: readonly LedgerRow[], budgetUsd: number): TaskAgentLedger {
		let spent = 0
		let unpriced = 0
		for (const row of rows) {
			if (row.type !== "say" || row.say !== "subagent_status") {
				continue
			}
			for (const child of parseSubagentStatus(row.text)?.children ?? []) {
				if (typeof child.cost === "number") {
					spent += child.cost
				}
				// A child that ran (it used tokens) with no cost, or a cost that is only a lower bound, undercounts.
				if (child.costStatus && (child.tokensIn > 0 || child.tokensOut > 0)) {
					unpriced++
				}
			}
		}
		return new TaskAgentLedger(budgetUsd, spent, unpriced)
	}

	get spentUsd(): number {
		return this.spent
	}

	get unpricedChildren(): number {
		return this.unpriced
	}

	/** Dollars left before the cap; never negative. */
	get remainingUsd(): number {
		return Math.max(0, this.budgetUsd - this.spent)
	}

	/** True once the cap is reached. A zero or negative budget means no subagent may run. */
	exceeded(): boolean {
		return this.spent >= this.budgetUsd
	}

	add(usd: number): void {
		if (Number.isFinite(usd) && usd > 0) {
			this.spent += usd
		}
	}

	/** A child ended with an unknown or lower-bound cost. */
	noteUnpriced(): void {
		this.unpriced++
	}

	/** The part the launch card shows. */
	describe(priced: boolean): SubagentTaskBudget {
		return { budgetUsd: this.budgetUsd, spentUsd: this.spent, priced, unpricedChildren: this.unpriced }
	}

	/** The sentence a refused spawn is told. */
	refusal(): string {
		return `The subagent budget for this task is used: $${this.spent.toFixed(2)} of $${this.budgetUsd.toFixed(2)} (agentBudgetUsd). Do the remaining work yourself with your own tools, or ask the user to raise the budget.`
	}
}

/** `agentBudgetUsd` from settings: a finite number of dollars, 0 or more. Anything else falls back to the default. */
export function resolveAgentBudgetUsd(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}
