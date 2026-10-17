import type { ReactNode } from "react"
import { Text } from "./Text"
import "./primitives.css"

export interface PanelHeaderProps {
	title: string
	description?: string
	/** Heading level for the title; defaults to 1 (a panel is its own document). */
	level?: 1 | 2 | 3
	actions?: ReactNode
}

export function PanelHeader({ title, description, level = 1, actions }: PanelHeaderProps) {
	return (
		<header className="aih-panelheader">
			<div className="aih-panelheader__titles">
				<Text as={`h${level}`} variant="title">
					{title}
				</Text>
				{description && (
					<Text as="p" muted variant="caption">
						{description}
					</Text>
				)}
			</div>
			{actions && <div className="aih-panelheader__actions">{actions}</div>}
		</header>
	)
}
