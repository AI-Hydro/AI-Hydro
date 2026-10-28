import type { StudyBindingState } from "@shared/ExtensionMessage"
import React, { useCallback } from "react"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import StudyPicker from "./StudyPicker"

type StudyBindingAction = { action: "open" } | { action: "choose"; studyId: string } | { action: "decline"; kind: "none" | "new" }

function postStudyBinding(payload: StudyBindingAction) {
	PLATFORM_CONFIG.postMessage({ type: "aihydro-study-binding", payload })
}

/** What the chip says for a state: the bound study (id first, never truncated), or why there is none. */
export function chipText(b: StudyBindingState | undefined): { id?: string; label?: string; text?: string } {
	if (!b) {
		return {}
	}
	if (b.studyId) {
		return { id: b.studyId, label: b.label && b.label !== b.studyId ? b.label : undefined }
	}
	if (b.status === "choose") {
		return { text: "Choose study" }
	}
	if (b.status === "none") {
		return { text: "No study" }
	}
	return { text: "Study unavailable" }
}

export interface StudyChipViewProps {
	binding: StudyBindingState | undefined
	onOpen: () => void
	onChoose: (studyId: string) => void
	onDecline: (kind: "none" | "new") => void
}

/** Whether the picker is showing: the host opened it (`choose` with candidates). */
export const isPicking = (b: StudyBindingState | undefined): b is StudyBindingState =>
	!!b && b.status === "choose" && !!b.candidates

/**
 * The header chip for the study a chat is bound to. A pure view over the host's state: it never binds. Clicking
 * asks the host to open the picker (or closes it).
 */
export const StudyChipView: React.FC<StudyChipViewProps> = ({ binding, onOpen, onDecline }) => {
	if (!binding) {
		return null
	}
	const { id, label, text } = chipText(binding)
	const picking = isPicking(binding)
	const pending = binding.status === "choose" && !binding.studyId
	const interactive = binding.canChoose
	const title = [
		binding.studyId ? `Study: ${binding.studyId}${binding.label ? ` - ${binding.label}` : ""}` : text,
		binding.reason,
		interactive ? "Click to change" : undefined,
	]
		.filter(Boolean)
		.join(". ")

	const chipBody = (
		<>
			<span aria-hidden="true" className="codicon codicon-database text-xs opacity-70" />
			{id ? (
				<>
					{/* The study id is what users look for: first and never truncated. */}
					<span className="shrink-0 font-medium">{id}</span>
					{label && (
						<span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 opacity-80">· {label}</span>
					)}
				</>
			) : (
				<span className={pending ? "font-semibold" : "opacity-80"}>{text}</span>
			)}
		</>
	)

	if (!interactive) {
		return (
			<div className="task-header-chip mr-1 max-w-[220px]" id="bound-study" title={title}>
				{chipBody}
			</div>
		)
	}
	return (
		<button
			aria-expanded={picking}
			aria-label={`Study for this chat: ${id ? `${id}${label ? ` ${label}` : ""}` : text}. Change study`}
			className={`task-header-chip task-header-chip--button mr-1 max-w-[220px] cursor-pointer ${pending ? "task-header-chip--attention" : ""}`}
			id="bound-study"
			onClick={(e) => {
				e.stopPropagation()
				if (picking) {
					onDecline("none")
				} else {
					onOpen()
				}
			}}
			title={title}
			type="button">
			{chipBody}
			<span aria-hidden="true" className="codicon codicon-chevron-down text-xs opacity-70" />
		</button>
	)
}

/** The picker, laid out under the header row (in flow, never floating) so it cannot cover the chat or an ask. */
export const StudyPickerPanelView: React.FC<Omit<StudyChipViewProps, "onOpen">> = ({ binding, onChoose, onDecline }) => {
	if (!isPicking(binding)) {
		return null
	}
	return (
		<div data-testid="study-picker-slot">
			<StudyPicker
				candidates={binding.candidates ?? []}
				canChoose={binding.canChoose}
				currentStudyId={binding.studyId}
				onChoose={onChoose}
				onDecline={onDecline}
				reason={binding.reason}
			/>
		</div>
	)
}

function useStudyBindingActions() {
	const onOpen = useCallback(() => postStudyBinding({ action: "open" }), [])
	const onChoose = useCallback((studyId: string) => postStudyBinding({ action: "choose", studyId }), [])
	const onDecline = useCallback((kind: "none" | "new") => postStudyBinding({ action: "decline", kind }), [])
	return { onOpen, onChoose, onDecline }
}

/** Mounted in the task header's right cluster. */
const StudyChip: React.FC = () => {
	const { studyBinding } = useExtensionState()
	return <StudyChipView binding={studyBinding} {...useStudyBindingActions()} />
}

/** Mounted under the task header's title row. */
export const StudyPickerPanel: React.FC = () => {
	const { studyBinding } = useExtensionState()
	return <StudyPickerPanelView binding={studyBinding} {...useStudyBindingActions()} />
}

export default StudyChip
