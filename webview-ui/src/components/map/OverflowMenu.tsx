/**
 * OverflowMenu: the one "more actions" menu the map panels share (Layers rows, Pins rows, panel headers).
 *
 * A 24 px ellipsis button opens a menu next to it. The menu is drawn in a portal with fixed positioning, so a panel's
 * `overflow: hidden` or a scrolling list never clips it, and it flips above the button when there is no room below.
 * Same look as the rail's More menu (`map-chrome-menu`). Arrow keys, Home and End move between items, Escape closes and
 * returns focus to the button, Tab or a click elsewhere closes. A disabled item stays focusable with its reason as text
 * so a keyboard user can read why. Scrolling or resizing closes it, because its anchor would have moved.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MAP_Z } from "./mapZ"

export type OverflowItem =
	| {
			key: string
			label: string
			/** Codicon name without the prefix. */
			icon?: string
			onSelect: () => void
			/** Why the item cannot act right now. Shown as text; selecting it does nothing. */
			disabledReason?: string
			/** Destructive actions are tinted, never big or red-filled. */
			danger?: boolean
			/** A toggle's state, announced as `aria-checked`. */
			checked?: boolean
			shortcut?: string
	  }
	| { key: string; divider: true }

interface OverflowMenuProps {
	/** Accessible name of the trigger, e.g. `Actions for watershed_01031500`. */
	label: string
	items: OverflowItem[]
	/** Trigger icon. Defaults to the ellipsis. */
	icon?: string
	/** Visible text beside the icon (a labelled button such as "Add"). The trigger is icon-only without it. */
	text?: string
	/** Called when the menu opens or closes (the Layers row uses it to keep its actions visible). */
	onOpenChange?: (open: boolean) => void
	className?: string
}

const MENU_GAP = 4
const MENU_MARGIN = 6

export const OverflowMenu: React.FC<OverflowMenuProps> = ({ label, items, icon = "ellipsis", text, onOpenChange, className }) => {
	const [open, setOpenRaw] = useState(false)
	const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const baseId = useId()

	const setOpen = useCallback(
		(next: boolean, returnFocus = false) => {
			setOpenRaw(next)
			onOpenChange?.(next)
			if (!next) {
				setPos(null)
				if (returnFocus) setTimeout(() => triggerRef.current?.focus(), 0)
			}
		},
		[onOpenChange],
	)

	// Place the menu once it has a size: below the button and right-aligned with it, or above when it would not fit.
	useLayoutEffect(() => {
		if (!open) return
		const trigger = triggerRef.current?.getBoundingClientRect()
		const menu = menuRef.current
		if (!trigger || !menu) return
		const height = menu.offsetHeight
		const width = menu.offsetWidth
		const spaceBelow = window.innerHeight - trigger.bottom - MENU_GAP - MENU_MARGIN
		const spaceAbove = trigger.top - MENU_GAP - MENU_MARGIN
		const below = height <= spaceBelow || spaceBelow >= spaceAbove
		const maxHeight = Math.max(120, below ? spaceBelow : spaceAbove)
		const shown = Math.min(height, maxHeight)
		const top = below ? trigger.bottom + MENU_GAP : trigger.top - MENU_GAP - shown
		const left = Math.max(MENU_MARGIN, Math.min(trigger.right - width, window.innerWidth - width - MENU_MARGIN))
		setPos({ top, left, maxHeight })
	}, [open])

	useEffect(() => {
		if (!open) return
		menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node
			if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
			setOpen(false)
		}
		const close = () => setOpen(false)
		document.addEventListener("pointerdown", onPointerDown, true)
		window.addEventListener("resize", close)
		window.addEventListener("scroll", close, true)
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true)
			window.removeEventListener("resize", close)
			window.removeEventListener("scroll", close, true)
		}
	}, [open, setOpen])

	const onKeyDown = (e: React.KeyboardEvent) => {
		const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])
		const at = nodes.indexOf(document.activeElement as HTMLElement)
		const go = (i: number) => {
			e.preventDefault()
			nodes[(i + nodes.length) % nodes.length]?.focus()
		}
		if (e.key === "ArrowDown") go(at + 1)
		else if (e.key === "ArrowUp") go(at <= 0 ? nodes.length - 1 : at - 1)
		else if (e.key === "Home") go(0)
		else if (e.key === "End") go(nodes.length - 1)
		else if (e.key === "Escape") {
			e.preventDefault()
			e.stopPropagation()
			setOpen(false, true)
		} else if (e.key === "Tab") setOpen(false)
	}

	return (
		<>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label={label}
				className={`map-overflow-trigger${text ? " map-overflow-trigger--text" : ""}${className ? ` ${className}` : ""}`}
				onClick={(e) => {
					e.stopPropagation()
					setOpen(!open, open)
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" && !open) {
						e.preventDefault()
						setOpen(true)
					}
				}}
				ref={triggerRef}
				title={label}
				type="button">
				<span aria-hidden="true" className={`codicon codicon-${icon}`} />
				{text && <span>{text}</span>}
			</button>
			{open &&
				createPortal(
					<div
						aria-label={label}
						className="map-chrome-menu"
						data-map-chrome="menu"
						onKeyDown={onKeyDown}
						ref={menuRef}
						role="menu"
						style={{
							position: "fixed",
							zIndex: MAP_Z.menu,
							top: pos?.top ?? 0,
							left: pos?.left ?? 0,
							maxHeight: pos?.maxHeight,
							overflowY: "auto",
							// Measured off-screen first, then placed, so it never flashes in the wrong spot.
							visibility: pos ? "visible" : "hidden",
						}}>
						{items.map((item) =>
							"divider" in item ? (
								<div className="map-chrome-menu__divider" key={item.key} role="separator" />
							) : (
								<button
									aria-checked={item.checked}
									aria-describedby={item.disabledReason ? `${baseId}-${item.key}` : undefined}
									aria-disabled={item.disabledReason ? true : undefined}
									className={`map-chrome-menu__item${item.danger ? " map-chrome-menu__item--danger" : ""}`}
									key={item.key}
									onClick={() => {
										if (item.disabledReason) return
										setOpen(false, true)
										item.onSelect()
									}}
									role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
									tabIndex={-1}
									title={item.disabledReason ? `${item.label} (${item.disabledReason})` : undefined}
									type="button">
									<span
										aria-hidden="true"
										className={`codicon ${item.checked ? "codicon-check" : item.icon ? `codicon-${item.icon}` : "map-overflow-spacer"}`}
									/>
									<span className="map-chrome-menu__text">
										<span>{item.label}</span>
										{item.disabledReason && (
											<span className="map-chrome-menu__reason" id={`${baseId}-${item.key}`}>
												{item.disabledReason}
											</span>
										)}
									</span>
									{item.shortcut && <kbd className="map-chrome-menu__kbd">{item.shortcut}</kbd>}
								</button>
							),
						)}
					</div>,
					document.body,
				)}
		</>
	)
}
