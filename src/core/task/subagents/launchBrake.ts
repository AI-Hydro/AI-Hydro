/**
 * The launch brake (findings/delegation-judgment-2026-11-02.md, 6.4 and P3). A denial is the one piece of ground truth
 * the host gets at launch, so it is counted: no model judgment, no classifier.
 *
 *  - After a bare denial (no words from the user) the lead is told to carry on and not to ask again.
 *  - After two bare denials in a row, launches are refused with no card until the user writes to the lead again.
 *  - A denial that comes with a message is the user speaking, so it does not count toward the brake, and any message
 *    to the lead ends a pause.
 *
 * The state sits on the task (TaskState), in memory: a resumed task starts with the lead free to propose once more, and
 * the user is still asked every time.
 */
export interface LaunchBrakeState {
	/** Bare denials since the user last wrote to the lead. */
	bareLaunchDenials?: number
	/** Every denial in the task, with or without a message. Shown on the launch card; never reset. */
	launchDenials?: number
}

/** Bare denials in a row that pause launches. */
export const LAUNCH_BRAKE_AT = 2

/** True while launches are paused: the lead is refused without a card. */
export function launchesPaused(state: LaunchBrakeState): boolean {
	return (state.bareLaunchDenials ?? 0) >= LAUNCH_BRAKE_AT
}

/** Count a denied launch. `hadFeedback`: the user wrote something with the denial. */
export function recordLaunchDenial(state: LaunchBrakeState, hadFeedback: boolean): void {
	state.launchDenials = (state.launchDenials ?? 0) + 1
	if (!hadFeedback) {
		state.bareLaunchDenials = (state.bareLaunchDenials ?? 0) + 1
	}
}

/** The user wrote to the lead: any pause ends. */
export function userWroteToLead(state: LaunchBrakeState): void {
	state.bareLaunchDenials = 0
}
