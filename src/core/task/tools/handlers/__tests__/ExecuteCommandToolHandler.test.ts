import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { resetTelemetryService } from "@/services/telemetry"
import { TelemetryService } from "@/services/telemetry/TelemetryService"
import { AiHydroDefaultTool } from "@/shared/tools"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { setWorkspaceTrustProvider } from "../../../workspaceTrust"
import { AutoApprove } from "../../autoApprove"
import { ExecuteCommandToolHandler } from "../ExecuteCommandToolHandler"

/**
 * Handler-level tests for the host-side command policy (approval redesign AP1: T13, T14, T15). The policy
 * itself is covered exhaustively in task/__tests__/commandPolicy.test.ts; these prove the handler is wired to it:
 * what runs, what asks, what is refused, with the REAL AutoApprove settings mapping (including YOLO).
 */
describe("ExecuteCommandToolHandler host-side command policy", () => {
	let sandbox: sinon.SinonSandbox
	let savedShell: string | undefined

	beforeEach(() => {
		// Classification is shell-dependent (fail closed outside bash/zsh/sh/dash): pin a POSIX shell.
		savedShell = process.env.SHELL
		process.env.SHELL = "/bin/zsh"
		setWorkspaceTrustProvider(() => true)
		sandbox = sinon.createSandbox()
		// telemetryService is a lazy proxy that builds the real service on first use; give it an inert one.
		resetTelemetryService()
		sandbox.stub(TelemetryService, "create").resolves({
			captureToolUsage: () => {},
			captureWorkspacePathResolved: () => {},
		} as unknown as TelemetryService)
	})
	afterEach(() => {
		setWorkspaceTrustProvider(undefined)
		if (savedShell === undefined) {
			delete process.env.SHELL
		} else {
			process.env.SHELL = savedShell
		}
		sandbox.restore()
		resetTelemetryService()
	})

	function makeConfig(opts: { yolo?: boolean; safe?: boolean; all?: boolean; subagentsEnabled?: boolean; approve?: boolean }) {
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			enabled: true,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				executeSafeCommands: opts.safe ?? true,
				executeAllCommands: opts.all ?? false,
			},
		}
		const state: Record<string, unknown> = {
			yoloModeToggled: !!opts.yolo,
			autoApprovalSettings: settings,
			subagentsEnabled: opts.subagentsEnabled ?? true,
		}
		const stateManager = { getGlobalSettingsKey: (key: string) => state[key] }
		const calls = { ask: [] as string[], say: [] as [string, string | undefined][], executed: [] as string[] }
		const config: any = {
			ulid: "u",
			cwd: "/work",
			yoloModeToggled: !!opts.yolo,
			isMultiRootEnabled: false,
			autoApprovalSettings: settings,
			autoApprover: new AutoApprove(stateManager as any),
			api: { getModel: () => ({ id: "test-model" }) },
			taskState: {
				consecutiveMistakeCount: 0,
				consecutiveAutoApprovedRequestsCount: 0,
				fileReadCache: { clear: () => {} },
			},
			services: {
				stateManager,
				aihydroIgnoreController: { validateCommand: () => undefined },
			},
			callbacks: {
				say: async (type: string, text?: string) => {
					calls.say.push([type, text])
					return undefined
				},
				ask: async (_type: string, text?: string) => {
					calls.ask.push(text ?? "")
					return { response: opts.approve === false ? "noButtonClicked" : "yesButtonClicked" }
				},
				removeLastPartialMessageIfExistsWithType: async () => {},
				sayAndCreateMissingParamError: async () => "missing",
				executeCommandTool: async (command: string) => {
					calls.executed.push(command)
					return [false, "ok"]
				},
			},
		}
		return { config, calls }
	}

	const run = (command: string, requiresApproval: boolean, opts: Parameters<typeof makeConfig>[0] = {}) => {
		const { config, calls } = makeConfig(opts)
		const handler = new ExecuteCommandToolHandler({} as any)
		const block: any = {
			name: AiHydroDefaultTool.BASH,
			params: { command, requires_approval: String(requiresApproval) },
			partial: false,
		}
		return handler.execute(config, block).then((result) => ({ result, calls }))
	}

	it("T14 python -c with requires_approval=false asks under default settings (the model's flag is not trusted)", async () => {
		const { calls } = await run("python -c 'print(1)'", false)
		expect(calls.ask).to.have.length(1)
		expect(calls.executed).to.have.length(1) // ran only after the (simulated) human approval
	})

	it("T14 ls, git status and cat README.md run without asking", async () => {
		for (const command of ["ls", "git status", "cat README.md"]) {
			const { calls } = await run(command, false)
			expect(calls.ask, command).to.have.length(0)
			// git runs hardened (workspace trust is the gate, the environment is the second layer); others as written
			if (command.startsWith("git")) {
				expect(calls.executed, command).to.have.length(1)
				expect(calls.executed[0], command).to.include("GIT_CONFIG_COUNT=")
				expect(calls.executed[0], command).to.include(command)
			} else {
				expect(calls.executed, command).to.deep.equal([command])
			}
		}
	})

	it("T14 a read-only command still asks when the model sets requires_approval=true", async () => {
		const { calls } = await run("ls", true)
		expect(calls.ask).to.have.length(1)
	})

	it("T14 a rejected ask does not execute", async () => {
		const { calls } = await run("rm -rf build", false, { approve: false })
		expect(calls.executed).to.have.length(0)
	})

	for (const form of [
		"aihydro-approve s c",
		"/opt/miniconda3/bin/aihydro-approve s c",
		"AIHYDRO_REQUIRE_SIGNED=0 aihydro-approve s c",
		"bash <<'EOF'\naihydro-approve s c\nEOF",
		"cd x && aihydro-approve s c",
		'"aihydro-approve" s c',
		"python -m ai_hydro.approval.cli s c",
	]) {
		it(`T13 refuses ${JSON.stringify(form)} with requires_approval=false in YOLO and with execute-all`, async () => {
			for (const opts of [{ yolo: true }, { safe: true, all: true }]) {
				const { result, calls } = await run(form, false, opts)
				expect(calls.executed, "must not execute").to.have.length(0)
				expect(calls.ask, "must not even ask").to.have.length(0)
				expect(String(result)).to.include("your own")
				expect(String(result)).to.include("terminal")
			}
		})
	}

	it('T15 aihydro "x" with requires_approval=false asks, including in YOLO, and names the no-YOLO launch', async () => {
		for (const opts of [{}, { yolo: true }, { safe: true, all: true }]) {
			const { calls } = await run('aihydro "x"', false, opts)
			expect(calls.ask, JSON.stringify(opts)).to.have.length(1)
			expect(calls.say.some(([, text]) => /WITHOUT YOLO/.test(text ?? ""))).to.equal(true)
		}
	})

	it('T15 aihydro "x" is refused when subagents are disabled', async () => {
		for (const opts of [{ subagentsEnabled: false }, { subagentsEnabled: false, yolo: true }]) {
			const { result, calls } = await run('aihydro "x"', false, opts)
			expect(calls.ask).to.have.length(0)
			expect(calls.executed).to.have.length(0)
			expect(String(result)).to.include("Subagents are disabled")
		}
	})

	it("a command that mentions a protected path asks even under execute-all", async () => {
		const { calls } = await run("cat ~/.ssh/id_ed25519", false, { safe: true, all: true })
		expect(calls.ask).to.have.length(1)
	})
})
