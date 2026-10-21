import { presentTranscript, type TranscriptItem, type WorkGroup } from "@shared/aihydro/transcriptPresenter"
import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import * as tx from "../fixtures/transcripts"

// Resolvers saying nothing is risky: without them the presenter fails safe and lifts every MCP call and write.
const SAFE = { effectClassFor: () => "READ" as const, isProtectedPath: () => false }
const all = Object.entries(tx).filter(([, v]) => Array.isArray(v)) as Array<[string, AiHydroMessage[]]>
const groups = (items: TranscriptItem[]) => items.filter((i): i is WorkGroup => i.kind === "group")
const reasons = (name: keyof typeof tx) =>
	groups(presentTranscript(tx[name] as AiHydroMessage[], { detail: "normal", ...SAFE })).flatMap((g) =>
		g.lifted.map((l) => l.reason),
	)

describe("transcript presenter over the Wave 2 fixtures", () => {
	it("presents every fixture at every detail level without throwing", () => {
		expect(all.length).toBeGreaterThanOrEqual(17)
		for (const [name, msgs] of all) {
			for (const detail of ["focus", "normal", "verbose"] as const) {
				expect(() => presentTranscript(msgs, { detail, ...SAFE }), `${name}/${detail}`).not.toThrow()
			}
		}
	})

	it("keeps group keys stable as each fixture grows one message at a time", () => {
		for (const [name, msgs] of all) {
			let prev = new Set<string>()
			for (let n = 1; n <= msgs.length; n++) {
				const keys = new Set(
					presentTranscript(msgs.slice(0, n), { detail: "normal", ...SAFE })
						.filter((i) => i.kind === "group" || i.kind === "user" || i.kind === "prose" || i.kind === "answer")
						.map((i) => i.key),
				)
				for (const k of prev) {
					expect(keys.has(k), `${name}: ${k} lost at ${n}`).toBe(true)
				}
				prev = keys
			}
		}
	})

	it("folds the owner's machinery pattern into one group with the malformed retry lifted", () => {
		const items = presentTranscript(tx.turnMachineryTask, { detail: "normal", ...SAFE })
		expect(items.map((i) => i.kind)).toEqual(["user", "group", "prose", "answer"])
		const g = groups(items)[0]
		expect(g.facts.toolCount).toBe(2)
		expect(g.facts.requestCount).toBe(4)
		expect(g.lifted.map((l) => l.reason)).toEqual(["info_notice"])
		expect(g.rewindTs).toBeDefined()
	})

	it("lifts every failure in the failure fixture and counts eight calls in the long run", () => {
		const r = reasons("failureLiftedTask")
		expect(r).toEqual(expect.arrayContaining(["mcp_error", "info_notice", "diff_error"]))
		const run8 = groups(presentTranscript(tx.run8ToolsTask, { detail: "normal", ...SAFE }))[0]
		expect(run8.facts.toolCount).toBe(8)
		expect(run8.lifted).toHaveLength(0)
	})

	it("shows pending approvals as prompts and keeps a security-marked approval lifted after it is answered", () => {
		for (const t of [tx.approvalMcpTask, tx.approvalCommandTask, tx.approvalEditTask, tx.protectedPathApprovalTask]) {
			const items = presentTranscript(t, { detail: "normal", ...SAFE })
			expect(items[items.length - 1].kind).toBe("pending")
		}
		expect(reasons("protectedPathApprovedTask")).toEqual(["approved_security"])
	})

	it("lifts lifecycle rows: truncation, condense, non-zero exit, cancel, checked-out; resume is a divider", () => {
		expect(reasons("contextTruncationTask")).toEqual(["context_truncated"])
		expect(reasons("condenseTask")).toEqual(["context_condensed"])
		expect(reasons("commandNonZeroExitTask")).toEqual(["exit_nonzero"])
		expect(reasons("userCancelTask")).toEqual(["request_cancelled"])
		expect(reasons("rewindTask")).toEqual(["rewind"])
		expect(reasons("checkpointCheckedOutTask")).toEqual(["checkpoint_checked_out"])
		const resumed = presentTranscript(tx.resumeTask, { detail: "normal", ...SAFE })
		expect(resumed[resumed.length - 1].kind).toBe("pending")
		const cancelled = presentTranscript(tx.userCancelTask, { detail: "normal", ...SAFE })
		expect(cancelled[cancelled.length - 1].kind).toBe("pending")
	})

	it("presents the old task without outcome fields neutrally", () => {
		const g = groups(presentTranscript(tx.oldTaskNoOutcomesTask, { detail: "normal", ...SAFE }))
		expect(g.flatMap((x) => x.lifted)).toHaveLength(0)
		expect(g.reduce((n, x) => n + x.facts.toolCount, 0)).toBe(2)
	})
})
