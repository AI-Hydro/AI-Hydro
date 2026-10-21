import type { AnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
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
		expect(c.querySelector("li div code")?.textContent).toBe("cite e.g. [run:ID#path]")
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

	it("unreadable payloads render a neutral line, not raw JSON", () => {
		const { container } = render(<AnswerAuditSummary text='{"v":99}' />)
		expect(container.textContent).toBe("Audit result in an unreadable format")
	})
})
