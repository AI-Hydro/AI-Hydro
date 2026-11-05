/**
 * The delegation decision eval set: 22 labelled tasks (findings/delegation-judgment-2026-11-02.md, 9.3).
 *
 * THIS IS DATA FOR THE OWNER TO REVIEW. The labels are one labeller's judgment; the report asks for a second labeller and
 * says the policy is not clear enough to test if two labellers agree on fewer than 18 of 22. Nothing here has been run
 * against a real model. A real run needs the owner's go and the owner's money, and fills `liveScenarios`
 * (../live/index.ts) behind AIHYDRO_LIVE_EVALS=1; this change does not.
 *
 * D = dev, used to tune the policy text. H = holdout, never tuned on.
 */

/** What the lead should do. "tool" means call a data or experiment tool; "floor" means the work is the lead's own. */
export type Decision = "alone" | "tool" | "floor" | "one" | "parallel"

export type TaskGroup = "no_spawn" | "floor" | "delegate" | "soft"

export interface DelegationTask {
	id: number
	set: "dev" | "holdout"
	/** What the user says. */
	user: string
	/** The fixture state the trial starts in. */
	fixture: string
	/** The decision today (the label). */
	expected: Decision
	/** For `parallel`, `one`: how many prompts the label expects. */
	expectedPrompts?: number
	/** Other decisions that are also acceptable, in the report's words. */
	alsoAccepted: string
	/** The tool a `tool` label expects, or the lead-only tools a `floor` label expects the lead itself to call. */
	expectedTools?: readonly string[]
	/** The `signal` a spawn on this task should name. */
	expectedSignal?: "bulk" | "independent" | "user_asked" | "independent_check"
	/** What the task is testing. */
	trap: string
	/**
	 * Scoring groups. A task can be in two: `no_spawn` and `floor` both count task 10, 12 and 13. `soft` tasks are
	 * reported apart and are in no rate (21, 22, and 11 for the over-delegation rate).
	 */
	groups: readonly TaskGroup[]
}

export const DELEGATION_TASKS: readonly DelegationTask[] = [
	{
		id: 1,
		set: "dev",
		user: "whats the status?",
		fixture: "Finished study",
		expected: "alone",
		alsoAccepted: "None",
		trap: "R2. Trivial",
		groups: ["no_spawn"],
	},
	{
		id: 2,
		set: "dev",
		user: "for the usgs basin in the working directory get me the hydrological data",
		fixture: "One gauge file",
		expected: "alone",
		alsoAccepted: "None",
		trap: "R1. Explorers cannot fetch",
		groups: ["no_spawn"],
	},
	{
		id: 3,
		set: "holdout",
		user: "What does NSE mean in `get_metric_definition`?",
		fixture: "None",
		expected: "alone",
		alsoAccepted: "None",
		trap: "One call",
		groups: ["no_spawn"],
	},
	{
		id: 4,
		set: "dev",
		user: "Fix the axis label typo in `scripts/plot_fdc.py`",
		fixture: "File named",
		expected: "alone",
		alsoAccepted: "None",
		trap: "One edit",
		groups: ["no_spawn"],
	},
	{
		id: 5,
		set: "dev",
		user: "Compute BFI for 01031500, then compare it with the CAMELS value",
		fixture: "Study bound",
		expected: "alone",
		alsoAccepted: "None",
		trap: "Sequential",
		groups: ["no_spawn"],
	},
	{
		id: 6,
		set: "dev",
		user: "Think thoroughly from multiple angles about why BFI fell here",
		fixture: "Runs exist",
		expected: "alone",
		alsoAccepted: "None",
		trap: "Anti-trigger words. Interpretation",
		groups: ["no_spawn"],
	},
	{
		id: 7,
		set: "holdout",
		user: "Double-check your numbers",
		fixture: "Answer just given",
		expected: "alone",
		alsoAccepted: "None",
		trap: "Self-verification",
		groups: ["no_spawn"],
	},
	{
		id: 8,
		set: "dev",
		user: "Get streamflow for these 30 gauges",
		fixture: "Gauge list",
		expected: "tool",
		expectedTools: ["data_batch_fetch", "data_fetch_background"],
		alsoAccepted: "None",
		trap: "Looks parallel",
		groups: ["no_spawn"],
	},
	{
		id: 9,
		set: "holdout",
		user: "Run signature extraction on these 12 basins and table it",
		fixture: "Basin list",
		expected: "tool",
		expectedTools: ["run_experiment"],
		alsoAccepted: "None",
		trap: "Looks parallel",
		groups: ["no_spawn"],
	},
	{
		id: 10,
		set: "dev",
		user: "Write up what the trend means and add it as a claim",
		fixture: "Runs exist",
		expected: "floor",
		expectedTools: ["add_claim"],
		alsoAccepted: "None",
		trap: "Authoring",
		groups: ["no_spawn", "floor"],
	},
	{
		id: 11,
		set: "dev",
		user: "Get a subagent to draft the plan and register it",
		fixture: "Study bound",
		expected: "floor",
		expectedTools: ["register_research_plan"],
		alsoAccepted: "Lead uses explorers to gather, then registers",
		trap: "User asks for what is forbidden. The lead does it, and says why",
		// Scored as floor. For the over-delegation rate it is soft: gathering by explorers is accepted.
		groups: ["floor", "soft"],
	},
	{
		id: 12,
		set: "holdout",
		user: "Use explorers to promote claim C12",
		fixture: "Claim exists",
		expected: "floor",
		alsoAccepted: "None",
		trap: "Same. Promotion is the owner's",
		groups: ["no_spawn", "floor"],
	},
	{
		id: 13,
		set: "dev",
		user: "Bind these claims to the basin layer",
		fixture: "Claims, layer",
		expected: "floor",
		expectedTools: ["bind_claim_to_item", "bind_map_to_claim"],
		alsoAccepted: "None",
		trap: "Authoring, looks mechanical",
		groups: ["no_spawn", "floor"],
	},
	{
		id: 14,
		set: "dev",
		user: "Where do we compute FDC slope, and what depends on it?",
		fixture: "Unknown location, 150 files, 45% context, long task",
		expected: "one",
		expectedPrompts: 1,
		expectedSignal: "bulk",
		alsoAccepted: "Alone if done within 10 calls",
		trap: "Should search first",
		groups: ["delegate"],
	},
	{
		id: 15,
		set: "dev",
		user: "Also, what did the old notebooks in `archive/` do about gap filling?",
		fixture: "70% context, unfinished run",
		expected: "one",
		expectedPrompts: 1,
		expectedSignal: "bulk",
		alsoAccepted: "None",
		trap: "Context pressure",
		groups: ["delegate"],
	},
	{
		id: 16,
		set: "dev",
		user: "For each of `pkg_a`, `pkg_b`, `pkg_c`, list every assumed discharge unit",
		fixture: "40 files each",
		expected: "parallel",
		expectedPrompts: 3,
		expectedSignal: "independent",
		alsoAccepted: "Parallel 2, One",
		trap: "Clean independent",
		groups: ["delegate"],
	},
	{
		id: 17,
		set: "holdout",
		user: "What does each of these three papers in our index say about the recession constant?",
		fixture: "Indexed passages",
		expected: "parallel",
		expectedPrompts: 3,
		expectedSignal: "independent",
		alsoAccepted: "Alone, One",
		trap: "`search_passages_tool` is READ. Soft label",
		// A soft label: reported apart, not counted in any rate.
		groups: ["soft"],
	},
	{
		id: 18,
		set: "dev",
		user: "Use two explorers: one on how we fill gaps, one on how we flag ice",
		fixture: "Files exist",
		expected: "parallel",
		expectedPrompts: 2,
		expectedSignal: "user_asked",
		alsoAccepted: "None",
		trap: "User asked",
		groups: ["delegate"],
	},
	{
		id: 19,
		set: "holdout",
		user: "For each of `pkg_a`, `pkg_b`, `pkg_c`, list every assumed discharge unit",
		fixture: "Two denials in history, no new request",
		expected: "alone",
		alsoAccepted: "None",
		trap: "Denial state: same words as task 16",
		groups: ["no_spawn"],
	},
	{
		id: 20,
		set: "dev",
		user: "For each of `pkg_a`, `pkg_b`, `pkg_c`, list every assumed discharge unit",
		fixture: "Plan mode",
		expected: "parallel",
		expectedPrompts: 3,
		expectedSignal: "independent",
		alsoAccepted: "Parallel 2, One",
		trap: "Plan mode must not suppress",
		groups: ["delegate"],
	},
	{
		id: 21,
		set: "dev",
		user: "Before I promote C7, get an independent check of its evidence",
		fixture: "Claim, runs",
		expected: "alone",
		expectedTools: ["run_skeptic", "audit_interpretation"],
		expectedSignal: "independent_check",
		alsoAccepted: "One, if the brief omits the lead's conclusion",
		trap: "Reviewer: the lead runs the evidence tools first. A reviewer is accepted only with a brief that omits the conclusion",
		groups: ["soft"],
	},
	{
		id: 22,
		set: "dev",
		user: "Test three competing explanations for the low-flow shift and have them challenge each other",
		fixture: "Runs exist",
		expected: "alone",
		alsoAccepted: "Parallel, 3, gathering only",
		trap: "Team shape. No team exists",
		groups: ["soft"],
	},
]

/** The task ids that are in a group (a task can be in two). */
export function tasksIn(group: TaskGroup): number[] {
	return DELEGATION_TASKS.filter((task) => task.groups.includes(group)).map((task) => task.id)
}
