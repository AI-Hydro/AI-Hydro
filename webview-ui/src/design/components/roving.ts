/**
 * Keyboard model shared by Tabs, Toolbar and Menu: which element a key moves to, from where. Pure, so the three
 * widgets cannot drift apart. Arrow keys wrap; Home and End go to the ends.
 */
export type Orientation = "horizontal" | "vertical"

/** The index to move to for `key`, or null when the key is not a movement key for this orientation. */
export function nextIndex(key: string, current: number, count: number, orientation: Orientation): number | null {
	if (count === 0) {
		return null
	}
	const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown"
	const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp"
	if (key === forward) {
		return (current + 1 + count) % count
	}
	if (key === backward) {
		return current <= 0 ? count - 1 : current - 1
	}
	if (key === "Home") {
		return 0
	}
	if (key === "End") {
		return count - 1
	}
	return null
}
