import { expect } from "chai"
import { describe, it } from "mocha"
import { askMessageMeta } from "../../askMeta"
import { parseReport, REPORT_LIMITS } from "../../tools/handlers/ReportFindingsHandler"

describe("report_findings validation", () => {
	it("requires a summary", () => {
		expect(parseReport({})).to.deep.include({ ok: false })
		expect(parseReport({ summary: "   " })).to.deep.include({ ok: false })
	})

	it("parses bullet and plain lines, trims markers, drops blanks", () => {
		const parsed = parseReport({
			summary: "s",
			key_findings: "- a\n* b\n\n3. c\nd",
			files_read: "x.py\n y.py ",
			open_questions: "- q?",
		})
		expect(parsed.ok && parsed.report).to.deep.equal({
			summary: "s",
			keyFindings: ["a", "b", "c", "d"],
			filesRead: ["x.py", "y.py"],
			openQuestions: ["q?"],
		})
	})

	it("caps counts and lengths and names every cut", () => {
		const parsed = parseReport({
			summary: "s".repeat(REPORT_LIMITS.summaryChars + 50),
			key_findings: Array.from({ length: REPORT_LIMITS.findings + 3 }, (_, i) => `f${i}`).join("\n"),
		})
		expect(parsed.ok).to.equal(true)
		if (parsed.ok) {
			expect(parsed.report.summary).to.have.length(REPORT_LIMITS.summaryChars)
			expect(parsed.report.keyFindings).to.have.length(REPORT_LIMITS.findings)
			expect(parsed.trimmed.join(" ")).to.include("summary cut").and.include("3 key_findings entries dropped")
		}
	})
})

describe("askMessageMeta", () => {
	it("adds the origin only when the host supplied one", () => {
		expect(askMessageMeta(undefined)).to.deep.equal({})
		expect(askMessageMeta({})).to.deep.equal({})
		const origin = { childId: "sa_1", label: "Explorer 1", profile: "explorer" as const, promptHead: "look" }
		expect(askMessageMeta({ subagentOrigin: origin })).to.deep.equal({ subagentOrigin: origin })
	})
})
