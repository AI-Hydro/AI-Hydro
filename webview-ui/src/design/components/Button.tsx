import type { ButtonHTMLAttributes, ReactNode } from "react"
import "./primitives.css"

export type ButtonVariant = "primary" | "secondary" | "ghost"

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
	variant?: ButtonVariant
	/** Optional leading codicon name without prefix, e.g. "folder-opened". Decorative. */
	icon?: string
	type?: "button" | "submit"
	children: ReactNode
}

/** Text button. Always a real <button>; children are the accessible name. */
export function Button({ variant = "secondary", icon, type = "button", className, children, ...rest }: ButtonProps) {
	return (
		<button
			className={["aih-btn", variant !== "secondary" && `aih-btn--${variant}`, className].filter(Boolean).join(" ")}
			type={type}
			{...rest}>
			{icon && <span aria-hidden="true" className={`codicon codicon-${icon}`} />}
			{children}
		</button>
	)
}
