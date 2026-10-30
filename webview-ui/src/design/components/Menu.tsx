import { type CSSProperties, type KeyboardEvent, type RefObject, useEffect, useId, useRef } from "react"
import { nextIndex } from "./roving"
import "./primitives.css"

export type MenuEntry =
	| {
			key: string
			icon?: string
			text: string
			/** Accessible name; contains the visible text. */
			label: string
			/** Why the item cannot act right now. Shown as text and wired to aria-describedby. */
			reason?: string
			shortcut?: string
			current?: boolean
			onSelect: () => void
	  }
	| { key: string; divider: true }

export interface MenuProps {
	/** Required: names the menu. */
	label: string
	entries: readonly MenuEntry[]
	/** The button that opened the menu: clicks on it do not count as "outside", and Escape returns focus to it. */
	triggerRef: RefObject<HTMLElement | null>
	/** `returnFocus` is true for Escape (focus goes back to the trigger), false for Tab or a click elsewhere. */
	onClose: (returnFocus: boolean) => void
	className?: string
	style?: CSSProperties
}

/**
 * A labelled menu. Mount it when open: it focuses the first item, arrow keys, Home and End move between items,
 * Escape closes and returns focus to the trigger, Tab or a click elsewhere closes. Disabled items stay focusable
 * (`aria-disabled`) so a keyboard user can read the reason.
 */
export function Menu({ label, entries, triggerRef, onClose, className, style }: MenuProps) {
	const menuRef = useRef<HTMLDivElement>(null)
	const baseId = useId()

	useEffect(() => {
		menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
	}, [])

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
				return
			}
			onClose(false)
		}
		document.addEventListener("pointerdown", onPointerDown, true)
		return () => document.removeEventListener("pointerdown", onPointerDown, true)
	}, [onClose, triggerRef])

	const onKeyDown = (e: KeyboardEvent) => {
		const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
		const at = items.indexOf(document.activeElement as HTMLElement)
		const to = nextIndex(e.key, at, items.length, "vertical")
		if (to !== null) {
			e.preventDefault()
			items[to]?.focus()
		} else if (e.key === "Escape") {
			e.preventDefault()
			e.stopPropagation()
			onClose(true)
		} else if (e.key === "Tab") {
			onClose(false)
		}
	}

	return (
		<div
			aria-label={label}
			className={["aih-menu", className].filter(Boolean).join(" ")}
			onKeyDown={onKeyDown}
			ref={menuRef}
			role="menu"
			style={style}>
			{entries.map((entry) =>
				"divider" in entry ? (
					<div className="aih-menu__divider" key={entry.key} role="separator" />
				) : (
					<button
						aria-current={entry.current ? "true" : undefined}
						aria-describedby={entry.reason ? `${baseId}-${entry.key}` : undefined}
						aria-disabled={entry.reason ? true : undefined}
						aria-label={entry.label}
						className={`aih-menu__item${entry.current ? " aih-menu__item--current" : ""}`}
						key={entry.key}
						onClick={() => {
							if (!entry.reason) {
								entry.onSelect()
							}
						}}
						role="menuitem"
						tabIndex={-1}
						title={entry.reason ? `${entry.label}: ${entry.reason}` : entry.label}
						type="button">
						{entry.icon && <span aria-hidden="true" className={`codicon codicon-${entry.icon}`} />}
						<span className="aih-menu__text">
							<span>{entry.text}</span>
							{entry.reason && (
								<span className="aih-menu__reason" id={`${baseId}-${entry.key}`}>
									{entry.reason}
								</span>
							)}
						</span>
						{entry.shortcut && <kbd className="aih-menu__kbd">{entry.shortcut}</kbd>}
					</button>
				),
			)}
		</div>
	)
}
