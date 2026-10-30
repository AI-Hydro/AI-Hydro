import type { StudyBindingState } from "@shared/ExtensionMessage"
import React, { useCallback, useEffect } from "react"
import { TrustLauncherButton } from "@/components/tools/TrustLauncherButton"
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
		return { text: "No study bound" }
	}
	return { text: "Study unavailable" }
}

export interface StudyChipViewProps {
	binding: StudyBindingState | undefined
	onOpen: () => void
	onChoose: (studyId: string) => void
	onDecline: (kind: "none" | "new") => void
}

/** The study is unavailable because the AI-Hydro Tools launcher is not confirmed (the user can fix that here). */
export const needsLauncherTrust = (b: StudyBindingState | undefined): boolean =>
	!!b && b.status === "unavailable" && b.cause === "untrusted_server"

/** In flow under the header (never floating): why there is no study, and the one action that fixes it. */
export const StudyTrustNotice: React.FC<{ reason?: string; serverName?: string }> = ({ reason, serverName }) => (
	<div className="mx-1 mb-1 flex flex-col gap-1 text-[12px]" data-testid="study-trust-notice" role="status">
		<span>{reason}</span>
		<span>
			<TrustLauncherButton serverName={serverName} testId="study-trust-launcher" />
		</span>
	</div>
)

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
		// X1-P1: which project the chat is in, or why it has none (server absent or older than 2.8.3). Tooltip only.
		binding.project?.title ? `Project: ${binding.project.title}` : undefined,
		binding.project?.note,
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
					{label && <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0">· {label}</span>}
				</>
			) : (
				<span className={pending ? "font-semibold" : undefined}>{text}</span>
			)}
		</>
	)

	if (!interactive) {
		return (
			<div
				className="task-header-chip task-header-chip--solid mr-1 max-w-[132px] min-[480px]:max-w-[220px]"
				id="bound-study"
				title={title}>
				{chipBody}
			</div>
		)
	}
	return (
		<button
			aria-expanded={picking}
			aria-label={`Study for this chat: ${id ? `${id}${label ? ` ${label}` : ""}` : text}. Change study`}
			className={`task-header-chip task-header-chip--solid task-header-chip--button mr-1 max-w-[132px] min-[480px]:max-w-[220px] cursor-pointer ${pending ? "task-header-chip--attention" : ""}`}
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
export const StudyPickerPanelView: React.FC<Omit<StudyChipViewProps, "onOpen"> & { autoFocus?: boolean }> = ({
	binding,
	autoFocus = false,
	onChoose,
	onDecline,
}) => {
	if (needsLauncherTrust(binding)) {
		return <StudyTrustNotice reason={binding?.reason} serverName={binding?.causeServer} />
	}
	if (!isPicking(binding)) {
		return null
	}
	return (
		<div data-testid="study-picker-slot">
			<StudyPicker
				autoFocus={autoFocus}
				canChoose={binding.canChoose}
				candidates={binding.candidates ?? []}
				currentStudyId={binding.studyId}
				onChoose={onChoose}
				onDecline={onDecline}
				reason={binding.reason}
			/>
		</div>
	)
}

/** True while the picker is open because the user clicked the chip (so it may take focus, and gives it back). */
let pickerOpenedByUser = false

/** Test seam and reset: the flag survives only while a picker is actually showing. */
export const pickerFocusFlag = {
	get: () => pickerOpenedByUser,
	set: (v: boolean) => {
		pickerOpenedByUser = v
	},
	/** A chip click that opened no picker (host answered unavailable/none/bound) must not arm a later host-opened one. */
	settle: (binding: StudyBindingState | undefined) => {
		if (!isPicking(binding)) {
			pickerOpenedByUser = false
		}
	},
}

function giveFocusBackToChip() {
	if (pickerOpenedByUser) {
		pickerOpenedByUser = false
		requestAnimationFrame(() => document.getElementById("bound-study")?.focus())
	}
}

function useStudyBindingActions() {
	const onOpen = useCallback(() => {
		pickerOpenedByUser = true
		postStudyBinding({ action: "open" })
	}, [])
	const onChoose = useCallback((studyId: string) => {
		giveFocusBackToChip()
		postStudyBinding({ action: "choose", studyId })
	}, [])
	const onDecline = useCallback((kind: "none" | "new") => {
		giveFocusBackToChip()
		postStudyBinding({ action: "decline", kind })
	}, [])
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
	// Every host state that is not a picker disarms the flag (see pickerFocusFlag.settle).
	useEffect(() => pickerFocusFlag.settle(studyBinding), [studyBinding])
	return <StudyPickerPanelView autoFocus={pickerOpenedByUser} binding={studyBinding} {...useStudyBindingActions()} />
}

export default StudyChip
