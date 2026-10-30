import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from "react"
import { nextIndex, type Orientation } from "./roving"
import "./primitives.css"

export interface ToolbarProps {
	/** Required: names the toolbar, e.g. "Map tools". */
	label: string
	orientation?: Orientation
	className?: string
	children: ReactNode
}

/** What the arrow keys move between: buttons (including aria-disabled ones, so a reason can be read), not menu items. */
const ITEM = 'button:not(:disabled):not([role="menuitem"]):not([role="tab"]), [data-aih-roving]'
const inMenu = (el: Element) => el.closest('[role="menu"]') !== null

/**
 * WAI-ARIA toolbar: one tab stop for the whole group (the last item used, else the first), arrow keys move within
 * it, Home and End jump. Items are the real `button`s inside; add `data-aih-roving` to another focusable element to
 * include it. Buttons inside an open menu are left to the menu.
 */
export function Toolbar({ label, orientation = "horizontal", className, children }: ToolbarProps) {
	const ref = useRef<HTMLDivElement>(null)
	const current = useRef<Element | null>(null)

	const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM) ?? []).filter((el) => !inMenu(el))

	// One tab stop. Re-run when the children change so a button mounted later does not become a second stop.
	useLayoutEffect(() => {
		const root = ref.current
		if (!root) {
			return
		}
		const sync = () => {
			const all = items()
			if (!all.some((el) => el === current.current)) {
				current.current = all[0] ?? null
			}
			for (const el of all) {
				el.tabIndex = el === current.current ? 0 : -1
			}
		}
		sync()
		const observer = new MutationObserver(sync)
		observer.observe(root, { childList: true, subtree: true })
		return () => observer.disconnect()
	}, [])

	const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
		const all = items()
		const hit = all.find((el) => el === e.target)
		if (hit) {
			current.current = hit
			for (const el of all) {
				el.tabIndex = el === hit ? 0 : -1
			}
		}
	}

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (inMenu(e.target as Element)) {
			return
		}
		const all = items()
		const from = all.findIndex((el) => el === e.target)
		if (from < 0) {
			return
		}
		const to = nextIndex(e.key, from, all.length, orientation)
		if (to === null) {
			return
		}
		e.preventDefault()
		all[to].focus()
	}

	return (
		<div
			aria-label={label}
			aria-orientation={orientation}
			className={["aih-toolbar", `aih-toolbar--${orientation}`, className].filter(Boolean).join(" ")}
			onFocus={onFocus}
			onKeyDown={onKeyDown}
			ref={ref}
			role="toolbar">
			{children}
		</div>
	)
}
