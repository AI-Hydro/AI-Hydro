import { type KeyboardEvent, type ReactNode, useId, useRef } from "react"
import { nextIndex, type Orientation } from "./roving"
import "./primitives.css"

export interface TabItem {
	id: string
	/** Required. It is the tab's accessible name and tooltip even when only the icon is drawn. */
	label: string
	/** Codicon name without prefix. Decorative; the label carries the meaning. */
	icon?: string
	/** Draw only the icon (a narrow sidebar). The label stays as the accessible name and tooltip. */
	iconOnly?: boolean
	disabled?: boolean
}

export interface TabsProps {
	/** Names the tab list for assistive technology, e.g. "Settings sections". */
	label: string
	items: readonly TabItem[]
	/** The selected tab's id. */
	value: string
	onValueChange: (id: string) => void
	orientation?: Orientation
	/** Base for the tab and panel ids; pass the same value to `TabPanel`. Defaults to a generated id. */
	idBase?: string
	className?: string
}

export const tabDomId = (idBase: string, id: string) => `${idBase}-tab-${id}`
export const tabPanelDomId = (idBase: string, id: string) => `${idBase}-panel-${id}`

/**
 * WAI-ARIA tabs (automatic activation): `tablist` > `tab`s, one tab stop (the selected tab), arrow keys move and
 * select, Home and End jump, disabled tabs are skipped. Pair each tab with a `TabPanel` using the same `idBase`.
 */
export function Tabs({ label, items, value, onValueChange, orientation = "horizontal", idBase, className }: TabsProps) {
	const generated = useId()
	const base = idBase ?? generated
	const listRef = useRef<HTMLDivElement>(null)
	const enabled = items.filter((item) => !item.disabled)
	// One tab stop: the selected tab, or, when the selection is not an enabled tab, the first enabled one.
	const stopId = enabled.some((item) => item.id === value) ? value : enabled[0]?.id

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const from = enabled.findIndex((item) => item.id === value)
		const to = nextIndex(e.key, from, enabled.length, orientation)
		if (to === null) {
			return
		}
		e.preventDefault()
		const target = enabled[to]
		onValueChange(target.id)
		listRef.current?.querySelector<HTMLElement>(`[id="${tabDomId(base, target.id)}"]`)?.focus()
	}

	return (
		<div
			aria-label={label}
			aria-orientation={orientation}
			className={["aih-tabs", `aih-tabs--${orientation}`, className].filter(Boolean).join(" ")}
			onKeyDown={onKeyDown}
			ref={listRef}
			role="tablist">
			{items.map((item) => {
				const selected = item.id === value
				return (
					<button
						aria-controls={selected ? tabPanelDomId(base, item.id) : undefined}
						aria-disabled={item.disabled || undefined}
						aria-label={item.iconOnly ? item.label : undefined}
						aria-selected={selected}
						className={["aih-tab", selected && "aih-tab--selected", item.iconOnly && "aih-tab--icon"]
							.filter(Boolean)
							.join(" ")}
						data-testid={`tab-${item.id}`}
						id={tabDomId(base, item.id)}
						key={item.id}
						onClick={() => {
							if (!item.disabled) {
								onValueChange(item.id)
							}
						}}
						role="tab"
						tabIndex={item.id === stopId ? 0 : -1}
						title={item.label}
						type="button">
						{item.icon && <span aria-hidden="true" className={`codicon codicon-${item.icon}`} />}
						{!item.iconOnly && <span className="aih-tab__label">{item.label}</span>}
					</button>
				)
			})}
		</div>
	)
}

export interface TabPanelProps {
	idBase: string
	/** The id of the tab this panel belongs to. */
	tab: string
	/** Render only while this tab is the selected one. */
	selected: boolean
	className?: string
	children: ReactNode
}

/** The panel a tab controls. Hidden panels are not rendered, so inactive tabs cost nothing. */
export function TabPanel({ idBase, tab, selected, className, children }: TabPanelProps) {
	if (!selected) {
		return null
	}
	return (
		<div
			aria-labelledby={tabDomId(idBase, tab)}
			className={className}
			id={tabPanelDomId(idBase, tab)}
			role="tabpanel"
			tabIndex={0}>
			{children}
		</div>
	)
}
