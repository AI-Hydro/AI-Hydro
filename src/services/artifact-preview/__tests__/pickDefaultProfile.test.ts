import { expect } from "chai"
import { describe, it } from "mocha"
import { isWorkspaceDerived, pickDefaultProfile } from "../discoverPythonEnvironments"
import type { KernelProfile } from "../KernelProfile"

const p = (source: KernelProfile["source"], id = source) => ({ id, source })

describe("pickDefaultProfile", () => {
	it("never defaults to a workspace-derived interpreter, even when it is the only one", () => {
		expect(pickDefaultProfile([p("workspace_venv"), p("aihydro_venv")])).to.equal(null)
	})

	it("prefers the machine-scoped override over a user-level VS Code interpreter, then PATH", () => {
		expect(pickDefaultProfile([p("path"), p("vscode"), p("custom"), p("aihydro_venv")])?.source).to.equal("custom")
		expect(pickDefaultProfile([p("path"), p("vscode"), p("workspace_venv")])?.source).to.equal("vscode")
		expect(pickDefaultProfile([p("workspace_venv"), p("path")])?.source).to.equal("path")
	})

	it("classifies repository-supplied sources as workspace-derived", () => {
		expect(isWorkspaceDerived(p("workspace_venv"))).to.equal(true)
		expect(isWorkspaceDerived(p("aihydro_venv"))).to.equal(true)
		for (const source of ["custom", "vscode", "path"] as const) expect(isWorkspaceDerived(p(source))).to.equal(false)
	})
})
