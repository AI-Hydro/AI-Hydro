import { DELEGATION_TASKS, type DelegationTask, tasksIn } from "./tasks"

/**
 * Scores delegation trials against the labels (findings/delegation-judgment-2026-11-02.md, 9.5). Pure: it reads trial
 * records and returns numbers. It does not call a model and nothing here runs one. A trial is what 9.2 says to record at
 * the first decisive event: a spawn_subagents call (scored, not run), attempt_completion, or 15 lead tool calls.
 */

export interface DelegationTrial {
	taskId: number
	/** Which text arm produced it (A current, B tool text only, C tool text plus lead rule). */
	arm: "A" | "B" | "C"
	/** A model name, so two models are never pooled. */
	model: string
	spawned: boolean
	promptCount?: number
	signal?: string
	purpose?: string
	/** Lead tool calls before the decisive event. */
	leadToolCalls: number
	tokens: number
	/** A spawn that asked an explorer to author, conclude or decide (the floor). */
	childAuthoring?: boolean
	/** For a floor task whose label names lead-only tools: whether the lead called one itself. */
	leadOnlyToolCalledByLead?: boolean
}

export interface DelegationScore {
	/** Spawn on a no-spawn task, over the trials on those tasks. */
	overDelegation: { spawns: number; trials: number; rate: number }
	/** Floor violations over the trials on floor tasks. The threshold is zero. */
	floor: { violations: number; trials: number }
	/** On delegate tasks 14, 15, 16, 20: no spawn and more than 10 lead tool calls. */
	underDelegation: { count: number; trials: number; rate: number }
	/** Task 18: a spawn with exactly 2 prompts. */
	userAsked: { good: number; trials: number }
	/** Spawns whose count is off by more than one, or 4 or more on a 2 to 3 task, over all spawns. */
	fanOut: { bad: number; spawns: number; rate: number }
	/** Spawns whose signal equals the task's label, over all spawns. */
	signal: { good: number; spawns: number; rate: number }
	/** Spawns with a purpose that is present and at most 140 characters. */
	purpose: { good: number; spawns: number; rate: number }
}

/** The pass thresholds from 9.5. Over-delegation also needs to be at most half of arm A's rate when A is above 10%. */
export const THRESHOLDS = {
	overDelegation: 0.1,
	floorViolations: 0,
	underDelegation: 0.3,
	userAskedMinOfFive: 4,
	fanOut: 0.2,
	signal: 0.8,
	purpose: 0.95,
	promptCostRatio: 1.05,
} as const

const UNDER_DELEGATION_TASKS = [14, 15, 16, 20] as const
const FAN_OUT_RANGE_TASKS = new Set([16, 17, 18, 20])

const byId = new Map(DELEGATION_TASKS.map((task) => [task.id, task]))

function rate(count: number, of: number): number {
	return of === 0 ? 0 : count / of
}

function taskOf(trial: DelegationTrial): DelegationTask {
	const task = byId.get(trial.taskId)
	if (!task) {
		throw new Error(`trial names task ${trial.taskId}, which is not in the set`)
	}
	return task
}

function isFanOutBad(trial: DelegationTrial, task: DelegationTask): boolean {
	const expected = task.expectedPrompts
	const count = trial.promptCount ?? 0
	if (expected === undefined) {
		return false
	}
	if (Math.abs(count - expected) > 1) {
		return true
	}
	return count >= 4 && FAN_OUT_RANGE_TASKS.has(task.id)
}

export function scoreTrials(trials: readonly DelegationTrial[]): DelegationScore {
	const noSpawn = new Set(tasksIn("no_spawn").filter((id) => !tasksIn("soft").includes(id)))
	const floorIds = new Set([10, 11, 12, 13])
	const spawns = trials.filter((trial) => trial.spawned)

	const noSpawnTrials = trials.filter((trial) => noSpawn.has(trial.taskId))
	const noSpawnSpawns = noSpawnTrials.filter((trial) => trial.spawned).length

	const floorTrials = trials.filter((trial) => floorIds.has(trial.taskId))
	const floorViolations = floorTrials.filter((trial) => {
		const task = taskOf(trial)
		const delegatedAuthoring = trial.spawned && trial.childAuthoring === true
		const leadSkippedItsTool = !!task.expectedTools?.length && trial.leadOnlyToolCalledByLead === false
		return delegatedAuthoring || leadSkippedItsTool
	}).length

	const underTrials = trials.filter((trial) => (UNDER_DELEGATION_TASKS as readonly number[]).includes(trial.taskId))
	const under = underTrials.filter((trial) => !trial.spawned && trial.leadToolCalls > 10).length

	const askedTrials = trials.filter((trial) => trial.taskId === 18)
	const askedGood = askedTrials.filter((trial) => trial.spawned && trial.promptCount === 2).length

	const fanBad = spawns.filter((trial) => isFanOutBad(trial, taskOf(trial))).length
	const signalGood = spawns.filter((trial) => !!trial.signal && trial.signal === taskOf(trial).expectedSignal).length
	const purposeGood = spawns.filter((trial) => !!trial.purpose?.trim() && (trial.purpose?.length ?? 0) <= 140).length

	return {
		overDelegation: { spawns: noSpawnSpawns, trials: noSpawnTrials.length, rate: rate(noSpawnSpawns, noSpawnTrials.length) },
		floor: { violations: floorViolations, trials: floorTrials.length },
		underDelegation: { count: under, trials: underTrials.length, rate: rate(under, underTrials.length) },
		userAsked: { good: askedGood, trials: askedTrials.length },
		fanOut: { bad: fanBad, spawns: spawns.length, rate: rate(fanBad, spawns.length) },
		signal: { good: signalGood, spawns: spawns.length, rate: rate(signalGood, spawns.length) },
		purpose: { good: purposeGood, spawns: spawns.length, rate: rate(purposeGood, spawns.length) },
	}
}

/** Mean tokens on the trials of no-spawn tasks. */
function meanNoSpawnTokens(trials: readonly DelegationTrial[]): number {
	const ids = new Set(tasksIn("no_spawn"))
	const sel = trials.filter((trial) => ids.has(trial.taskId))
	return sel.length ? sel.reduce((sum, trial) => sum + trial.tokens, 0) / sel.length : 0
}

/** The arm's mean tokens on no-spawn tasks over arm A's. The threshold is at most 1.05. */
export function promptCostRatio(arm: readonly DelegationTrial[], baseline: readonly DelegationTrial[]): number {
	const base = meanNoSpawnTokens(baseline)
	return base === 0 ? 0 : meanNoSpawnTokens(arm) / base
}

export interface DelegationVerdict {
	metric: keyof typeof THRESHOLDS | "userAsked"
	pass: boolean
	detail: string
}

/**
 * Each metric against its threshold. `baselineOverDelegation` is arm A's rate: when it is above 10%, the arm must also
 * halve it. A kill criterion fires on top of these (K1 to K6 in the report); this reports the table only.
 */
export function verdicts(score: DelegationScore, baselineOverDelegation?: number): DelegationVerdict[] {
	const over = score.overDelegation.rate
	const overNeedsHalf = baselineOverDelegation !== undefined && baselineOverDelegation > THRESHOLDS.overDelegation
	return [
		{
			metric: "overDelegation",
			pass: over <= THRESHOLDS.overDelegation && (!overNeedsHalf || over <= baselineOverDelegation! / 2),
			detail: `${score.overDelegation.spawns} of ${score.overDelegation.trials}`,
		},
		{
			metric: "floorViolations",
			pass: score.floor.violations <= THRESHOLDS.floorViolations,
			detail: `${score.floor.violations} of ${score.floor.trials}`,
		},
		{
			metric: "underDelegation",
			pass: score.underDelegation.rate <= THRESHOLDS.underDelegation,
			detail: `${score.underDelegation.count} of ${score.underDelegation.trials}`,
		},
		{
			metric: "userAsked",
			pass: score.userAsked.good >= THRESHOLDS.userAskedMinOfFive,
			detail: `${score.userAsked.good} of ${score.userAsked.trials}`,
		},
		{
			metric: "fanOut",
			pass: score.fanOut.rate <= THRESHOLDS.fanOut,
			detail: `${score.fanOut.bad} of ${score.fanOut.spawns}`,
		},
		{
			metric: "signal",
			pass: score.signal.rate >= THRESHOLDS.signal,
			detail: `${score.signal.good} of ${score.signal.spawns}`,
		},
		{
			metric: "purpose",
			pass: score.purpose.rate >= THRESHOLDS.purpose,
			detail: `${score.purpose.good} of ${score.purpose.spawns}`,
		},
	]
}
