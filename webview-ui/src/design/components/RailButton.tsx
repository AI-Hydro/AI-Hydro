import { type ButtonHTMLAttributes, forwardRef, useId } from "react"
import "./primitives.css"

export interface RailButtonProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label" | "aria-pressed" | "aria-expanded" | "children"> {
	/** Codicon name without prefix. Decorative; the label carries the meaning. */
	icon: string
	/** Required accessible name; also the tooltip. The type system enforces it. */
	label: string
	/** A toggle: sets `aria-pressed`. Leave unset for a plain action. */
	active?: boolean
	/** The button opens a menu or panel: sets `aria-expanded`. Use instead of `active` for a disclosure. */
	expanded?: boolean
	/** What kind of popup the button opens (`aria-haspopup`). Say it when it is one; `expanded` alone claims nothing. */
	popup?: "menu" | "dialog" | "listbox" | "tree" | "grid"
	/** A count drawn on the corner (capped at 99+). */
	badge?: number
	/**
	 * Why the button cannot act right now. The button stays focusable (`aria-disabled`), does not fire `onClick`, and
	 * the reason is its tooltip and its accessible description.
	 */
	reason?: string
	/** Draw the reason as visible text beside the icon, for a button with room for it. Default: tooltip and description only. */
	showReason?: boolean
}

/** A 32 px icon button for a tool rail or toolbar. Always a real button with a name; a toggle states its state. */
export const RailButton = forwardRef<HTMLButtonElement, RailButtonProps>(function RailButton(
	{ icon, label, active, expanded, popup, badge, reason, showReason, className, onClick, title, ...rest },
	ref,
) {
	const reasonId = useId()
	// The count is part of the name: a screen reader hears "Alerts, 3", not just "Alerts".
	const name = badge === undefined ? label : `${label}, ${badge}`
	return (
		<button
			aria-describedby={reason ? reasonId : undefined}
			aria-disabled={reason ? true : undefined}
			aria-expanded={expanded === undefined ? undefined : expanded}
			aria-haspopup={popup}
			aria-label={name}
			aria-pressed={active === undefined ? undefined : active}
			className={[
				"aih-rail-btn",
				(active || expanded) && "aih-rail-btn--active",
				reason && showReason && "aih-rail-btn--reason",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			onClick={(e) => {
				if (!reason) {
					onClick?.(e)
				}
			}}
			ref={ref}
			title={title ?? (reason ? `${name}: ${reason}` : name)}
			type="button"
			{...rest}>
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
			{badge !== undefined && <span className="aih-rail-btn__badge">{badge > 99 ? "99+" : badge}</span>}
			{reason && (
				<span className={showReason ? "aih-rail-btn__reason" : "aih-visually-hidden"} id={reasonId}>
					{reason}
				</span>
			)}
		</button>
	)
})
