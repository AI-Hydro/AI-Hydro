import { useEffect, useRef, useState } from "react"

/**
 * The single polite live region for the transcript. It carries short status text only ("Running ...", "Answer
 * ready"), never streamed tokens, and is throttled so a fast run does not become a stream of announcements.
 */
export function TranscriptStatus({ text, throttleMs = 2000 }: { text: string; throttleMs?: number }) {
	const [shown, setShown] = useState(text)
	const lastAt = useRef(0)
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	useEffect(() => {
		if (text === shown) {
			return
		}
		const wait = Math.max(0, lastAt.current + throttleMs - Date.now())
		if (timer.current) {
			clearTimeout(timer.current)
		}
		timer.current = setTimeout(() => {
			lastAt.current = Date.now()
			setShown(text)
		}, wait)
		return () => {
			if (timer.current) {
				clearTimeout(timer.current)
			}
		}
	}, [text, shown, throttleMs])

	return (
		<div aria-atomic="true" aria-live="polite" className="transcript-sr-only" data-testid="transcript-status" role="status">
			{shown}
		</div>
	)
}
