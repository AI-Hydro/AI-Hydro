import { type InfoNotice, infoNoticeFor } from "@shared/aihydro/infoNotice"

/** Inclusive `[start, end]` indices of API-history messages hidden from the model (ContextManager's convention). */
export type DeletedRange = [number, number] | undefined

const countIn = (range: DeletedRange): number => (range ? Math.max(range[1] - range[0] + 1, 0) : 0)

/**
 * The evidence row for a forced context truncation (the provider rejected the request as too large, so history was
 * dropped and the request retried). Until W2-0h this was silent: the model lost earlier turns and the user was never
 * told. Counts are of API-history messages, which are not the same as chat rows.
 */
export function buildContextTruncationNotice(
	previous: DeletedRange,
	next: DeletedRange,
	historyLength: number,
): { text: string; notice: InfoNotice } {
	const totalDropped = countIn(next)
	const newlyDropped = Math.max(totalDropped - countIn(previous), 0)
	const kept = Math.max(historyLength - totalDropped, 0)
	const text =
		newlyDropped > 0
			? `Context window exceeded: dropped ${newlyDropped} earlier message${newlyDropped === 1 ? "" : "s"} from the model's context (${kept} of ${historyLength} kept) and retried.`
			: `Context window exceeded: no further messages could be dropped (${kept} of ${historyLength} kept); retried.`
	return {
		text,
		notice: infoNoticeFor("context_truncated", {
			deletedRange: next ? [next[0], next[1]] : [],
			newlyDropped,
			totalDropped,
			historyLength,
		}),
	}
}
