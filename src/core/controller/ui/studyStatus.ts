import type { StudyBindingState } from "@shared/ExtensionMessage"

/**
 * The study the current chat is bound to, for the status bar. Host-neutral: the controller reports the binding every
 * time it posts state, and the VS Code host registers a sink that draws an item. Only a bound chat has a study;
 * `choose`, `none` and `unavailable` mean there is nothing to show, so the item hides.
 */
export interface StudyStatus {
	studyId: string
	label?: string
}

type Sink = (study: StudyStatus | undefined) => void

let current: StudyStatus | undefined
let sink: Sink | undefined

export function studyOf(binding: StudyBindingState | undefined): StudyStatus | undefined {
	if (binding?.status !== "bound" || !binding.studyId) {
		return undefined
	}
	return { studyId: binding.studyId, ...(binding.label ? { label: binding.label } : {}) }
}

function same(a: StudyStatus | undefined, b: StudyStatus | undefined): boolean {
	return a?.studyId === b?.studyId && a?.label === b?.label
}

function publish(): void {
	try {
		sink?.(current)
	} catch (error) {
		console.warn("studyStatus: sink failed", error)
	}
}

export function setStudyStatusSink(fn: Sink | undefined): void {
	sink = fn
	// A newly registered sink (view re-resolved) draws the current study.
	if (fn) {
		publish()
	}
}

/** Called with the binding in each state post. Only a change reaches the sink. */
export function reportStudyStatus(binding: StudyBindingState | undefined): void {
	const next = studyOf(binding)
	if (same(next, current)) {
		return
	}
	current = next
	publish()
}
