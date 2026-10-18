/** True when the user asked the OS/host for reduced motion. Safe where matchMedia is missing (tests, SSR). */
export function prefersReducedMotion(): boolean {
	try {
		return typeof window !== "undefined" && typeof window.matchMedia === "function"
			? window.matchMedia("(prefers-reduced-motion: reduce)").matches
			: false
	} catch {
		return false
	}
}
