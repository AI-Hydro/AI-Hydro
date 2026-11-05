import { expect } from "chai"
import { describe, it } from "mocha"
import { type DelegationTrial, promptCostRatio, scoreTrials, THRESHOLDS, verdicts } from "../scorer"
import { DELEGATION_TASKS, tasksIn } from "../tasks"

/**
 * The scripted tier of the delegation eval: it proves the scorer, with no model and no key. For each task it plays the
 * correct decision and a planted wrong one, and requires the score to report exactly the planted errors. Nothing here
 * says how any model behaves. The real tier is not run (findings/delegation-judgment-2026-11-02.md, 9.1).
 */

/** The decision each task's label expects, as a trial. */
function correct(taskId: number, repeat: number): DelegationTrial {
	const task = DELEGATION_TASKS.find((t) => t.id === taskId)!
	const base = { taskId, arm: "C" as const, model: `m${repeat}`, leadToolCalls: 3, tokens: 1000 }
	switch (task.expected) {
		case "one":
		case "parallel":
			return {
				...base,
				spawned: true,
				promptCount: task.expectedPrompts,
				signal: task.expectedSignal,
				purpose: "Find where it is handled so the main task stays short.",
			}
		case "floor":
			return { ...base, spawned: false, leadOnlyToolCalledByLead: task.expectedTools ? true : undefined }
		default:
			return { ...base, spawned: false }
	}
}

function allCorrect(): DelegationTrial[] {
	return DELEGATION_TASKS.flatMap((task) => [0, 1, 2, 3, 4].map((r) => correct(task.id, r)))
}

describe("delegation eval set", () => {
	it("has the 22 labelled tasks in the groups the report counts", () => {
		expect(DELEGATION_TASKS).to.have.length(22)
		expect(DELEGATION_TASKS.map((t) => t.id)).to.deep.equal(Array.from({ length: 22 }, (_, i) => i + 1))
		expect(tasksIn("no_spawn")).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 19])
		expect(tasksIn("floor")).to.deep.equal([10, 11, 12, 13])
		expect(tasksIn("delegate")).to.deep.equal([14, 15, 16, 18, 20])
		expect(tasksIn("soft")).to.deep.equal([11, 17, 21, 22])
		expect(DELEGATION_TASKS.filter((t) => t.set === "holdout").map((t) => t.id)).to.deep.equal([3, 7, 9, 12, 17, 19])
	})

	it("every task states its label, what else is accepted and what it tests", () => {
		for (const task of DELEGATION_TASKS) {
			expect(task.user.length, `task ${task.id}`).to.be.greaterThan(5)
			expect(task.trap.length, `task ${task.id}`).to.be.greaterThan(2)
			expect(task.alsoAccepted.length, `task ${task.id}`).to.be.greaterThan(2)
			if (task.expected === "one" || task.expected === "parallel") {
				expect(task.expectedPrompts, `task ${task.id}`).to.be.a("number")
				expect(task.expectedSignal, `task ${task.id}`).to.be.a("string")
			}
		}
	})

	it("a run that plays every label scores clean, and every verdict passes", () => {
		const score = scoreTrials(allCorrect())
		expect(score.overDelegation).to.deep.include({ spawns: 0, trials: 65 })
		expect(score.floor).to.deep.equal({ violations: 0, trials: 20 })
		expect(score.underDelegation.count).to.equal(0)
		expect(score.userAsked).to.deep.equal({ good: 5, trials: 5 })
		expect(score.fanOut.bad).to.equal(0)
		expect(score.signal.rate).to.equal(1)
		expect(score.purpose.rate).to.equal(1)
		expect(verdicts(score).every((v) => v.pass)).to.equal(true)
	})

	it("reports exactly the planted errors and no others", () => {
		const trials = allCorrect()
		const plant = (taskId: number, repeat: number, patch: Partial<DelegationTrial>) => {
			const index = trials.findIndex((t) => t.taskId === taskId && t.model === `m${repeat}`)
			trials[index] = { ...trials[index], ...patch }
		}
		// two over-delegations, on tasks 5 and 19 (and the floor plant below on task 10 is one more)
		plant(5, 0, { spawned: true, promptCount: 1, signal: "bulk", purpose: "x" })
		plant(19, 0, { spawned: true, promptCount: 3, signal: "independent", purpose: "x" })
		// one floor violation: authoring handed to a child (task 10)
		plant(10, 1, { spawned: true, promptCount: 1, signal: "bulk", purpose: "x", childAuthoring: true })
		// one floor violation: the lead never called its own tool (task 13)
		plant(13, 2, { leadOnlyToolCalledByLead: false })
		// two under-delegations: no spawn and more than 10 calls (tasks 14 and 20)
		plant(14, 0, { spawned: false, promptCount: undefined, leadToolCalls: 14 })
		plant(20, 0, { spawned: false, promptCount: undefined, leadToolCalls: 11 })
		// a fan-out of 1 on a task that wants 3 is off by two; a 4 on a 3 is off by one but 4+ on a 2 to 3 task
		plant(16, 0, { promptCount: 1 })
		plant(16, 1, { promptCount: 4 })
		// a wrong signal and a purpose over 140 characters
		plant(15, 0, { signal: "independent" })
		plant(18, 0, { purpose: "y".repeat(141) })
		// user asked for two, got three
		plant(18, 1, { promptCount: 3 })

		const score = scoreTrials(trials)
		// task 10 is a no-spawn task too, so its planted spawn counts here as well as under the floor
		expect(score.overDelegation.spawns).to.equal(3)
		expect(score.floor.violations).to.equal(2)
		expect(score.underDelegation.count).to.equal(2)
		// task 18 asked for two: one trial got three, the long-purpose trial still got two
		expect(score.userAsked.good).to.equal(4)
		// fan-out bad: task 16 with 1 (off by 2), task 16 with 4 (4+ on a 2 to 3 task), task 18 with 3 is off by 1: not bad;
		// the two over-delegations name a task with no expected prompts: not counted
		expect(score.fanOut.bad).to.equal(2)
		// bad signals: task 15 (independent), plus the three planted spawns whose tasks name no signal
		expect(score.signal.spawns - score.signal.good).to.equal(4)
		expect(score.purpose.spawns - score.purpose.good).to.equal(1)
	})

	it("flipping one label moves the metric", () => {
		const trials = allCorrect()
		const before = scoreTrials(trials).overDelegation.rate
		const index = trials.findIndex((t) => t.taskId === 6)
		trials[index] = { ...trials[index], spawned: true, promptCount: 2, signal: "independent", purpose: "x" }
		expect(scoreTrials(trials).overDelegation.rate).to.be.greaterThan(before)
		expect(scoreTrials(trials).overDelegation.spawns).to.equal(1)
	})

	it("over-delegation also has to halve arm A's rate when A is above ten percent", () => {
		const trials = allCorrect()
		for (let i = 0; i < 4; i++) {
			const index = trials.findIndex((t) => t.taskId === 1 + i && t.model === "m0")
			trials[index] = { ...trials[index], spawned: true, promptCount: 1, signal: "bulk", purpose: "x" }
		}
		const score = scoreTrials(trials)
		expect(score.overDelegation.rate).to.be.lessThan(THRESHOLDS.overDelegation)
		const withBaseline = verdicts(score, 0.2).find((v) => v.metric === "overDelegation")!
		expect(withBaseline.pass).to.equal(true)
		const strict = verdicts(score, 0.1 + 0.0001).find((v) => v.metric === "overDelegation")!
		expect(strict.pass).to.equal(score.overDelegation.rate <= (0.1 + 0.0001) / 2)
	})

	it("prompt cost is the arm's mean tokens on no-spawn tasks over the baseline's", () => {
		const base = allCorrect()
		const arm = base.map((t) => ({ ...t, tokens: t.tokens * 1.04 }))
		expect(promptCostRatio(arm, base)).to.be.closeTo(1.04, 1e-9)
		expect(promptCostRatio(arm, base)).to.be.at.most(THRESHOLDS.promptCostRatio)
	})
})
