import type { AnswerAuditPayload } from "@shared/aihydro/transcriptContracts"
import { fireEvent, render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { APPROVED_TOKEN } from "../../../../design/evidenceStates"
import { AnswerAuditFooter, auditFooterLine } from "../AnswerAuditFooter"
import { AnswerBlock, ASK_TO_CITE_TEXT } from "../AnswerBlock"

const DIGEST = "sha256:abc"
const claims: Record<string, Record<string, unknown>> = {
	"c-approved": {
		claimId: "c-approved",
		statement: "A.",
		status: "supported",
		confidence: "high",
		evidenceSpans: [],
		limitations: [],
		revisionDigest: DIGEST,
		approvalState: "approved",
		approvalForRevisionDigest: DIGEST,
		approvalChannel: "ssh_sig_sk_system_trust",
		approvalTrustRoot: "system",
		approvalPolicy: "signed_required",
		approvalPrincipal: "reviewer",
	},
	"c-integrity": {
		claimId: "c-integrity",
		statement: "B.",
		status: "supported",
		confidence: "high",
		evidenceSpans: [],
		limitations: [],
		revisionDigest: DIGEST,
		approvalState: "approved",
		approvalChannel: "cli_same_user",
		approvalTrustRoot: "user_writable",
		approvalForRevisionDigest: DIGEST,
	},
}
vi.mock("../../../../context/LedgerContext", () => ({
	useLedgerContext: () => ({ getClaim: (id: string) => claims[id] }),
}))

const audit = (p: Partial<AnswerAuditPayload> = {}): AnswerAuditPayload => ({
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
	...p,
})

const TEXT = "Answer prose [claim:c-approved] and [claim:c-integrity] with [run:fx-run-1#a.b]."

describe("AnswerBlock", () => {
	it("the summary row holds exactly one approved element for one approved and one integrity-only claim", () => {
		const { container } = render(
			<AnswerBlock text={TEXT} turn={{ runIds: ["fx-run-1"], claimIds: ["c-approved", "c-integrity"], filesChanged: [] }}>
				<p>Answer prose.</p>
			</AnswerBlock>,
		)
		const row = container.querySelector('[aria-label="Evidence cited in this answer"]')!
		expect(row.querySelectorAll('[data-approved="true"]')).toHaveLength(1)
		expect(row.querySelectorAll("button[data-evidence-state]")).toHaveLength(2)
		expect(row.querySelector('[data-evidence-state="integrity-only"]')).not.toBeNull()
		expect(container.innerHTML.split(APPROVED_TOKEN).length - 1).toBeLessThanOrEqual(1)
		expect(row.querySelector("[title='run:fx-run-1#a.b']")).not.toBeNull()
	})

	it("body keeps each marker as an inline chip at its citation, with no stripped-sentence artifacts", async () => {
		const md = "Baseflow index 0.61 [run:fx-run-1#bfi]; runoff ratio 0.42 [claim:c-approved] and [claim:c-integrity]."
		const { container } = render(
			<AnswerBlock text={md}>
				<div data-testid="body">
					<MarkdownBlock markdown={md} />
				</div>
			</AnswerBlock>,
		)
		const body = container.querySelector('[data-testid="body"]')!
		await waitFor(() => expect(body.querySelectorAll("button")).toHaveLength(3))
		const t = body.textContent!
		// the run chip sits right after the number it backs, before the semicolon
		expect(t).toMatch(/Baseflow index 0\.61\s*fx-run-1.*run reference;/)
		expect(t.indexOf("fx-run-1")).toBeGreaterThan(t.indexOf("0.61"))
		expect(t.indexOf("fx-run-1")).toBeLessThan(t.indexOf("runoff ratio 0.42"))
		expect(t.indexOf("c-approved")).toBeGreaterThan(t.indexOf("runoff ratio 0.42"))
		expect(t).not.toMatch(/;\s*and\b/)
		expect(t).not.toMatch(/\band\s*\./)
		expect(t).not.toContain("[claim:")
		expect(body.querySelectorAll('[data-approved="true"]')).toHaveLength(1)
	})

	it("the summary row collapses to a count above 4 references and expands on 'Show all (n)'", () => {
		const text = ["a", "b", "c", "d", "e"].map((i) => `[claim:c-${i}]`).join(" ")
		const { container } = render(
			<AnswerBlock text={text}>
				<p>x</p>
			</AnswerBlock>,
		)
		const row = container.querySelector('[aria-label="Evidence cited in this answer"]')!
		expect(row.textContent).toContain("Evidence: 5 cited")
		expect(row.querySelectorAll("button[data-evidence-state]")).toHaveLength(0)
		fireEvent.click([...row.querySelectorAll("button")].find((b) => b.textContent === "Show all (5)")!)
		expect(row.querySelectorAll("button[data-evidence-state]")).toHaveLength(5)
		const four = render(
			<AnswerBlock text={["a", "b", "c", "d"].map((i) => `[claim:c-${i}]`).join(" ")}>
				<p>x</p>
			</AnswerBlock>,
		).container
		expect(four.textContent).not.toContain("Show all")
	})

	it("header is neutral and the turn line states approval, never implying it", () => {
		const { container } = render(
			<AnswerBlock
				hasChanges
				onSeeChanges={() => {}}
				text={TEXT}
				turn={{ runIds: ["a", "b"], claimIds: ["c-approved", "c-integrity", "c-none"], filesChanged: ["x.py"] }}>
				<p>x</p>
			</AnswerBlock>,
		)
		const line = container.querySelector('[data-testid="answer-turn-summary"]')!.textContent!
		expect(line).toContain("2 runs")
		expect(line).toContain("3 claims (1 approved, 2 not approved)")
		expect(line).toContain("1 file changed")
		expect(line).toContain("See new changes")
		const header = container.querySelector(".codicon-comment-discussion")!.parentElement!
		expect(header.innerHTML).not.toMatch(/passed|success/i)
	})

	it("claims with no approval read 'none approved'", () => {
		const { container } = render(
			<AnswerBlock text="t" turn={{ runIds: [], claimIds: ["c-x"], filesChanged: [] }}>
				<p>x</p>
			</AnswerBlock>,
		)
		expect(container.textContent).toContain("1 claim (none approved)")
	})

	it("'Ask agent to cite' appears only with violations and sends the fixed text once", () => {
		const send = vi.fn()
		const withHard = render(
			<AnswerBlock
				audit={audit({ hardCount: 1, violations: [{ kind: "k", severity: "hard" }] })}
				onSendFeedback={send}
				text="t">
				<p>x</p>
			</AnswerBlock>,
		).container
		const btn = [...withHard.querySelectorAll("button")].find((b) => b.textContent?.includes("Ask agent to cite"))!
		fireEvent.click(btn)
		expect(send).toHaveBeenCalledTimes(1)
		expect(send).toHaveBeenCalledWith(ASK_TO_CITE_TEXT)

		const legacy = render(
			<AnswerBlock
				audit={audit({ schema: "legacy", violations: [{ kind: "k", severity: "unknown" }] })}
				onSendFeedback={send}
				text="t">
				<p>x</p>
			</AnswerBlock>,
		).container
		expect(legacy.textContent).toContain("Ask agent to cite")

		for (const a of [
			undefined,
			audit({ status: "passed" }),
			audit({ status: "unavailable" }),
			audit({ advisoryCount: 2, violations: [{ kind: "k", severity: "advisory" }] }),
		]) {
			const c = render(
				<AnswerBlock audit={a} onSendFeedback={send} text="t">
					<p>x</p>
				</AnswerBlock>,
			).container
			expect(c.textContent).not.toContain("Ask agent to cite")
		}
		const noReply = render(
			<AnswerBlock audit={audit({ hardCount: 1, violations: [{ kind: "k", severity: "hard" }] })} text="t">
				<p>x</p>
			</AnswerBlock>,
		).container
		expect(noReply.textContent).not.toContain("Ask agent to cite")
		expect(send).toHaveBeenCalledTimes(1)
	})

	it("an old answer without an audit has no footer; the feedback buttons sit behind the overflow menu", () => {
		const { container } = render(
			<AnswerBlock feedback={<button type="button">Thumb</button>} text="t">
				<p>x</p>
			</AnswerBlock>,
		)
		expect(container.querySelector('[data-testid="answer-audit-footer"]')).toBeNull()
		expect(container.textContent).not.toContain("Thumb")
		fireEvent.click(container.querySelector('[aria-label="More answer actions"]')!)
		expect(container.textContent).toContain("Thumb")
	})

	it("renders nothing but the prose while streaming", () => {
		const { container } = render(
			<AnswerBlock audit={audit({ hardCount: 1 })} partial text={TEXT}>
				<p>x</p>
			</AnswerBlock>,
		)
		expect(container.querySelector('[data-testid="answer-audit-footer"]')).toBeNull()
		expect(container.querySelectorAll("button")).toHaveLength(0)
	})
})

describe("AnswerAuditFooter", () => {
	const texts = (a: AnswerAuditPayload) => render(<AnswerAuditFooter audit={a} />).container

	it("never says 'passed' for legacy, unavailable or violations; says 'numbers traced'", () => {
		const cases = [
			audit({ schema: "legacy", violations: [{ kind: "k", severity: "unknown" }] }),
			audit({ status: "unavailable", disclosure: { kind: "audit_unavailable", reason: "timed out" } }),
			audit({ hardCount: 1, cited: 3, total: 5, violations: [{ kind: "k", severity: "hard" }] }),
		]
		for (const a of cases) {
			expect(texts(a).textContent).not.toMatch(/passed|verified/i)
		}
		expect(auditFooterLine(cases[2])).toBe("Audit: 3/5 numbers traced · 1 hard · 0 advisory")
		expect(auditFooterLine(cases[1])).toBe("Audit not run: timed out")
		expect(auditFooterLine(cases[0])).toBe("Audit (ungraded server): 1 finding")
		expect(auditFooterLine(audit({ status: "passed", cited: 2, total: 2 }))).toBe("Audit passed: 2/2 numbers traced")
	})

	it("skipped renders nothing", () => {
		expect(texts(audit({ status: "skipped" })).textContent).toBe("")
	})

	it("disclosures are visible while the findings list stays collapsed", () => {
		const f = { kind: "untraced_number", severity: "hard" as const, excerpt: "0.42" }
		const c = texts(
			audit({
				status: "violations",
				attempt: 2,
				hardCount: 1,
				violations: [f],
				droppedQuantities: ["0.7"],
				quantitiesRemaining: 0,
				unrevisableFindings: [{ kind: "untraced_number", severity: "hard", excerpt: "9.9" }],
				disclosure: { kind: "findings_remain", reason: "Shown with 1 unresolved hard audit findings after 2 revisions." },
				history: [
					{
						attempt: 0,
						ts: 1,
						hardCount: 1,
						advisoryCount: 0,
						violations: [f],
						draftHash: "h",
						draftText: "draft [claim:c-approved]",
					},
				],
			}),
		)
		const t = c.textContent!
		expect(t).toContain("Shown after 2 silent revisions · audit revisions: 2 requests")
		expect(t).toContain("Shown with 1 unresolved hard audit findings after 2 revisions.")
		expect(t).toContain("Revision removed 1 quantity from the draft: 0.7")
		expect(t).toContain("The requested values are no longer reported in this answer")
		expect(t).toContain("earlier-narration finding")
		for (const d of c.querySelectorAll("details")) {
			expect(d.hasAttribute("open")).toBe(false)
		}
	})

	it("findings are severity-sorted with the fix hint as code; drafts are plain text, never chips", () => {
		const c = texts(
			audit({
				hardCount: 1,
				advisoryCount: 1,
				violations: [
					{ kind: "adv", severity: "advisory" },
					{ kind: "hard1", severity: "hard", fixHint: "cite [run:ID#p]", suggestedMarker: "[run:r#x]" },
				],
				history: [
					{
						attempt: 0,
						ts: 1,
						hardCount: 1,
						advisoryCount: 0,
						violations: [],
						draftHash: "h",
						draftText: "see [claim:c-approved]",
					},
				],
			}),
		)
		const kinds = [...c.querySelectorAll("li > code")].map((e) => e.textContent)
		expect(kinds).toEqual(["hard1", "adv"])
		expect(c.querySelector("li div code")?.textContent).toBe("cite [run:ID#p]")
		expect(c.textContent).toContain("Show draft (1)")
		expect(c.textContent).toContain("see [claim:c-approved]")
		expect(c.querySelectorAll("[data-evidence-state]")).toHaveLength(0)
		expect(c.innerHTML).not.toContain(APPROVED_TOKEN)
	})
})
