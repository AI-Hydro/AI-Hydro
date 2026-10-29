/**
 * X1-C0: makes the chat clutter and "Focus looks the same as Normal" measurable. For each P0 fixture (and three
 * older ones) it runs the real presenter at every detail level and records how many rows a reader gets. The counts
 * are computed here, never typed in; `screens-baseline/chat-detail-rows.json` is their committed "before" and this
 * test fails when the presenter output drifts from it.
 *
 * No resolvers are passed, so every MCP call has an unknown effect and lifts: that is the unannotated-server world
 * the owner's session was in (the fail-safe documented on PresentOptions).
 *
 * X1-C1 changes these numbers on purpose. It regenerates the file with
 *   UPDATE_CHAT_DETAIL_BASELINE=1 npm run test -- chatDetailBaseline
 * and the diff of that file is the evidence of what Focus now hides.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { type DetailLevel, presentTranscript, type TranscriptItem } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import * as tx from "../fixtures/transcripts"

const FIXTURES: Record<string, AiHydroMessage[]> = {
	// X1-C0 fixtures
	ownerApprovalPendingTask: tx.ownerApprovalPendingTask,
	autoRunAllCommandsTask: tx.autoRunAllCommandsTask,
	manyUnannotatedTask: tx.manyUnannotatedTask,
	mapLaunchedFirstTurnTask: tx.mapLaunchedFirstTurnTask,
	// older fixtures X1-C1 also changes
	run8ToolsTask: tx.run8ToolsTask,
	turnMachineryTask: tx.turnMachineryTask,
	failureLiftedTask: tx.failureLiftedTask,
}
const LEVELS: DetailLevel[] = ["focus", "normal", "verbose"]
const FILE = resolve(__dirname, "../../../screens-baseline/chat-detail-rows.json")

interface Row {
	/** Presenter items (verbose: one per recorded message). */
	items: number
	groups: number
	/** Lifted lines under all group headers: the lines a reader sees without expanding anything. */
	liftedLines: number
	liftedByReason: Record<string, number>
	/** Calls the group headers count (what a header says it folded). */
	headerCalls: number
	pending: number
	/** Rows a reader scans without expanding: every non-group item, plus one header and its lifted lines per group. */
	visibleRows: number
}

function measure(messages: AiHydroMessage[], detail: DetailLevel): Row {
	const items: TranscriptItem[] = presentTranscript(messages, { detail })
	const row: Row = {
		items: items.length,
		groups: 0,
		liftedLines: 0,
		liftedByReason: {},
		headerCalls: 0,
		pending: 0,
		visibleRows: 0,
	}
	for (const item of items) {
		if (item.kind === "group") {
			row.groups++
			row.liftedLines += item.lifted.length
			row.headerCalls += item.facts.toolCount
			row.visibleRows += 1 + item.lifted.length
			for (const l of item.lifted) {
				row.liftedByReason[l.reason] = (row.liftedByReason[l.reason] ?? 0) + 1
			}
		} else {
			row.visibleRows++
			if (item.kind === "pending") row.pending++
		}
	}
	return row
}

const table = () =>
	Object.fromEntries(
		Object.entries(FIXTURES).map(([name, msgs]) => [name, Object.fromEntries(LEVELS.map((d) => [d, measure(msgs, d)]))]),
	) as Record<string, Record<DetailLevel, Row>>

describe("chat detail baseline (X1-C0)", () => {
	it("matches the committed per-level row counts", () => {
		const now = table()
		if (process.env.UPDATE_CHAT_DETAIL_BASELINE === "1" || !existsSync(FILE)) {
			writeFileSync(FILE, JSON.stringify(now, null, "\t") + "\n")
		}
		expect(now).toEqual(JSON.parse(readFileSync(FILE, "utf8")))
	})

	it("never hides what needs the reader, at any level: the refusal and the pending ask", () => {
		const t = table().ownerApprovalPendingTask
		for (const d of ["focus", "normal"] as const) {
			expect(t[d].pending, d).toBe(1)
			expect(t[d].liftedByReason.mcp_error ?? t[d].liftedByReason.refusal, d).toBeGreaterThanOrEqual(1)
		}
		// Verbose shows every recorded message as is, so nothing can be hidden there.
		expect(t.verbose.items).toBe(tx.ownerApprovalPendingTask.length)
	})

	it("the owner shape lifts the two unannotated answered calls and the refusal (3 call lines before any aggregation)", () => {
		const n = table().ownerApprovalPendingTask.normal
		expect(n.liftedLines).toBeGreaterThanOrEqual(3)
	})

	// THE DEFECT, pinned. X1-C1 gives Focus its own rules and deletes this test (replacing it with "Focus differs from
	// Normal"). Until then Focus is Normal: same items, same lifted lines, same header calls, on every P0 fixture.
	it("baseline defect: Focus renders the same rows as Normal on every fixture", () => {
		const t = table()
		for (const [name, levels] of Object.entries(t)) {
			expect(levels.focus, name).toEqual(levels.normal)
		}
	})
})
