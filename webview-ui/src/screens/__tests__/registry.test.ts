import { describe, expect, it } from "vitest"
import * as tx from "../fixtures/transcripts"
import { screens } from "../registry"

describe("screen harness registry", () => {
	it("has unique ids and a known surface/group for every screen", () => {
		const ids = screens.map((s) => s.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const s of screens) {
			expect(["sidebar", "panel", "editor"]).toContain(s.surface)
			expect(["chat", "evidence", "experiment", "replay", "map", "studio", "design", "nav"]).toContain(s.group)
			expect(s.title.length).toBeGreaterThan(3)
		}
	})

	it("labels every map layer fixture as synthetic", () => {
		for (const s of screens) {
			for (const layer of s.layers ?? []) {
				expect(layer.metadata.source_status, `${s.id}/${layer.id}`).toBe("synthetic")
			}
		}
	})

	it("uses only fixture session and run identifiers", () => {
		for (const s of screens) {
			for (const c of s.ledger?.claims ?? []) {
				expect(c.sessionId.startsWith("fx-")).toBe(true)
				expect(c.claimId.startsWith("fx-")).toBe(true)
			}
		}
	})

	it("covers the S3 tool-card states and labels recorded data as recorded, not synthetic", () => {
		const ids = screens.filter((s) => s.id.startsWith("toolcard-")).map((s) => s.id)
		expect(ids).toEqual(
			expect.arrayContaining([
				"toolcard-success",
				"toolcard-refusal",
				"toolcard-area-fail",
				"toolcard-provisional",
				"toolcard-unreported-class",
			]),
		)
		expect(screens.find((x) => x.id === "chat-task-mcp")?.fixtureKind).toBe("recorded-call")
		for (const s of screens.filter((x) => x.id.startsWith("toolcard-"))) {
			expect(["recorded", "spliced"], s.id).toContain(s.fixtureKind)
		}
	})

	it("registers the Wave 2 transcript screens with unique, ordered message timestamps", () => {
		const ids = [
			"chat-turn-machinery",
			"chat-failure-lifted",
			"chat-run-8-tools",
			"chat-approval-mcp",
			"chat-approval-command",
			"chat-approval-edit",
			"chat-approval-protected-path",
			"chat-finished-claims",
			"chat-answer-audit-violations",
			"chat-answer-audit-graded",
			"chat-answer-audit-unavailable",
			"chat-approval-protected-path-answered",
			"chat-context-truncation",
			"chat-condense",
			"chat-command-nonzero-exit",
			"chat-user-cancel",
			"chat-resume",
			"chat-rewind",
			"chat-checkpoint-checked-out",
			"chat-old-task-no-outcomes",
		]
		for (const id of ids) {
			const screen = screens.find((s) => s.id === id)
			expect(screen, id).toBeDefined()
			const messages = screen?.state?.aihydroMessages ?? []
			expect(messages.length, id).toBeGreaterThan(2)
			const stamps = messages.map((m) => m.ts)
			expect(new Set(stamps).size, `${id}: duplicate ts`).toBe(stamps.length)
			expect(
				[...stamps].sort((a, b) => a - b),
				`${id}: ts out of order`,
			).toEqual(stamps)
		}
		expect(Object.keys(tx).length).toBeGreaterThanOrEqual(ids.length)
	})

	it("the old-task fixture carries no recorded outcomes, the lifecycle fixtures keep their evidence", () => {
		for (const m of tx.oldTaskNoOutcomesTask) {
			expect(m.askOutcome).toBeUndefined()
			expect(m.execOutcome).toBeUndefined()
		}
		expect(tx.checkpointCheckedOutTask.some((m) => m.isCheckpointCheckedOut)).toBe(true)
		expect(tx.protectedPathApprovalTask.some((m) => m.isOperationOutsideWorkspace)).toBe(true)
		const answered = tx.protectedPathApprovedTask.find((m) => m.isOperationOutsideWorkspace)
		expect(answered?.askOutcome).toBe("approved")
		const exit = tx.commandNonZeroExitTask.find((m) => m.say === "command")
		expect([exit?.exitCode, exit?.execOutcome]).toEqual([2, "failed"])
		expect(tx.contextTruncationTask.some((m) => m.infoNotice?.class === "context_truncated")).toBe(true)
		expect(tx.rewindTask.some((m) => m.say === "deleted_api_reqs")).toBe(true)
	})

	it("registers every navigation surface, with fixture catalogues only on synthetic data", () => {
		const nav = screens.map((s) => s.id)
		expect(nav).toEqual(
			expect.arrayContaining([
				"settings-api",
				"settings-features",
				"settings-general",
				"settings-about",
				"settings-keyboard",
				"mcp-configure",
				"mcp-marketplace",
				"connectors",
				"skills",
				"skills-marketplace",
				"onboarding-card",
				"onboarding-card-unhealthy",
				"chat-header-collapsed",
			]),
		)
		for (const s of screens) {
			const rows = [
				...(s.catalogues?.mcpMarketplace ?? []).map((r) => r.name),
				...[...(s.catalogues?.skillsInstalled ?? []), ...(s.catalogues?.skillsMarketplace ?? [])].map((r) => r.name),
			]
			for (const name of rows) expect(name.startsWith("Fixture"), `${s.id}/${name}`).toBe(true)
		}
	})
})
