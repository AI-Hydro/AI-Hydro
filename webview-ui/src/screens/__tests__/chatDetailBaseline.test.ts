/**
 * X1-C0: makes the chat clutter and "Focus looks the same as Normal" measurable. For each P0 fixture (and three
 * older ones) it runs the real presenter at every detail level and records how many rows a reader gets. The counts
 * are computed here, never typed in; `screens-baseline/chat-detail-rows.json` is their committed "before" and this
 * test fails when the presenter output drifts from it.
 *
 * No resolvers are passed, so every MCP call has an unknown effect and lifts: that is the unannotated-server world
 * the owner's session was in (the fail-safe documented on PresentOptions).
 *
 * X1-C1 changed these numbers on purpose (aggregation, a real Focus). The file is regenerated with
 *   UPDATE_CHAT_DETAIL_BASELINE=1 npm run test -- chatDetailBaseline
 * and its diff is the evidence of what Focus and Normal now fold.
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
		if (process.env.UPDATE_CHAT_DETAIL_BASELINE === "1") {
			writeFileSync(FILE, JSON.stringify(now, null, "\t") + "\n")
		}
		// A missing baseline fails rather than regenerating itself, so a deleted file cannot pass in CI.
		expect(existsSync(FILE), `${FILE} is missing; regenerate with UPDATE_CHAT_DETAIL_BASELINE=1`).toBe(true)
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

	it("the owner shape aggregates the two unannotated answered calls into one server line and keeps the refusal", () => {
		const n = table().ownerApprovalPendingTask.normal
		// Before aggregation this was 3 call lines (two unannotated answered calls and the refusal).
		expect(n.liftedLines).toBe(2)
		expect(n.liftedByReason.approved_security).toBe(1)
		expect(n.liftedByReason.mcp_error).toBe(1)
		expect(n.headerCalls).toBe(3)
	})

	// X1-C1 replaces the pinned defect "Focus renders the same rows as Normal": Focus is never longer than Normal, it
	// is strictly shorter on the clutter fixtures, and it never drops a line that needs the reader.
	it("Focus shows strictly fewer rows than Normal on the clutter fixtures, and never more anywhere", () => {
		const t = table()
		for (const [name, levels] of Object.entries(t)) {
			expect(levels.focus.visibleRows, name).toBeLessThanOrEqual(levels.normal.visibleRows)
		}
		// failureLifted, autoRunAll and mapLaunched hold only errors, warnings or nothing: Focus has nothing it may fold
		// there, so they are equal by design (never fewer), not by accident.
		for (const name of ["ownerApprovalPendingTask", "manyUnannotatedTask", "run8ToolsTask", "turnMachineryTask"]) {
			expect(t[name].focus.visibleRows, name).toBeLessThan(t[name].normal.visibleRows)
		}
	})

	it("Focus keeps every refusal, error, exit code and pending ask on its own line", () => {
		const t = table()
		for (const [name, levels] of Object.entries(t)) {
			for (const reason of ["mcp_error", "refusal", "call_failed", "exit_nonzero", "call_denied"]) {
				expect(levels.focus.liftedByReason[reason] ?? 0, `${name}:${reason}`).toBe(
					levels.normal.liftedByReason[reason] ?? 0,
				)
			}
			expect(levels.focus.pending, name).toBe(levels.normal.pending)
		}
	})

	it("the header counts every call whatever the level: aggregation changes rows, not facts", () => {
		for (const [name, levels] of Object.entries(table())) {
			expect(levels.focus.headerCalls, name).toBe(levels.normal.headerCalls)
		}
	})
})
