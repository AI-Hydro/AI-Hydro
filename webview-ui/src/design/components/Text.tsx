import type { ElementType, HTMLAttributes, ReactNode } from "react"
import "./primitives.css"

export type TextVariant = "caption" | "label" | "body" | "title" | "heading"

export interface TextProps extends HTMLAttributes<HTMLElement> {
	as?: ElementType
	variant?: TextVariant
	muted?: boolean
	strong?: boolean
	mono?: boolean
	/** Break long ids and digests instead of overflowing. */
	breakAll?: boolean
	children?: ReactNode
}

export function Text({
	as: Tag = "span",
	variant = "body",
	muted,
	strong,
	mono,
	breakAll,
	className,
	children,
	...rest
}: TextProps) {
	const classes = [
		"aih-text",
		`aih-text--${variant}`,
		muted && "aih-text--muted",
		strong && "aih-text--strong",
		mono && "aih-text--mono",
		breakAll && "aih-text--break",
		className,
	]
		.filter(Boolean)
		.join(" ")
	return (
		<Tag className={classes} {...rest}>
			{children}
		</Tag>
	)
}
