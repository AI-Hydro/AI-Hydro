/**
 * Whether the host has taken a pin save, as far as the map can tell.
 *
 * Pins are written to local storage at once (the fast copy) and sent to the extension host (the durable one). "Saved" in
 * the UI must mean the host said so, never just that local storage took it. Every save sent to the host carries a
 * sequence number; the host echoes it back in `aihydro-map-save-ack`. A save with no answer within `ACK_TIMEOUT_MS`, or a
 * save the host refused (it asks the map to reload instead), counts as failed. Saves made before the host has said which
 * project this is cannot be sent at all: that is its own state ("local"), shown honestly as not yet on the host.
 */

import { useSyncExternalStore } from "react"

export interface PinSaveStatus {
	/** Highest sequence number sent to the host. */
	requested: number
	/** Highest sequence number the host has acknowledged. */
	acked: number
	/** Highest sequence number that was refused or got no answer in time. */
	failed: number
	/** A save is waiting because the host has not said which project this is. */
	unscoped: boolean
}

/** How long to wait for the host's acknowledgement of one save. */
export const ACK_TIMEOUT_MS = 10_000

let status: PinSaveStatus = { requested: 0, acked: 0, failed: 0, unscoped: false }
const listeners = new Set<() => void>()
const timers = new Map<number, number>()

const set = (next: Partial<PinSaveStatus>) => {
	const merged = { ...status, ...next }
	if (
		merged.requested === status.requested &&
		merged.acked === status.acked &&
		merged.failed === status.failed &&
		merged.unscoped === status.unscoped
	) {
		return
	}
	status = merged
	for (const listener of listeners) listener()
}

export const getPinSaveStatus = (): PinSaveStatus => status

export function subscribePinSaveStatus(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

export const usePinSaveStatus = (): PinSaveStatus =>
	useSyncExternalStore(subscribePinSaveStatus, getPinSaveStatus, getPinSaveStatus)

/** A save is about to be sent: number it, and start waiting for the host's answer. */
export function beginHostSave(): number {
	const seq = status.requested + 1
	set({ requested: seq, unscoped: false })
	if (typeof window !== "undefined") {
		timers.set(
			seq,
			window.setTimeout(() => {
				timers.delete(seq)
				if (status.acked < seq) set({ failed: Math.max(status.failed, seq) })
			}, ACK_TIMEOUT_MS),
		)
	}
	return seq
}

/** A save could not be sent because the project is not known yet. */
export function markUnscoped(): void {
	set({ unscoped: true })
}

/** The host acknowledged save `seq` (and, being in order, every save before it). */
export function ackHostSave(seq: unknown): void {
	if (typeof seq !== "number" || !Number.isFinite(seq)) return
	for (const [pending, timer] of timers) {
		if (pending <= seq) {
			window.clearTimeout(timer)
			timers.delete(pending)
		}
	}
	set({ acked: Math.max(status.acked, seq) })
}

/** The host refused the save and asked for a reload: whatever is still waiting will not be acknowledged. */
export function failOutstandingSaves(): void {
	if (status.acked < status.requested) set({ failed: status.requested })
}

/** Tests only. */
export function resetPinSaveStatus(): void {
	for (const timer of timers.values()) if (typeof window !== "undefined") window.clearTimeout(timer)
	timers.clear()
	status = { requested: 0, acked: 0, failed: 0, unscoped: false }
	for (const listener of listeners) listener()
}

export type PinSavePhase = "idle" | "saving" | "saved" | "failed" | "local"

/**
 * Where one commit stands. `awaiting` is what the card is waiting on: the sequence number its last save was sent as,
 * "local" when it could not be sent yet, or null when it has committed nothing since it opened.
 */
export function pinSavePhase(s: PinSaveStatus, awaiting: number | "local" | null): PinSavePhase {
	if (awaiting === null) return "idle"
	if (awaiting === "local") return s.unscoped ? "local" : s.requested > s.acked ? "saving" : "saved"
	if (s.acked >= awaiting) return "saved"
	if (s.failed >= awaiting) return "failed"
	return "saving"
}

/** Where the save just made went: its number, or "local" when it is waiting for the project. Read right after saving. */
export function currentSaveToken(): number | "local" {
	return status.unscoped ? "local" : status.requested
}
