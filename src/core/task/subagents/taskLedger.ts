import { DEFAULT_MAX_AGENTS_PER_TASK, parseSubagentStatus, type SubagentTaskBudget } from "@shared/aihydro/subagents"

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
 * It also counts the children all earlier spawns started (`maxAgentsPerTask`). That count needs no price, so it is the
 * one task-level cap that holds for a model whose cost is unknown, where the dollar cap cannot fire.
 *
 * The cap is a stop, not a guarantee to the cent: a request in flight when the cap is crossed still finishes and bills.
 * A child whose cost is unknown adds nothing and is counted, so `spentUsd` is a lower bound when `unpricedChildren > 0`.
 */
export class TaskAgentLedger {
	private spent: number
	private unpriced: number
	private started: number
	private launches: number

	constructor(
		readonly budgetUsd: number,
		spentUsd = 0,
		unpricedChildren = 0,
		/** Children the task's earlier spawn calls started. */
		agentsStarted = 0,
		/** Spawn calls the user approved earlier in the task. */
		launchesApproved = 0,
		/** Most children the task may start in all. */
		readonly maxAgents = DEFAULT_MAX_AGENTS_PER_TASK,
	) {
		this.spent = spentUsd
		this.unpriced = unpricedChildren
		this.started = agentsStarted
		this.launches = launchesApproved
	}

	/** The ledger as earlier spawns in this transcript left it. */
	static fromMessages(rows: readonly LedgerRow[], budgetUsd: number, maxAgents = DEFAULT_MAX_AGENTS_PER_TASK): TaskAgentLedger {
		let spent = 0
		let unpriced = 0
		let started = 0
		let launches = 0
		for (const row of rows) {
			if (row.type !== "say" || row.say !== "subagent_status") {
				continue
			}
			launches++
			for (const child of parseSubagentStatus(row.text)?.children ?? []) {
				started++
				if (typeof child.cost === "number") {
					spent += child.cost
				}
				// A child that ran (it used tokens) with no cost, or a cost that is only a lower bound, undercounts.
				if (child.costStatus && (child.tokensIn > 0 || child.tokensOut > 0)) {
					unpriced++
				}
			}
		}
		return new TaskAgentLedger(budgetUsd, spent, unpriced, started, launches, maxAgents)
	}

	get spentUsd(): number {
		return this.spent
	}

	get unpricedChildren(): number {
		return this.unpriced
	}

	get agentsStarted(): number {
		return this.started
	}

	get launchesApproved(): number {
		return this.launches
	}

	/** Children the task may still start; never negative. */
	get agentsRemaining(): number {
		return Math.max(0, this.maxAgents - this.started)
	}

	/** Whether `count` more children fit under `maxAgentsPerTask`. */
	allowsAgents(count: number): boolean {
		return count <= this.agentsRemaining
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

/** The sentence a spawn is told when it would start more children than the task may. */
export function agentCountRefusal(ledger: TaskAgentLedger, requested: number): string {
	return ledger.agentsRemaining === 0
		? `This task has already started ${ledger.agentsStarted} subagents, the most it may (maxAgentsPerTask is ${ledger.maxAgents}). Do the remaining work yourself with your own tools, or ask the user to raise the limit.`
		: `This launch would start ${requested} subagents, but this task may start only ${ledger.agentsRemaining} more (${ledger.agentsStarted} started of ${ledger.maxAgents}, maxAgentsPerTask). Launch fewer, or do the work yourself.`
}

/** `maxAgentsPerTask` from settings: a whole number of children, 0 or more (0 refuses all). Anything else is the default. */
export function resolveMaxAgentsPerTask(value: unknown, fallback = DEFAULT_MAX_AGENTS_PER_TASK): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback
}

/** `agentBudgetUsd` from settings: a finite number of dollars, 0 or more. Anything else falls back to the default. */
export function resolveAgentBudgetUsd(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}
