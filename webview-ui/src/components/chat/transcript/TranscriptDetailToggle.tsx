import type { DetailLevel } from "@shared/aihydro/transcriptPresenter"

const LEVELS: Array<{ id: DetailLevel; label: string; hint: string }> = [
	{ id: "focus", label: "Focus", hint: "Answers and anything that needs you" },
	{ id: "normal", label: "Normal", hint: "Work grouped, problems listed" },
	{ id: "verbose", label: "Verbose", hint: "Every row, as recorded" },
]

interface TranscriptDetailToggleProps {
	value: DetailLevel
	onChange: (level: DetailLevel) => void
}

/** Three-way detail control for the transcript (Focus / Normal / Verbose). The same setting the command cycles. */
export function TranscriptDetailToggle({ value, onChange }: TranscriptDetailToggleProps) {
	return (
		<div aria-label="Transcript detail" className="transcript-detail" role="group">
			{LEVELS.map((level) => (
				<button
					aria-pressed={value === level.id}
					className="transcript-btn transcript-detail-option"
					key={level.id}
					onClick={() => onChange(level.id)}
					title={level.hint}
					type="button">
					{level.label}
				</button>
			))}
		</div>
	)
}
