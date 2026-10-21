import { useEffect, useState } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

export function usePrefersReducedMotion(): boolean {
	const read = () =>
		typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : false
	const [reduced, setReduced] = useState(read)
	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			return
		}
		const mq = window.matchMedia(QUERY)
		const onChange = () => setReduced(mq.matches)
		mq.addEventListener?.("change", onChange)
		return () => mq.removeEventListener?.("change", onChange)
	}, [])
	return reduced
}
