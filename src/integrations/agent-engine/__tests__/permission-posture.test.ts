import { expect } from "chai"
import { toClaudePermissionMode, toCodexSandboxPosture } from "../permission-posture"

describe("permission-posture", () => {
	describe("toClaudePermissionMode", () => {
		it("never returns bypassPermissions", () => {
			expect(toClaudePermissionMode("read-only")).to.not.equal("bypassPermissions")
			expect(toClaudePermissionMode("scoped-write")).to.not.equal("bypassPermissions")
		})

		it("maps read-only to plan and scoped-write to acceptEdits", () => {
			expect(toClaudePermissionMode("read-only")).to.equal("plan")
			expect(toClaudePermissionMode("scoped-write")).to.equal("acceptEdits")
		})
	})

	describe("toCodexSandboxPosture", () => {
		it("never returns danger-full-access", () => {
			expect(toCodexSandboxPosture("read-only").sandbox).to.not.equal("danger-full-access")
			expect(toCodexSandboxPosture("scoped-write").sandbox).to.not.equal("danger-full-access")
		})

		it("maps read-only to the read-only sandbox and scoped-write to workspace-write", () => {
			expect(toCodexSandboxPosture("read-only").sandbox).to.equal("read-only")
			expect(toCodexSandboxPosture("scoped-write").sandbox).to.equal("workspace-write")
		})

		it("always sets approvalPolicy to never (no TTY to answer a prompt in headless engine mode)", () => {
			expect(toCodexSandboxPosture("read-only").approvalPolicy).to.equal("never")
			expect(toCodexSandboxPosture("scoped-write").approvalPolicy).to.equal("never")
		})
	})
})
