import type { ButtonHTMLAttributes } from "react"
import "./primitives.css"

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label" | "children"> {
	/** Codicon name without prefix, e.g. "close". Decorative; the label carries the meaning. */
	icon: string
	/** Required accessible name; also used as the tooltip. The type system enforces it. */
	label: string
	active?: boolean
}

/** Icon-only button with a mandatory label and a 24px-minimum target. */
export function IconButton({ icon, label, active, className, title, ...rest }: IconButtonProps) {
	return (
		<button
			aria-label={label}
			aria-pressed={active === undefined ? undefined : active}
			className={["aih-iconbtn", active && "aih-iconbtn--active", className].filter(Boolean).join(" ")}
			title={title ?? label}
			type="button"
			{...rest}>
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
		</button>
	)
}
