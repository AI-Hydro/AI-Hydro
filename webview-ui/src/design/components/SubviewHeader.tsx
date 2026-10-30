import { type ReactNode, useEffect } from "react"
import { Button } from "./Button"
import { Text } from "./Text"
import "./primitives.css"

export interface SubviewHeaderProps {
	/** The view's name, as in docs/ui-naming.md. Rendered as the page heading. */
	title: string
	/** Closes the view and returns to the chat. Also bound to Escape. */
	onClose: () => void
	/** The close button's text. Defaults to "Done". */
	closeLabel?: string
	/** Extra controls drawn before the close button. */
	actions?: ReactNode
	/** Set false for a view that must not close on Escape. */
	closeOnEscape?: boolean
	/** Title colour override (a development build tints it). */
	titleColor?: string
}

/** True while something that owns Escape is open: a menu, a dialog, a listbox, or a text field is being edited. */
function escapeIsTaken(target: EventTarget | null): boolean {
	const el = target instanceof HTMLElement ? target : null
	if (el?.closest("input, textarea, select, [contenteditable='true']")) {
		return true
	}
	return document.querySelector('[role="menu"], [role="dialog"], [role="listbox"], [aria-modal="true"]') !== null
}

/**
 * The header of a sidebar sub-view (Settings, MCP, Skills, History...): the view's title and one "Done" button, and
 * Escape closes the view unless a menu, dialog or text field has taken the key. One implementation so every view
 * closes the same way.
 */
export function SubviewHeader({
	title,
	onClose,
	closeLabel = "Done",
	actions,
	closeOnEscape = true,
	titleColor,
}: SubviewHeaderProps) {
	useEffect(() => {
		if (!closeOnEscape) {
			return
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || escapeIsTaken(e.target)) {
				return
			}
			e.preventDefault()
			onClose()
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [closeOnEscape, onClose])

	return (
		<header className="aih-subview-header">
			<Text as="h1" variant="title">
				<span style={titleColor ? { color: titleColor } : undefined}>{title}</span>
			</Text>
			<div className="aih-subview-header__actions">
				{actions}
				<Button onClick={onClose} variant="primary">
					{closeLabel}
				</Button>
			</div>
		</header>
	)
}
