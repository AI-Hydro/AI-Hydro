import type { FuseResult } from "fuse.js"
import { Fragment } from "react"

export type MatchRegion = [number, number]

/** Sort and merge overlapping or adjacent inclusive [start, end] regions (Fuse match indices). */
export const mergeMatchRegions = (regions: readonly MatchRegion[]): MatchRegion[] => {
	const sorted = regions.map(([a, b]): MatchRegion => [a, b]).sort((a, b) => a[0] - b[0])
	const merged: MatchRegion[] = []
	for (const region of sorted) {
		const last = merged[merged.length - 1]
		if (last && region[0] <= last[1] + 1) last[1] = Math.max(last[1], region[1])
		else merged.push(region)
	}
	return merged
}

/**
 * Attach the merged Fuse match regions for `key` to each result item as `matchRegions`. The text itself is never
 * modified: callers render it as text nodes, so task titles can never contribute markup.
 */
export function withMatchRegions<T extends object>(
	results: FuseResult<T>[],
	key = "task",
): (T & { matchRegions: MatchRegion[] })[] {
	return results
		.filter(({ matches }) => matches && matches.length)
		.map(({ item, matches }) => {
			const indices = (matches ?? [])
				.filter((m) => m.key === key && typeof m.value === "string")
				.flatMap((m) => m.indices ?? [])
			return { ...item, matchRegions: mergeMatchRegions(indices as MatchRegion[]) }
		})
}

/** Plain text with the given regions wrapped in `<span className=...>`; every slice is a React text node (escaped by React). */
export function HighlightedText({
	text,
	regions = [],
	className = "history-item-highlight",
}: {
	text: string
	regions?: readonly MatchRegion[]
	className?: string
}) {
	const merged = mergeMatchRegions(regions)
	if (merged.length === 0) return <>{text}</>
	const nodes: React.ReactNode[] = []
	let cursor = 0
	merged.forEach(([start, end], i) => {
		if (start > cursor) nodes.push(<Fragment key={`t${i}`}>{text.slice(cursor, start)}</Fragment>)
		nodes.push(
			<span className={className} key={`h${i}`}>
				{text.slice(start, end + 1)}
			</span>,
		)
		cursor = end + 1
	})
	if (cursor < text.length) nodes.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>)
	return <>{nodes}</>
}
