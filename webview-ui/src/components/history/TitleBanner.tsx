import { Button, Text } from "@/design"

export interface TitleBannerProps {
	/** Chats a run would title. */
	count: number
	/** Estimated tokens for the whole run (the plan's per-chat figure times the count). */
	estimatedTokens: number
	/** The model the calls go to, in words ("your chat model" or the configured id). */
	modelLabel: string
	running: boolean
	/** Left to do while running. */
	remaining: number
	/** The last run's outcome, shown once. */
	outcome?: string
	onStart: () => void
	onCancel: () => void
	onDismiss: () => void
}

const formatTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/**
 * The opt-in for titling earlier chats with a model (PSMH M2, D5). It never runs by itself: the button is the consent,
 * and it says what is sent and roughly what it costs before the click.
 */
export function TitleBanner({
	count,
	estimatedTokens,
	modelLabel,
	running,
	remaining,
	outcome,
	onStart,
	onCancel,
	onDismiss,
}: TitleBannerProps) {
	if (outcome && !running) {
		return (
			<section aria-label="Title earlier chats" className="history-banner" role="region">
				<Text as="p" role="status" variant="label">
					{outcome}
				</Text>
				<div className="history-banner__actions">
					<Button onClick={onDismiss} variant="ghost">
						Dismiss
					</Button>
				</div>
			</section>
		)
	}
	if (count === 0 && !running) {
		return null
	}
	return (
		<section aria-label="Title earlier chats" className="history-banner" role="region">
			{running ? (
				<Text as="p" role="status" variant="label">
					Titling earlier chats: {remaining} left.
				</Text>
			) : (
				<>
					<Text as="p" variant="label">
						{count === 1 ? "1 earlier chat has" : `${count} earlier chats have`} only a short automatic name. A model
						can write better ones.
					</Text>
					<Text as="p" muted variant="caption">
						Sends each chat's first message and first reply to {modelLabel} (about {formatTokens(estimatedTokens)}{" "}
						tokens in all, an estimate). Chats you renamed are left alone.
					</Text>
				</>
			)}
			<div className="history-banner__actions">
				{running ? (
					<Button onClick={onCancel} variant="secondary">
						Cancel
					</Button>
				) : (
					<>
						<Button onClick={onStart} variant="primary">
							{count === 1 ? "Generate title for 1 chat" : `Generate titles for ${count} chats`}
						</Button>
						<Button onClick={onDismiss} variant="ghost">
							Not now
						</Button>
					</>
				)}
			</div>
		</section>
	)
}
