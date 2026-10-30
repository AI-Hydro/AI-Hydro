import type { AnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { AnswerAuditSummary, auditSummaryLine } from "../AnswerAuditSummary"

const base: AnswerAuditPayload = {
	v: 1,
	stage: "final",
	status: "violations",
	hardCount: 0,
	advisoryCount: 0,
	violations: [],
	schema: "graded",
	attempt: 0,
	answerTs: 1,
	draftHash: "0".repeat(64),
}
const render_ = (p: Partial<AnswerAuditPayload>) =>
	render(<AnswerAuditSummary text={JSON.stringify({ ...base, ...p })} />).container

describe("AnswerAuditSummary (interim)", () => {
	it("graded: counts, expandable list with every finding, fix hint as code", () => {
		const violations = Array.from({ length: 21 }, (_, i) => ({
			kind: "untraced_number",
			severity: i === 0 ? ("hard" as const) : ("advisory" as const),
			fixHint: i === 0 ? "cite e.g. [run:ID#path]" : undefined,
		}))
		const c = render_({ hardCount: 1, advisoryCount: 20, cited: 3, total: 5, violations })
		expect(c.textContent).toContain("Audit: 3/5 quantities cited · 1 hard · 20 advisory")
		expect(c.querySelectorAll("li")).toHaveLength(21)
		expect(c.querySelector("details")?.hasAttribute("open")).toBe(false)
		// agent-directed text is not shown below Verbose
		expect(c.textContent).not.toContain("cite e.g.")
		expect(c.textContent).not.toMatch(/passed/i)
	})

	it("legacy: ungraded summary, severity never shown, no 'passed'", () => {
		const c = render_({
			schema: "legacy",
			violations: [{ kind: "untraced_number", severity: "unknown" }],
		})
		expect(c.textContent).toContain("Audit (ungraded server): 1 finding")
		expect(c.textContent).not.toContain("hard")
		expect(c.textContent).not.toMatch(/passed/i)
	})

	it("unavailable and skipped: 'Audit not run' with the reason, never 'passed'", () => {
		for (const status of ["unavailable", "skipped"] as const) {
			const c = render_({ status, disclosure: { kind: "audit_unavailable", reason: "timed out after 15s" } })
			expect(c.textContent).toContain("Audit not run: timed out after 15s")
			expect(c.textContent).not.toMatch(/passed/i)
		}
	})

	it("says 'passed' only for status passed, and never uses the approved green token", () => {
		expect(auditSummaryLine({ ...base, status: "passed", cited: 2, total: 2 })).toBe("Audit passed: 2/2 quantities cited")
		const html = render_({ status: "passed" }).innerHTML
		expect(html).not.toContain("APPROVED")
		expect(html).not.toMatch(/green|success/i)
	})

	it("findings list is focusable and labelled; long text is capped with Show more", () => {
		const long = "word ".repeat(100)
		const c = render_({
			hardCount: 1,
			violations: [{ kind: "k", severity: "hard", message: long, fixHint: long, suggestedMarker: "[run:ID#p]" }],
		})
		const ol = c.querySelector("ol")!
		expect(ol.getAttribute("tabindex")).toBe("0")
		expect(ol.getAttribute("aria-label")).toBe("Audit findings")
		expect(c.textContent).not.toContain(long.trim())
		expect(c.textContent).not.toContain("Marker:")
		const verbose = render(
			<ExtensionStateContext.Provider value={{ transcriptDetail: "verbose" } as any}>
				<AnswerAuditSummary
					text={JSON.stringify({
						...base,
						hardCount: 1,
						violations: [
							{ kind: "k", severity: "hard", message: long, fixHint: long, suggestedMarker: "[run:ID#p]" },
						],
					})}
				/>
			</ExtensionStateContext.Provider>,
		).container
		const buttons = verbose.querySelectorAll("button")
		expect(buttons).toHaveLength(2)
		fireEvent.click(buttons[0])
		expect(verbose.textContent).toContain(long.trim())
		expect(verbose.textContent).toContain("Marker: [run:ID#p]")
	})

	it("unreadable payloads render a neutral line, not raw JSON", () => {
		const { container } = render(<AnswerAuditSummary text='{"v":99}' />)
		expect(container.textContent).toBe("Audit result in an unreadable format")
	})
	describe("gate stages (W2-C)", () => {
		const hardFinding = {
			kind: "untraced_number",
			severity: "hard" as const,
			excerpt: "0.42",
			message: "no run supports this",
		}

		it("progress: an updating activity line, no result claim; a stale one renders nothing", () => {
			const live = render(<AnswerAuditSummary partial text="Drafting answer…" />).container
			expect(live.querySelector('[data-testid="answer-audit-progress"]')?.textContent).toBe("Drafting answer…")
			const stale = render(<AnswerAuditSummary text="Checking answer against evidence…" />).container
			expect(stale.textContent).toBe("")
		})

		it("revision: a counted line with the held-back draft behind 'Show draft (n)', warning not green", () => {
			const c = render_({
				stage: "revision",
				attempt: 0,
				hardCount: 1,
				violations: [hardFinding],
				draftText: "Runoff ratio is 0.42.",
			})
			expect(c.textContent).toContain("Answer revised after audit (attempt 1/2)")
			expect(c.textContent).toContain("Show draft (1)")
			expect(c.textContent).toContain("Runoff ratio is 0.42.")
			expect(c.querySelector(".codicon-warning")).not.toBeNull()
			expect(c.textContent).not.toMatch(/passed/i)
		})

		it("revision: removed quantities are listed on the line that revised them", () => {
			const c = render_({ stage: "revision", attempt: 1, violations: [hardFinding], droppedQuantities: ["0.42", "0.71"] })
			expect(c.textContent).toContain("Revision removed 2 quantities from the draft: 0.42, 0.71")
		})

		it("final after revisions: request cost, removed values, and 'no longer reported' when none remain", () => {
			const c = render_({
				status: "passed",
				attempt: 1,
				droppedQuantities: ["0.42"],
				quantitiesRemaining: 0,
				history: [
					{
						attempt: 0,
						ts: 1,
						hardCount: 1,
						advisoryCount: 0,
						violations: [hardFinding],
						draftHash: "h",
						draftText: "first draft 0.42",
					},
				],
			})
			expect(c.textContent).toContain("audit revisions: 1 request")
			expect(c.textContent).toContain("Revision removed 1 quantity from the draft: 0.42")
			expect(c.textContent).toContain("The requested values are no longer reported in this answer")
			expect(c.textContent).toContain("Show draft (1)")
			expect(c.querySelector(".codicon-warning")).not.toBeNull() // removed values are never presented as a clean pass
		})

		it("disclosure: unresolved findings after 2 revisions are stated in words", () => {
			const c = render_({
				attempt: 2,
				hardCount: 1,
				violations: [hardFinding],
				disclosure: { kind: "findings_remain", reason: "Shown with 1 unresolved hard audit findings after 2 revisions." },
			})
			expect(c.textContent).toContain("Shown with 1 unresolved hard audit findings after 2 revisions.")
			expect(c.textContent).toContain("audit revisions: 2 requests")
			expect(c.querySelector(".codicon-warning")).not.toBeNull()
			expect(c.textContent).not.toMatch(/passed/i)
		})

		it("deadline: the answer shows as audit not run, with the reason", () => {
			const c = render_({
				status: "unavailable",
				schema: "legacy",
				disclosure: { kind: "audit_unavailable", reason: "timed out after 45s" },
			})
			expect(c.textContent).toContain("Audit not run: timed out after 45s")
		})

		it("interrupted: the unchecked draft is shown in full with the reason, as unverified", () => {
			const c = render_({
				stage: "interrupted",
				status: "unavailable",
				disclosure: { kind: "interrupted", reason: "stopped by user" },
				draftText: "The runoff ratio is 0.42.",
				violations: [hardFinding],
			})
			expect(c.textContent).toContain("Unchecked draft (audit interrupted: stopped by user)")
			expect(c.querySelector('[aria-label="Unchecked draft"]')?.textContent).toBe("The runoff ratio is 0.42.")
			expect(c.textContent).toContain("unverified")
			expect(c.textContent).not.toMatch(/passed/i)
		})

		it("B1: earlier-narration findings are listed separately as not revisable", () => {
			const f = { kind: "uncited_number", severity: "hard" as const, excerpt: "Peak flow was 123 m3/s." }
			const c = render_({ hardCount: 1, violations: [f], unrevisableFindings: [f] })
			expect(c.querySelector('[data-testid="answer-audit-unrevisable"]')?.textContent).toContain(
				"1 earlier-narration finding not revisable",
			)
			expect(c.querySelector('[aria-label="Earlier-narration findings"]')?.textContent).toContain("Peak flow was 123 m3/s.")
		})

		it("pending (draft persisted before its audit) renders nothing", () => {
			const c = render_({ stage: "pending", status: "unavailable", draftText: "secret draft 0.42" })
			expect(c.textContent).toBe("")
		})

		it("interrupted without recorded text still says so", () => {
			const c = render_({
				stage: "interrupted",
				status: "unavailable",
				disclosure: { kind: "interrupted", reason: "reload" },
			})
			expect(c.textContent).toContain("The draft text was not recorded.")
		})
	})
})
