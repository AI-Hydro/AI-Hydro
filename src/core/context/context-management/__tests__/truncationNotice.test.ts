import { expect } from "chai"
import { buildContextTruncationNotice } from "../truncationNotice"

describe("buildContextTruncationNotice (W2-0h: truncation is no longer silent)", () => {
	it("reports newly dropped, total dropped, kept and the deleted range", () => {
		const { text, notice } = buildContextTruncationNotice(undefined, [2, 21], 40)
		expect(notice.class).to.equal("context_truncated")
		expect(notice.severity).to.equal("warning")
		expect(notice.detail).to.deep.equal({ deletedRange: [2, 21], newlyDropped: 20, totalDropped: 20, historyLength: 40 })
		expect(text).to.include("dropped 20 earlier messages")
		expect(text).to.include("20 of 40 kept")
	})

	it("counts only what this truncation added when an earlier range existed", () => {
		const { text, notice } = buildContextTruncationNotice([2, 11], [2, 29], 50)
		expect(notice.detail).to.include({ newlyDropped: 18, totalDropped: 28, historyLength: 50 })
		expect(text).to.include("dropped 18 earlier messages")
		expect(text).to.include("22 of 50 kept")
	})

	it("says so honestly when nothing further could be dropped, and never reports a negative count", () => {
		const unchanged = buildContextTruncationNotice([2, 11], [2, 11], 14)
		expect(unchanged.notice.detail).to.include({ newlyDropped: 0, totalDropped: 10 })
		expect(unchanged.text).to.include("no further messages could be dropped")
		// ContextManager can return an empty range ([2, 1]) on a short history
		const empty = buildContextTruncationNotice(undefined, [2, 1], 3)
		expect(empty.notice.detail).to.include({ newlyDropped: 0, totalDropped: 0 })
	})

	it("uses the singular for one message", () => {
		expect(buildContextTruncationNotice(undefined, [2, 2], 9).text).to.include("dropped 1 earlier message ")
	})
})
