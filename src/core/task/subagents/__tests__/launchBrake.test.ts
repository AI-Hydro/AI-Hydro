import { expect } from "chai"
import { describe, it } from "mocha"
import { LAUNCH_BRAKE_AT, type LaunchBrakeState, launchesPaused, recordLaunchDenial, userWroteToLead } from "../launchBrake"

describe("launch brake", () => {
	it("pauses at two bare denials and not before", () => {
		const state: LaunchBrakeState = {}
		expect(LAUNCH_BRAKE_AT).to.equal(2)
		expect(launchesPaused(state)).to.equal(false)
		recordLaunchDenial(state, false)
		expect(launchesPaused(state)).to.equal(false)
		recordLaunchDenial(state, false)
		expect(launchesPaused(state)).to.equal(true)
	})

	it("a denial with words is counted for the card but not for the brake", () => {
		const state: LaunchBrakeState = {}
		recordLaunchDenial(state, true)
		recordLaunchDenial(state, true)
		recordLaunchDenial(state, true)
		expect(state.launchDenials).to.equal(3)
		expect(launchesPaused(state)).to.equal(false)
	})

	it("the user writing to the lead ends the pause but keeps the running total", () => {
		const state: LaunchBrakeState = {}
		recordLaunchDenial(state, false)
		recordLaunchDenial(state, false)
		userWroteToLead(state)
		expect(launchesPaused(state)).to.equal(false)
		expect(state.launchDenials).to.equal(2)
		recordLaunchDenial(state, false)
		expect(launchesPaused(state), "one bare denial after a reset is not a pause").to.equal(false)
	})
})
