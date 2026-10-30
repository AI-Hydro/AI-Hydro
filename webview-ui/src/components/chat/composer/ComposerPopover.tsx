import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import "./composer.css"

const GUTTER = 15
const GAP = 4

interface ComposerPopoverProps {
	open: boolean
	onClose: () => void
	/** The control that opened it. The popover sits above it, and a click on it is not a click-away. */
	anchorRef: RefObject<HTMLElement>
	/** Accessible name. */
	label: string
	/** "dialog" for content, "menu" for a list of actions (arrow keys move between its `menuitem`s). */
	role?: "dialog" | "menu"
	/** Preferred width in px; the popover never exceeds the viewport minus the gutters. */
	width?: number
	testId?: string
	children: ReactNode
}

/**
 * A small popover that opens upward from a composer control. Escape closes it and returns focus to the control (the
 * event never reaches the prompt's stop-task Escape), a click elsewhere closes it, and focus moves into it on open.
 */
export function ComposerPopover({
	open,
	onClose,
	anchorRef,
	label,
	role = "dialog",
	width = 320,
	testId,
	children,
}: ComposerPopoverProps) {
	const ref = useRef<HTMLDivElement>(null)
	const { width: vw, height: vh } = useWindowSize()
	const [style, setStyle] = useState<CSSProperties>({})

	useClickAway(ref, (e) => {
		if (anchorRef.current?.contains(e.target as Node)) {
			return
		}
		onClose()
	})

	useLayoutEffect(() => {
		if (!open || !anchorRef.current) {
			return
		}
		const rect = anchorRef.current.getBoundingClientRect()
		const w = Math.min(width, vw - GUTTER * 2)
		const left = Math.max(GUTTER, Math.min(rect.left, vw - GUTTER - w))
		setStyle({ left, width: w, bottom: vh - rect.top + GAP, maxHeight: Math.max(120, rect.top - GAP - GUTTER) })
	}, [open, anchorRef, vw, vh, width])

	useEffect(() => {
		if (!open) {
			return
		}
		const first = role === "menu" ? ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') : null
		;(first ?? ref.current)?.focus()
	}, [open, role])

	if (!open) {
		return null
	}

	const close = () => {
		onClose()
		anchorRef.current?.focus()
	}

	return (
		<div
			aria-label={label}
			aria-modal="false"
			className="aih-popover"
			data-testid={testId}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation()
					e.preventDefault()
					close()
					return
				}
				if (role === "menu" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
					e.preventDefault()
					const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
					const at = items.indexOf(document.activeElement as HTMLElement)
					const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length
					items[next]?.focus()
				}
			}}
			ref={ref}
			role={role}
			style={style}
			tabIndex={-1}>
			{children}
		</div>
	)
}

export default ComposerPopover
