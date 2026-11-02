import { randomBytes } from "node:crypto"
import type { ApiHandler } from "@core/api"
import { type SubagentChildSummary, subagentLabel } from "@shared/aihydro/subagents"
import { type AgentProfile, capFor, type EffectiveCapabilities, type ParentCapabilities } from "./agentProfile"
import { type SubagentResult, SubagentRunner, type SubagentRunnerInit } from "./SubagentRunner"

/** At most this many children run at once; the rest queue (plan 5.3). */
export const MAX_CONCURRENT_CHILDREN = 3
/** At most this many prompts in one spawn call. */
export const MAX_PROMPTS_PER_CALL = 4
/**
 * Children start this far apart. A provider's prompt cache serves a prefix only once the request that wrote it has
 * begun to answer, so siblings launched at one instant all pay the cold price. The gap is small on purpose: it is
 * latency the user waits through, and it is configurable (`subagentStaggerMs`; 0 starts them together). Kept only if
 * the installed-build cache test shows a hit gain (plan stage 0 kill rule).
 */
export const DEFAULT_STAGGER_MS = 1_000

export type SupervisorRunnerBase = Omit<
	SubagentRunnerInit,
	"childId" | "ordinal" | "label" | "profile" | "caps" | "prompt" | "api" | "onUpdate"
>

export interface SupervisorDeps {
	profile: AgentProfile
	parent: ParentCapabilities
	/** The fixed parts every runner shares (context, services, bridge, record writer...). */
	runnerBase: SupervisorRunnerBase
	/** A fresh handler per child, so a cancel drops that child's stream alone. */
	buildApi: () => ApiHandler
	/** Called with every child's summary whenever any changes. The caller coalesces for the UI. */
	onUpdate?: (children: SubagentChildSummary[]) => void
	newId?: () => string
	maxConcurrent?: number
	/** Gap between child starts; defaults to DEFAULT_STAGGER_MS. */
	staggerMs?: number
	/** Test seam for the stagger wait. */
	sleep?: (ms: number) => Promise<void>
	now?: () => number
}

export class SpawnRefused extends Error {}

/**
 * Runs one spawn call's children: validates the request, computes the effective capabilities (S1), runs at most
 * MAX_CONCURRENT_CHILDREN at a time and queues the rest, and cancels them all on request. One supervisor per spawn call.
 */
export class SubagentSupervisor {
	private runners: SubagentRunner[] = []
	private summaries = new Map<string, SubagentChildSummary>()
	private cancelledAll = false
	private readonly cancelledIds = new Set<string>()
	/** Wakes a child sleeping in the stagger wait, by id. */
	private readonly wakers = new Map<string, () => void>()
	readonly caps: EffectiveCapabilities

	constructor(private readonly deps: SupervisorDeps) {
		const caps = capFor(deps.parent, deps.profile)
		if (!caps) {
			throw new SpawnRefused("A subagent cannot start another subagent.")
		}
		this.caps = caps
	}

	get children(): SubagentChildSummary[] {
		return this.runners.map((runner) => this.summaries.get(runner.childId) ?? runner.summary())
	}

	/** Stop every child: running ones at their next await, queued ones before they make a request. */
	cancelAll(): void {
		this.cancelledAll = true
		for (const runner of this.runners) {
			runner.cancel()
		}
		for (const wake of [...this.wakers.values()]) {
			wake()
		}
	}

	/** Stop one child. A child waiting on the user stops now; its ask stays the parent's to resolve. */
	cancel(childId: string): boolean {
		const runner = this.runners.find((candidate) => candidate.childId === childId)
		runner?.cancel()
		if (runner) {
			this.cancelledIds.add(runner.childId)
			this.wakers.get(runner.childId)?.()
		}
		return !!runner
	}

	async run(prompts: string[]): Promise<SubagentResult[]> {
		const clean = prompts.map((prompt) => (typeof prompt === "string" ? prompt.trim() : ""))
		if (clean.length === 0 || clean.some((prompt) => !prompt)) {
			throw new SpawnRefused("spawn_subagents needs 1 to 4 non-empty prompts.")
		}
		if (clean.length > MAX_PROMPTS_PER_CALL) {
			throw new SpawnRefused(`spawn_subagents takes at most ${MAX_PROMPTS_PER_CALL} prompts per call; got ${clean.length}.`)
		}
		const newId = this.deps.newId ?? (() => `sa_${randomBytes(6).toString("hex")}`)
		this.runners = clean.map((prompt, index) => {
			const ordinal = index + 1
			return new SubagentRunner({
				...this.deps.runnerBase,
				childId: newId(),
				ordinal,
				label: subagentLabel(this.deps.profile.id, ordinal),
				profile: this.deps.profile.id,
				caps: this.caps,
				prompt,
				api: this.deps.buildApi(),
				onUpdate: (summary) => {
					this.summaries.set(summary.childId, summary)
					this.deps.onUpdate?.(this.children)
				},
			})
		})
		for (const runner of this.runners) {
			this.summaries.set(runner.childId, runner.summary())
		}
		this.deps.onUpdate?.(this.children)

		const results: SubagentResult[] = new Array(this.runners.length)
		let next = 0
		const stagger = Math.max(0, this.deps.staggerMs ?? DEFAULT_STAGGER_MS)
		const now = this.deps.now ?? Date.now
		let lastStart = Number.NEGATIVE_INFINITY
		const isCancelled = (runner: SubagentRunner) => this.cancelledAll || this.cancelledIds.has(runner.childId)
		// Reserve the next start time synchronously, so two workers freeing up together still start a gap apart. The wait
		// races a cancel: a cancelled child wakes at once, makes no request, and gives its reserved slot back.
		const waitForStartSlot = async (runner: SubagentRunner) => {
			const previous = lastStart
			const at = Math.max(now(), lastStart + stagger)
			const wait = at - now()
			lastStart = at
			if (wait <= 0 || isCancelled(runner)) {
				return
			}
			let timer: ReturnType<typeof setTimeout> | undefined
			const woken = new Promise<void>((resolve) => this.wakers.set(runner.childId, resolve))
			const slept = this.deps.sleep
				? this.deps.sleep(wait)
				: new Promise<void>((resolve) => {
						timer = setTimeout(resolve, wait)
					})
			await Promise.race([slept, woken])
			if (timer) {
				clearTimeout(timer)
			}
			this.wakers.delete(runner.childId)
			if (isCancelled(runner) && lastStart === at) {
				lastStart = previous
			}
		}
		const worker = async () => {
			for (;;) {
				const index = next++
				if (index >= this.runners.length) {
					return
				}
				const runner = this.runners[index]
				await waitForStartSlot(runner)
				results[index] = isCancelled(runner) ? await runner.cancelQueued() : await runner.run()
			}
		}
		const width = Math.min(this.deps.maxConcurrent ?? MAX_CONCURRENT_CHILDREN, MAX_CONCURRENT_CHILDREN, this.runners.length)
		await Promise.all(Array.from({ length: width }, worker))
		return results
	}
}
