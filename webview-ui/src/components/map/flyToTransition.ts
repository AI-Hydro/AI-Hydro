import { FlyToInterpolator } from "@deck.gl/core"
import { prefersReducedMotion } from "@/utils/prefersReducedMotion"

/**
 * deck.gl viewState transition props for an animated fly-to. Under prefers-reduced-motion it returns no transition
 * props at all, so the view jumps to its target instead of animating.
 */
export function flyToTransition(durationMs?: number): {
	transitionDuration?: number
	transitionInterpolator?: FlyToInterpolator
} {
	if (prefersReducedMotion()) return {}
	return { transitionDuration: durationMs ?? 2000, transitionInterpolator: new FlyToInterpolator({ speed: 1.2 }) }
}
