import { formatLargeNumber } from "@/utils/format"

interface ContextRingProps {
	/** Per-request context tokens (the same `lastApiReqTotalTokens` the task header's ContextWindow uses). */
	used?: number
	/** Model context window in tokens. */
	contextWindow?: number
}

const SIZE = 16
const STROKE = 2.5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Context usage ring. Percent is as in task-header/ContextWindow: per-request tokens over the model window. */
export function ContextRing({ used, contextWindow }: ContextRingProps) {
	const known = !!contextWindow && !!used && used > 0
	const ratio = known ? Math.min(1, used / contextWindow) : 0
	const percent = Math.round(ratio * 100)
	const label = known ? `Context ${percent}% of ${formatLargeNumber(contextWindow)}` : "Context usage unknown"
	const high = known && ratio >= 0.9
	return (
		<span className="inline-flex items-center gap-1 shrink-0 text-[11px] text-[var(--vscode-descriptionForeground)]">
			<svg aria-label={label} height={SIZE} role="img" viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE}>
				<title>{label}</title>
				<circle
					cx={SIZE / 2}
					cy={SIZE / 2}
					fill="none"
					opacity={0.35}
					r={RADIUS}
					stroke="currentColor"
					strokeWidth={STROKE}
				/>
				{known && (
					<circle
						cx={SIZE / 2}
						cy={SIZE / 2}
						fill="none"
						r={RADIUS}
						stroke={high ? "var(--vscode-editorWarning-foreground)" : "var(--vscode-foreground)"}
						strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}
						strokeLinecap="butt"
						strokeWidth={STROKE}
						transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
					/>
				)}
			</svg>
			<span aria-hidden="true">{known ? `${percent}%` : "?"}</span>
		</span>
	)
}
