import type { CSSProperties, ReactNode } from "react"
import { type EvidenceStateId, evidenceState } from "../evidenceStates"
import "./primitives.css"

export interface BadgeProps {
	children: ReactNode
	/** Optional decorative codicon name without prefix. */
	icon?: string
	title?: string
}

/** Neutral badge (counts, tags). Carries no evidence meaning. */
export function Badge({ children, icon, title }: BadgeProps) {
	return (
		<span className="aih-badge aih-badge--outline" title={title}>
			{icon && <span aria-hidden="true" className={`codicon codicon-${icon}`} />}
			{children}
		</span>
	)
}

export interface EvidenceBadgeProps {
	state: EvidenceStateId
	/** Replaces the default label text (e.g. "Class not reported"); the icon and shape still come from the state. */
	label?: string
	/** Extra text appended after the label, e.g. a trust root. */
	detail?: string
}

/** State badge: icon + text label + border shape. Colour is supplementary. */
export function EvidenceBadge({ state, label, detail }: EvidenceBadgeProps) {
	const def = evidenceState(state)
	const style = { "--aih-badge-color": def.token } as CSSProperties
	return (
		<span className={`aih-badge aih-badge--${def.shape}`} data-evidence-state={def.id} style={style} title={def.description}>
			<span aria-hidden="true" className={`codicon ${def.icon}`} />
			<span>{label ?? def.label}</span>
			{detail && <span className="aih-text--muted">{detail}</span>}
		</span>
	)
}
