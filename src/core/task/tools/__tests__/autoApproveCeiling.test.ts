import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { AiHydroDefaultTool } from "@/shared/tools"
import { AutoApprove, type AutoApproveCeiling } from "../autoApprove"

/**
 * S2: a subagent never inherits YOLO, "execute all commands" or an edit grant. Its ceiling is its own reads and MCP,
 * and only when the user's own settings approve those. "none" (untrusted workspace) approves nothing.
 */
function approver(ceiling: AutoApproveCeiling | undefined, opts: { yolo?: boolean; actions?: Record<string, boolean> } = {}) {
	const state: Record<string, unknown> = {
		yoloModeToggled: !!opts.yolo,
		multiRootEnabled: false,
		autoApprovalSettings: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			enabled: true,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				readFiles: true,
				editFiles: true,
				executeSafeCommands: true,
				executeAllCommands: true,
				useMcp: true,
				useBrowser: true,
				...opts.actions,
			},
		},
	}
	const instance = new AutoApprove(
		{ getGlobalSettingsKey: (k: string) => state[k], getGlobalStateKey: (k: string) => state[k] } as any,
		ceiling,
	)
	;(instance as any).workspacePathsCache = { paths: [process.cwd()] }
	;(instance as any).isMultiRootScenarioCache = false
	return instance
}

const WRITES_AND_COMMANDS = [
	AiHydroDefaultTool.FILE_NEW,
	AiHydroDefaultTool.FILE_EDIT,
	AiHydroDefaultTool.MULTI_FILE_EDIT,
	AiHydroDefaultTool.NEW_RULE,
	AiHydroDefaultTool.BASH,
	AiHydroDefaultTool.BROWSER,
	AiHydroDefaultTool.WEB_FETCH,
]

describe("AutoApprove ceiling", () => {
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
			path.join(os.tmpdir(), "aihydro-ceiling-storage"),
		)
	})
	afterEach(() => HostProvider.reset())

	it("a top-level task is unchanged: it follows the settings and YOLO", () => {
		expect(approver(undefined, { yolo: true }).shouldAutoApproveTool(AiHydroDefaultTool.BASH)).to.deep.equal([true, true])
		expect(approver(undefined).shouldAutoApproveTool(AiHydroDefaultTool.FILE_NEW)).to.deep.equal([true, false])
	})

	for (const yolo of [false, true]) {
		it(`"read" ceiling (yolo=${yolo}): writes, commands, browser and fetch never auto-approve`, async () => {
			const a = approver("read", { yolo })
			for (const tool of WRITES_AND_COMMANDS) {
				expect(a.shouldAutoApproveTool(tool), tool).to.equal(false)
				expect(await a.shouldAutoApproveToolWithPath(tool, "src/a.py"), tool).to.equal(false)
			}
		})
	}

	it('"read" ceiling ignores YOLO: reads follow the user\'s read setting alone', async () => {
		const off = approver("read", { yolo: true, actions: { readFiles: false, useMcp: false } })
		expect(off.shouldAutoApproveTool(AiHydroDefaultTool.FILE_READ)).to.deep.equal([false, false])
		expect(off.shouldAutoApproveTool(AiHydroDefaultTool.MCP_USE)).to.equal(false)
		expect(await off.shouldAutoApproveToolWithPath(AiHydroDefaultTool.FILE_READ, "README.md")).to.equal(false)

		const on = approver("read", { yolo: false })
		expect(on.shouldAutoApproveTool(AiHydroDefaultTool.FILE_READ)).to.deep.equal([true, false])
		expect(on.shouldAutoApproveTool(AiHydroDefaultTool.MCP_USE)).to.equal(true)
	})

	it('"none" ceiling approves nothing, YOLO included', async () => {
		const a = approver("none", { yolo: true })
		for (const tool of Object.values(AiHydroDefaultTool)) {
			expect(a.shouldAutoApproveTool(tool), tool).to.equal(false)
			expect(await a.shouldAutoApproveToolWithPath(tool, "README.md"), tool).to.equal(false)
		}
	})
})
