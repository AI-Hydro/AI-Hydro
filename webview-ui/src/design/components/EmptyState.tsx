import { Button, type ButtonVariant } from "./Button"
import { Text } from "./Text"
import "./primitives.css"

export interface EmptyStateAction {
	label: string
	onClick: () => void
	variant?: ButtonVariant
	icon?: string
}

export interface EmptyStateProps {
	/** Decorative codicon name without prefix. */
	icon?: string
	title: string
	description?: string
	/** Rendered as real <button>s, never styled divs. */
	actions?: EmptyStateAction[]
}

/** Opaque card for "nothing here yet" states. Safe to place over a basemap. */
export function EmptyState({ icon, title, description, actions = [] }: EmptyStateProps) {
	return (
		<section aria-label={title} className="aih-empty">
			{icon && <span aria-hidden="true" className={`aih-empty__icon codicon codicon-${icon}`} />}
			<Text as="h2" variant="title">
				{title}
			</Text>
			{description && (
				<Text as="p" muted>
					{description}
				</Text>
			)}
			{actions.length > 0 && (
				<div className="aih-empty__actions">
					{actions.map((action) => (
						<Button
							icon={action.icon}
							key={action.label}
							onClick={action.onClick}
							variant={action.variant ?? "secondary"}>
							{action.label}
						</Button>
					))}
				</div>
			)}
		</section>
	)
}
