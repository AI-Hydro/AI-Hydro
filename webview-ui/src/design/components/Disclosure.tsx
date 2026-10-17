import { type ReactNode, useId, useState } from "react"
import "./primitives.css"

export interface DisclosureProps {
	label: string
	defaultOpen?: boolean
	children: ReactNode
}

/** Collapsible region: a real button with aria-expanded controlling a labelled panel. */
export function Disclosure({ label, defaultOpen = false, children }: DisclosureProps) {
	const [open, setOpen] = useState(defaultOpen)
	const panelId = useId()
	return (
		<div className="aih-disclosure">
			<button
				aria-controls={panelId}
				aria-expanded={open}
				className="aih-disclosure__trigger"
				onClick={() => setOpen((v) => !v)}
				type="button">
				<span aria-hidden="true" className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
				{label}
			</button>
			<div className="aih-disclosure__panel" hidden={!open} id={panelId} role="region" aria-label={label}>
				{open ? children : null}
			</div>
		</div>
	)
}
