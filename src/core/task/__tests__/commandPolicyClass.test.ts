import { expect } from "chai"
import { type CommandPolicyInput, decideCommand } from "../commandPolicy"

const base: CommandPolicyInput = {
	command: "ls",
	modelRequiresApproval: false,
	autoApproveSafe: true,
	autoApproveAll: false,
	subagentsEnabled: true,
	touchesProtectedPath: false,
	shellEnvironment: { platform: "darwin", shell: "/bin/zsh", workspaceTrusted: true },
}
const cls = (over: Partial<CommandPolicyInput>) => {
	const d = decideCommand({ ...base, ...over })
	return d.action === "deny" ? "deny" : d.policyClass
}

describe("decideCommand policyClass (W2-0h)", () => {
	it("flags subagent launches, protected paths, danger grants, model-requested and unclassified approvals", () => {
		expect(cls({ command: "aihydro run --task x" })).to.equal("subagent_launch")
		expect(cls({ touchesProtectedPath: true })).to.equal("protected_path")
		expect(cls({ autoApproveAll: true })).to.equal("auto_run_all")
		expect(cls({ modelRequiresApproval: true })).to.equal("model_requested_approval")
		expect(cls({ command: "python -c 'print(1)'" })).to.equal("not_read_only")
	})

	it("leaves the unremarkable cases unflagged: auto-run off, and a host-classified read-only run", () => {
		expect(cls({ autoApproveSafe: false })).to.equal(undefined)
		expect(cls({})).to.equal(undefined)
	})
})
