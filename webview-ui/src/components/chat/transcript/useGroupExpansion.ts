import type { DetailLevel } from "@shared/aihydro/transcriptPresenter"
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * The reader's open/closed choice per work group, keyed by the group's stable key. Absent = the presenter's default
 * for the level (the live tail is open at Normal, closed at Focus).
 *
 * The choice belongs to the level it was made at: switching level clears it, so Focus can never inherit a group the
 * reader opened at Normal (the "Focus looks like Normal" cause). Only groups are affected. A pending ask, an error,
 * a refusal or an answer is its own item, not a group, so a reset cannot collapse or hide one; lifted lines render
 * outside the collapsible panel for the same reason.
 */
export function useGroupExpansion(detail: DetailLevel) {
	const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>({})
	const onToggleGroup = useCallback((key: string, current: boolean) => {
		setGroupExpanded((prev) => ({ ...prev, [key]: !current }))
	}, [])
	const lastDetail = useRef(detail)
	useEffect(() => {
		if (lastDetail.current !== detail) {
			lastDetail.current = detail
			setGroupExpanded({})
		}
	}, [detail])
	return { groupExpanded, onToggleGroup }
}
