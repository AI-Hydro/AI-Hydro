import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { AiHydroDefaultTool } from "@/shared/tools"
import { HostProvider } from "@/hosts/host-provider"
import { AutoApprove } from "../autoApprove"

/**
 * B3: Edit auto-run (and "Edit all files", and YOLO) never auto-approves a write into protected state.
 * Workspace paths are injected through the cache AutoApprove fills on first use, so no host is needed.
 */
describe("AutoApprove.shouldAutoApproveToolWithPath protected paths (B3)", () => {
	function approver(opts: { yolo?: boolean; editAll?: boolean }) {
		const state: Record<string, unknown> = {
			yoloModeToggled: !!opts.yolo,
			autoApprovalSettings: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				enabled: true,
				actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, editFiles: true, editFilesExternally: !!opts.editAll },
			},
			multiRootEnabled: false,
		}
		const instance = new AutoApprove({ getGlobalSettingsKey: (k: string) => state[k] } as any)
		;(instance as any).workspacePathsCache = { paths: [process.cwd()] }
		;(instance as any).isMultiRootScenarioCache = false
		return instance
	}

	// A minimal host: only the workspace client the approver consults (cwd lookup).
	beforeEach(() => {
		HostProvider.reset()
		HostProvider.initialize(
			(() => {}) as any,
			(() => {}) as any,
			{ workspaceClient: { getWorkspacePaths: async () => ({ paths: [process.cwd()] }) } } as any,
			() => {},
			async () => "",
			async () => "",
			"/mock/extension",
			path.join(os.tmpdir(), "aihydro-ap1-storage"),
		)
	})
	afterEach(() => HostProvider.reset())

	const home = os.homedir()
	const protectedTargets = [
		path.join(home, ".ssh", "authorized_keys"),
		path.join(home, ".aihydro", "approvals", "x.json"),
		path.join(home, ".aihydro", "trust", "roots.json"),
		path.join(home, ".aihydro", "registry", "claims.jsonl"),
		"~/.ssh/config",
	]

	for (const tool of [AiHydroDefaultTool.FILE_NEW, AiHydroDefaultTool.FILE_EDIT, AiHydroDefaultTool.MULTI_FILE_EDIT]) {
		for (const target of protectedTargets) {
			it(`${tool} to ${target} asks even with Edit auto-run on, Edit-all on, and YOLO`, async () => {
				for (const opts of [{}, { editAll: true }, { yolo: true }, { yolo: true, editAll: true }]) {
					expect(await approver(opts).shouldAutoApproveToolWithPath(tool, target), JSON.stringify(opts)).to.equal(false)
				}
			})
		}
	}

	it("still auto-approves an ordinary workspace edit when Edit auto-run is on", async () => {
		expect(await approver({}).shouldAutoApproveToolWithPath(AiHydroDefaultTool.FILE_EDIT, "src/a.ts")).to.equal(true)
		expect(await approver({ yolo: true }).shouldAutoApproveToolWithPath(AiHydroDefaultTool.FILE_EDIT, "src/a.ts")).to.equal(
			true,
		)
	})

	it("does not change read approval for the same paths (writes only)", async () => {
		const result = await approver({ yolo: true }).shouldAutoApproveToolWithPath(
			AiHydroDefaultTool.FILE_READ,
			path.join(home, ".ssh", "config"),
		)
		expect(result).to.equal(true) // pre-existing behaviour, out of AP1 scope
	})
})
