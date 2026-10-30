import * as fs from "node:fs"
import * as path from "node:path"
import { reportStudyStatus, type StudyStatus, setStudyStatusSink, studyOf } from "@core/controller/ui/studyStatus"
import { emptyToolsEnvStatus } from "@shared/aihydro/toolsEnv"
import type { StudyBindingState } from "@shared/ExtensionMessage"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { CODE_ACTION_LANGUAGES, CODE_ACTION_SELECTOR, offeredCodeActions } from "../aiHydroCodeActions"
import { studyStatusText } from "../studyStatusText"
import { statusBarText } from "../toolsStatusText"

describe("editor code actions (Nav-6)", () => {
	it("are offered only for Python, R and Jupyter documents", () => {
		expect([...CODE_ACTION_LANGUAGES]).to.deep.equal(["python", "r", "jupyter"])
		expect(CODE_ACTION_SELECTOR).to.deep.equal([{ language: "python" }, { language: "r" }, { language: "jupyter" }])
		for (const language of ["typescript", "javascript", "markdown", "json", "plaintext", "csv", "yaml", "html", ""]) {
			expect(offeredCodeActions(language, true), language).to.deep.equal([])
		}
		for (const language of ["python", "r", "jupyter"]) {
			expect(offeredCodeActions(language, false), language).to.deep.equal(["add", "explain"])
		}
	})

	it("Fix needs a diagnostic and a Python or R document", () => {
		expect(offeredCodeActions("python", true)).to.deep.equal(["add", "explain", "fix"])
		expect(offeredCodeActions("r", true)).to.deep.equal(["add", "explain", "fix"])
		expect(offeredCodeActions("jupyter", true)).to.deep.equal(["add", "explain"])
	})

	it("there is no Improve action, and the provider is registered on the selector, not on every file", () => {
		const source = fs.readFileSync(path.resolve(__dirname, "../../../extension.ts"), "utf8")
		expect(source).to.not.contain("Improve with AI-Hydro")
		expect(source).to.contain("registerCodeActionsProvider(\n\t\t\tCODE_ACTION_SELECTOR")
		expect(source).to.not.match(/registerCodeActionsProvider\(\s*"\*"/)
	})
})

describe("tools status bar text (Nav-6)", () => {
	it("names the product in every phase, and says tools (the version is the tools package's)", () => {
		const phases = ["checking", "installing", "ready", "failed", "unhealthy", "custom", "missing"] as const
		for (const phase of phases) {
			const t = statusBarText(emptyToolsEnvStatus({ phase, version: "2.8.1" }))
			expect(t.text, phase).to.contain("AI-Hydro tools")
		}
		const ready = statusBarText(emptyToolsEnvStatus({ phase: "ready", healthy: true, version: "2.8.1", trust: "trusted" }))
		expect(ready.text).to.equal("$(check) AI-Hydro tools 2.8.1")
		expect(ready.warn).to.equal(false)
	})

	it("an untrusted launcher still warns and says so", () => {
		const t = statusBarText(emptyToolsEnvStatus({ phase: "ready", healthy: true, version: "2.8.1", trust: "untrusted" }))
		expect(t.text).to.contain("untrusted")
		expect(t.warn).to.equal(true)
	})
})

describe("study status item (Nav-6)", () => {
	let seen: (StudyStatus | undefined)[]
	const bound = (studyId: string, label?: string): StudyBindingState => ({
		chatId: "c1",
		status: "bound",
		studyId,
		label,
		canChoose: true,
	})
	beforeEach(() => {
		reportStudyStatus(undefined)
		seen = []
		setStudyStatusSink((s) => seen.push(s))
		seen.length = 0
	})
	afterEach(() => {
		reportStudyStatus(undefined)
		setStudyStatusSink(undefined)
	})

	it("appears only when the chat is bound to a study", () => {
		for (const status of ["choose", "none", "unavailable"] as const) {
			expect(studyOf({ chatId: "c1", status, studyId: "01031500", canChoose: false }), status).to.equal(undefined)
		}
		expect(studyOf({ chatId: "c1", status: "bound", canChoose: false })).to.equal(undefined)
		expect(studyOf(undefined)).to.equal(undefined)
		reportStudyStatus({ chatId: "c1", status: "none", canChoose: false })
		expect(seen).to.deep.equal([])
		reportStudyStatus(bound("01031500", "Piscataquis"))
		expect(seen).to.deep.equal([{ studyId: "01031500", label: "Piscataquis" }])
	})

	it("hides again when the binding goes away, and repeated state posts do not repaint", () => {
		reportStudyStatus(bound("01031500"))
		reportStudyStatus(bound("01031500"))
		reportStudyStatus(bound("01031500"))
		expect(seen).to.have.length(1)
		reportStudyStatus(undefined)
		expect(seen).to.deep.equal([{ studyId: "01031500" }, undefined])
	})

	it("a sink registered later draws the current study, and a throwing sink does not break state posting", () => {
		reportStudyStatus(bound("A"))
		const late: (StudyStatus | undefined)[] = []
		setStudyStatusSink((s) => late.push(s))
		expect(late).to.deep.equal([{ studyId: "A" }])
		setStudyStatusSink(() => {
			throw new Error("status bar failed")
		})
		expect(() => reportStudyStatus(bound("B"))).to.not.throw()
	})

	it("the text names the study and the accessible label names the product", () => {
		const t = studyStatusText({ studyId: "01031500", label: "Piscataquis River" })
		expect(t.text).to.contain("Piscataquis River")
		expect(t.accessibility).to.equal("AI-Hydro study Piscataquis River")
		expect(studyStatusText({ studyId: "01031500" }).text).to.contain("01031500")
	})
})
