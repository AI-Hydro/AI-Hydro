import { useEffect, useId, useRef, useState } from "react"
import { useCheckpointActions } from "@/components/common/useCheckpointActions"

/** Said under every restore action: a rewind restores workspace files and/or the conversation, nothing else. */
export const REWIND_SCOPE_NOTE = "Does not undo recorded claims, runs or MCP side effects (~/.aihydro)."

interface RewindMenuProps {
	/** `ts` of the checkpoint to rewind to. */
	checkpointTs: number
	isCheckedOut?: boolean
	/** Names the thing being rewound, for the accessible name ("Rewind this turn"). */
	subject: string
}

/**
 * The Rewind action on a work-group header or a user turn. It replaces the old checkpoint row: no row of its own, a
 * disclosure that is always in the tab order (it only becomes visible on hover or focus, so it is reachable by
 * keyboard at every detail level). Every action is labelled separately and runs the same RPC as CheckmarkControl,
 * through the shared useCheckpointActions hook.
 */
export function RewindMenu({ checkpointTs, isCheckedOut, subject }: RewindMenuProps) {
	const [open, setOpen] = useState(false)
	const menuId = useId()
	const triggerRef = useRef<HTMLButtonElement>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const actions = useCheckpointActions(checkpointTs, isCheckedOut)

	// Opening the menu moves focus into it, so a keyboard user lands on the first action.
	useEffect(() => {
		if (open) {
			rootRef.current?.querySelector<HTMLElement>(".transcript-rewind-menu button:not(:disabled)")?.focus()
		}
	}, [open])

	useEffect(() => {
		if (!open) {
			return
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation()
				setOpen(false)
				triggerRef.current?.focus()
			}
		}
		const onDown = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		document.addEventListener("keydown", onKey, true)
		document.addEventListener("mousedown", onDown)
		return () => {
			document.removeEventListener("keydown", onKey, true)
			document.removeEventListener("mousedown", onDown)
		}
	}, [open])

	const items: Array<{ id: string; label: string; detail: string; run: () => void; disabled: boolean }> = [
		{
			id: "files",
			label: "Restore files",
			detail: "Workspace files only: puts your project's files back to the snapshot taken here.",
			run: actions.handleRestoreWorkspace,
			disabled: actions.restoreWorkspaceDisabled || !!isCheckedOut,
		},
		{
			id: "task",
			label: "Restore task",
			detail: "Conversation only: deletes the messages after this point and leaves workspace files as they are.",
			run: actions.handleRestoreTask,
			disabled: actions.restoreTaskDisabled,
		},
		{
			id: "both",
			label: "Restore files and task",
			detail: "Puts workspace files back and deletes the messages after this point.",
			run: actions.handleRestoreBoth,
			disabled: actions.restoreBothDisabled,
		},
	]

	return (
		<div
			className="transcript-rewind"
			onBlur={(e) => {
				// Tabbing away (focus leaves the whole control) closes the menu.
				if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) {
					setOpen(false)
				}
			}}
			ref={rootRef}>
			<button
				aria-controls={open ? menuId : undefined}
				aria-expanded={open}
				aria-label={`Rewind ${subject}`}
				className="transcript-btn transcript-rewind-trigger"
				onClick={() => setOpen((v) => !v)}
				ref={triggerRef}
				type="button">
				<i aria-hidden className="codicon codicon-history" />
				<span>Rewind</span>
			</button>
			{open && (
				<div aria-label={`Rewind ${subject}`} className="transcript-rewind-menu" id={menuId} role="group" tabIndex={-1}>
					<button
						className="transcript-btn"
						disabled={actions.compareDisabled}
						onClick={actions.handleCompare}
						type="button">
						<i aria-hidden className="codicon codicon-diff" />
						<span>Compare with workspace</span>
					</button>
					{items.map((item) => (
						<div className="transcript-rewind-item" key={item.id}>
							<button
								aria-describedby={`${menuId}-${item.id}`}
								className="transcript-btn transcript-btn-block"
								disabled={item.disabled}
								onClick={item.run}
								type="button">
								{item.label}
							</button>
							<p id={`${menuId}-${item.id}`}>
								{item.detail} {REWIND_SCOPE_NOTE}
							</p>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
