import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	ACK_TIMEOUT_MS,
	ackHostSave,
	beginHostSave,
	currentSaveToken,
	failOutstandingSaves,
	getPinSaveStatus,
	markUnscoped,
	pinSavePhase,
	refusedSaveNotice,
	resetPinSaveStatus,
} from "../pinSaveStatus"

beforeEach(() => {
	vi.useFakeTimers()
	resetPinSaveStatus()
})
afterEach(() => vi.useRealTimers())

describe("pin save status", () => {
	it("numbers saves in order and acknowledges by number, so an old ack never covers a newer save", () => {
		const a = beginHostSave()
		const b = beginHostSave()
		expect([a, b]).toEqual([1, 2])
		ackHostSave(1)
		expect(pinSavePhase(getPinSaveStatus(), a)).toBe("saved")
		expect(pinSavePhase(getPinSaveStatus(), b)).toBe("saving")
		ackHostSave(undefined)
		expect(pinSavePhase(getPinSaveStatus(), b)).toBe("saving")
		ackHostSave(2)
		expect(pinSavePhase(getPinSaveStatus(), b)).toBe("saved")
	})

	it("a save the host never answers fails after the timeout, and a late ack still wins", () => {
		const a = beginHostSave()
		vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1)
		expect(pinSavePhase(getPinSaveStatus(), a)).toBe("failed")
		ackHostSave(a)
		expect(pinSavePhase(getPinSaveStatus(), a)).toBe("saved")
	})

	it("a refused save (the host asks for a reload) fails whatever is outstanding, but not what was acknowledged", () => {
		const a = beginHostSave()
		ackHostSave(a)
		const b = beginHostSave()
		failOutstandingSaves()
		expect(pinSavePhase(getPinSaveStatus(), a)).toBe("saved")
		expect(pinSavePhase(getPinSaveStatus(), b)).toBe("failed")
	})

	it("a save before the project is known is local, never saved", () => {
		markUnscoped()
		expect(currentSaveToken()).toBe("local")
		expect(pinSavePhase(getPinSaveStatus(), "local")).toBe("local")
		const seq = beginHostSave()
		expect(currentSaveToken()).toBe(seq)
		expect(pinSavePhase(getPinSaveStatus(), "local")).toBe("saving")
	})
})

describe("refused save notice", () => {
	it("names the pin and carries its note to copy", () => {
		expect(refusedSaveNotice({ name: "Outlet candidate", notes: "check NLDI snap" })).toEqual({
			message: "Pin \u201COutlet candidate\u201D was not saved: the open folder changed, so pins were reloaded.",
			copy: "check NLDI snap",
		})
		expect(refusedSaveNotice({ name: "Dam", notes: "" }).copy).toBeUndefined()
		expect(refusedSaveNotice(undefined).message).toMatch(/^A pin edit was not saved/)
	})
})
