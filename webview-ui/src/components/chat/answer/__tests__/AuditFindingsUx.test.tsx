import type { AnswerAuditPayload, AnswerAuditViolation } from "@shared/aihydro/transcriptContracts"
import { fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { auditSummaryLine } from "../../AnswerAuditSummary"
import { AnswerAuditFooter, auditFooterLine, gateSkipNeedsAttention } from "../AnswerAuditFooter"
import { AnswerBlock } from "../AnswerBlock"
import { auditSummaryView, contextSnippet, markUntracedNumbers, untracedPlan, viewFinding } from "../auditFindings"

vi.mock("../../../../context/LedgerContext", () => ({ useLedgerContext: () => ({ getClaim: () => undefined }) }))

const MARKER = "[run:watershed.0b124654840f#key_outputs.area_km2]"
const uncited = (q: string, extra: Partial<AnswerAuditViolation> = {}): AnswerAuditViolation => ({
	kind: "uncited_number",
	severity: "hard",
	excerpt: `Piscataquis River near Dover-Foxcroft, Maine** (drainage area ${q} km²; delineation run`,
	message: `The quantity '${q}' has no [run:...] or [lit:...] marker.`,
	fixHint: `Add ${MARKER} immediately after '${q}'.`,
	suggestedMarker: MARKER,
	...extra,
})

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

const withDetail = (detail: "focus" | "normal" | "verbose", ui: ReactNode) =>
	render(<ExtensionStateContext.Provider value={{ transcriptDetail: detail } as any}>{ui}</ExtensionStateContext.Provider>)

const hardAudit = () =>
	audit({
		cited: 10,
		total: 13,
		hardCount: 3,
		advisoryCount: 1,
		violations: [
			uncited("774.15"),
			uncited("12.5", { suggestedMarker: undefined }),
			uncited("0.42"),
			{ kind: "stale_claim", severity: "advisory", excerpt: "baseflow index" },
		],
	})

describe("audit summary view", () => {
	it("counts are accurate and the wording is for a human", () => {
		expect(auditSummaryView(hardAudit())?.text).toBe("3 numbers aren't linked to a recorded run · 1 more note")
		expect(auditSummaryView(audit({ hardCount: 1, violations: [uncited("1.5")] }))?.text).toBe(
			"1 number isn't linked to a recorded run",
		)
		expect(
			auditSummaryView(
				audit({
					advisoryCount: 2,
					violations: [
						{ kind: "k", severity: "advisory" },
						{ kind: "k", severity: "advisory" },
					],
				}),
			),
		).toEqual({ text: "2 notes to review", tone: "note" })
		expect(auditSummaryView(audit({ status: "passed" }))).toBeUndefined()
	})

	it("extracts the quantity, the status and the likely run", () => {
		const f = viewFinding(uncited("774.15"))
		expect(f.quantity).toBe("774.15")
		expect(f.status).toBe("Not linked to a run")
		expect(f.runHint).toEqual({ runId: "watershed.0b124654840f", jsonPath: "key_outputs.area_km2" })
		expect(f.context).toContain("774.15 km²")
		expect(f.context).not.toContain("**")
		expect(
			viewFinding({ kind: "value_mismatch", severity: "hard", message: "Prose says '0.42' but run-log 'r' stores 0.4." })
				.status,
		).toBe("Value differs from the run")
		expect(viewFinding({ kind: "run_id_not_found", severity: "hard" }).status).toMatch(/missing|not recorded/)
		expect(contextSnippet("a ".repeat(200), "zzz")?.endsWith("…")).toBe(true)
	})
})

describe("audit footer presentation", () => {
	it("is one collapsed button with aria-expanded; the list opens on demand", () => {
		const { container } = withDetail("normal", <AnswerAuditFooter audit={hardAudit()} />)
		const btn = container.querySelector("button[aria-expanded]")!
		expect(btn.getAttribute("aria-expanded")).toBe("false")
		expect(btn.textContent).toContain("3 numbers aren't linked to a recorded run")
		expect(btn.textContent).toContain("Review")
		expect(container.querySelectorAll("li")).toHaveLength(0)
		fireEvent.click(btn)
		expect(btn.getAttribute("aria-expanded")).toBe("true")
		expect(container.querySelectorAll("li")).toHaveLength(4)
		expect(container.textContent).toContain("10 of 13 are traced")
		expect(container.textContent).toContain("774.15")
		expect(container.textContent).toContain("Not linked to a run")
	})

	it("agent repair text and raw marker syntax are absent at Focus and Normal, present at Verbose", () => {
		for (const detail of ["focus", "normal"] as const) {
			const { container } = withDetail(detail, <AnswerAuditFooter audit={hardAudit()} />)
			fireEvent.click(container.querySelector("button[aria-expanded]")!)
			expect(container.textContent).not.toContain("Fix:")
			expect(container.textContent).not.toContain("immediately after")
			expect(container.textContent).not.toContain("[run:")
			expect(container.textContent).not.toContain("uncited_number")
			expect(container.textContent).not.toContain("[hard]")
		}
		const { container } = withDetail("verbose", <AnswerAuditFooter audit={hardAudit()} />)
		fireEvent.click(container.querySelector("button[aria-expanded]")!)
		expect(container.textContent).toContain("Fix:")
		expect(container.textContent).toContain("immediately after")
		expect(container.textContent).toContain(`Marker: ${MARKER}`)
		expect(container.textContent).toContain("uncited_number")
		expect(container.textContent).toContain("Audit: 10/13 numbers traced · 3 hard · 1 advisory")
	})

	it("a hard finding is never hidden at Focus or Normal", () => {
		for (const detail of ["focus", "normal"] as const) {
			const { container } = withDetail(detail, <AnswerAuditFooter audit={hardAudit()} />)
			expect(container.textContent).toContain("3 numbers aren't linked")
		}
	})

	it("clean answers: a tiny check at Normal, nothing at Focus", () => {
		const clean = audit({ status: "passed", cited: 13, total: 13 })
		expect(withDetail("normal", <AnswerAuditFooter audit={clean} />).container.textContent).toContain("All 13 numbers traced")
		expect(withDetail("focus", <AnswerAuditFooter audit={clean} />).container.textContent).toBe("")
	})

	it("the follow-up action shows with hard findings only and calls the handler", () => {
		const ask = vi.fn()
		const { container } = withDetail("normal", <AnswerAuditFooter audit={hardAudit()} onAskToLink={ask} />)
		fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent === "Ask AI-Hydro to link these")!)
		expect(ask).toHaveBeenCalledTimes(1)
		const adv = audit({ advisoryCount: 1, violations: [{ kind: "k", severity: "advisory" }] })
		expect(withDetail("normal", <AnswerAuditFooter audit={adv} onAskToLink={ask} />).container.textContent).not.toContain(
			"Ask AI-Hydro",
		)
	})
})

describe("in-place underline", () => {
	const textNode = (value: string) => ({ type: "text", value })

	it("wraps exactly the untraced occurrences and not near-matches or cited ones", () => {
		const plan = untracedPlan([uncited("774.15"), uncited("12")])
		const tree: any = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						textNode("Area 774.15 km² and 1774.15, 12 gauges, 12.5 mm, then 12"),
						{ type: "strong", data: { hProperties: { "data-chip-type": "run" } }, children: [] },
					],
				},
			],
		}
		markUntracedNumbers(tree, plan)
		const marked = tree.children[0].children.filter((n: any) => n.data?.hProperties?.["data-untraced"])
		expect(marked.map((n: any) => n.children[0].value)).toEqual(["774.15", "12"])
		const text = tree.children[0].children.map((n: any) => n.value ?? `<${n.children?.[0]?.value ?? "chip"}>`).join("")
		expect(text).toBe("Area <774.15> km² and 1774.15, <12> gauges, 12.5 mm, then 12<chip>")
	})

	it("renders a described, focusable dotted-underline span with the likely run in the answer", () => {
		const a = audit({ hardCount: 1, violations: [uncited("774.15")] })
		const { container } = withDetail(
			"normal",
			<AnswerBlock audit={a} text="x">
				<MarkdownBlock markdown="Drainage area 774.15 km² for the basin." />
			</AnswerBlock>,
		)
		return vi.waitFor(() => {
			const el = container.querySelector('[data-testid="untraced-number"] [aria-describedby]') as HTMLElement
			expect(el.textContent).toBe("774.15")
			expect(el.tabIndex).toBe(0)
			expect(el.style.textDecorationStyle).toBe("dotted")
			const desc = container.querySelector(`[id="${el.getAttribute("aria-describedby")}"]`)!
			expect(desc.textContent).toBe("Not linked to a run. Likely from run watershed.0b12… (area_km2).")
			fireEvent.focus(el)
			expect(container.textContent).toContain("Likely from run watershed.0b12… (area_km2)")
		})
	})

	it("does not underline without findings (plain markdown unchanged)", async () => {
		const { container } = render(<MarkdownBlock markdown="Drainage area 774.15 km²." />)
		await vi.waitFor(() => expect(container.textContent).toContain("774.15"))
		expect(container.querySelector('[data-testid="untraced-number"]')).toBeNull()
	})
})

describe("run reference without #path (the owner's 0.4.4 answer)", () => {
	const pathless = "[run:watershed.0b124654840f]"
	const number = uncited("774.15", {
		excerpt: `area 774.15 km² ${pathless}\n- streamflow`,
		suggestedMarker: undefined,
		fixHint: undefined,
	})
	const malformed: AnswerAuditViolation = {
		kind: "malformed_marker",
		severity: "hard",
		excerpt: `area 774.15 km² ${pathless}`,
		message: `'${pathless}' looks like a citation marker but does not match the grammar, so it binds nothing.`,
	}

	it("says the reference has no #path instead of 'not linked to a run'", () => {
		expect(viewFinding(number).status).toContain("no #path")
		expect(viewFinding(malformed).status).toContain("no #path")
		// A number with no reference nearby is still "not linked".
		expect(viewFinding(uncited("0.42", { excerpt: "runoff ratio 0.42 and more" })).status).toBe("Not linked to a run")
	})

	it("names the cause in the summary and still counts every hard finding", () => {
		const view = auditSummaryView(
			audit({ hardCount: 4, violations: [number, malformed, malformed, malformed], advisoryCount: 0 }),
		)
		expect(view?.tone).toBe("warn")
		expect(view?.text).toContain("4 findings need review")
		expect(view?.text).toContain("3 run references have no #path")
	})

	it("the untraced underline carries the same status", () => {
		const plan = untracedPlan([number])
		expect(plan.get("774.15")?.[0].status).toContain("no #path")
	})
})

describe("pathless wording is about the reference the number binds to (nearest after it)", () => {
	const pathless = "[run:watershed.0b124654840f]"
	const valid = "[run:watershed.0b124654840f#key_outputs.area_km2]"
	const num = (excerpt: string) => uncited("774.15", { excerpt, suggestedMarker: undefined, fixHint: undefined })

	it("a valid reference between the number and a later pathless one keeps 'Not linked to a run'", () => {
		expect(viewFinding(num(`area 774.15 km² ${valid} and the record ${pathless}`)).status).toBe("Not linked to a run")
	})

	it("a pathless reference BEFORE the number does not make the number's finding about it", () => {
		expect(viewFinding(num(`from ${pathless} the area is 774.15 km² here`)).status).toBe("Not linked to a run")
	})

	it("the nearest following reference being pathless does", () => {
		expect(viewFinding(num(`area 774.15 km² ${pathless} then ${valid}`)).status).toContain("no #path")
	})
})

describe("gate skipped line (A1)", () => {
	it("an untrusted server is always said, with the reason, at normal detail", () => {
		const { getByTestId } = withDetail(
			"normal",
			<AnswerAuditFooter audit={audit({ status: "violations", hardCount: 1, gateSkipped: "no-trusted-server" })} />,
		)
		const line = getByTestId("answer-audit-gate-skipped").textContent ?? ""
		expect(line).toContain("not held back for checking")
		expect(line).toContain("not trusted")
	})

	it("no-study skips are neutral; the same skip where a study exists is a warning; the technical line always carries it", () => {
		const noStudy = audit({
			status: "unavailable",
			disclosure: { kind: "audit_unavailable", reason: "x" },
			gateSkipped: "study-not-bound",
		})
		expect(gateSkipNeedsAttention(noStudy)).toBe(false)
		expect(gateSkipNeedsAttention({ ...noStudy, sessionId: "s1" })).toBe(true)
		expect(gateSkipNeedsAttention({ ...noStudy, gateSkipped: "no-trusted-server" })).toBe(true)
		expect(gateSkipNeedsAttention({ ...noStudy, gateSkipped: "gate-setting-off" })).toBe(false)
		// A passed audit with a skipped gate reads as such in the technical form used by exports and Verbose.
		expect(auditFooterLine(audit({ status: "passed", cited: 2, total: 2, gateSkipped: "gate-setting-off" }))).toBe(
			"Audit passed: 2/2 numbers traced · gate not run: gate-setting-off",
		)
		expect(auditSummaryLine(audit({ status: "passed", cited: 2, total: 2, gateSkipped: "no-trusted-server" }))).toContain(
			"gate not run: no-trusted-server",
		)
	})

	it("a setting the user chose shows only at verbose", () => {
		const skipped = audit({ status: "passed", cited: 2, total: 2, gateSkipped: "gate-setting-off" })
		expect(withDetail("normal", <AnswerAuditFooter audit={skipped} />).queryByTestId("answer-audit-gate-skipped")).toBeNull()
		const v = withDetail("verbose", <AnswerAuditFooter audit={skipped} />)
		expect(v.getByTestId("answer-audit-gate-skipped").textContent).toContain("turned off in settings")
	})
})
