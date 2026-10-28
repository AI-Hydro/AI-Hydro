import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { resetTelemetryService } from "@/services/telemetry"
import { TelemetryService } from "@/services/telemetry/TelemetryService"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { AiHydroDefaultTool } from "@/shared/tools"
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
		// The UI rows the handler's callbacks would have created (the handler marks its command row's policyClass).
		const rows: any[] = []
		const config: any = {
			messageState: {
				getAiHydroMessages: () => rows,
				updateAiHydroMessage: async (i: number, patch: object) => {
					Object.assign(rows[i], patch)
				},
			},
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
					rows.push({ type: "say", say: type, text })
					return undefined
				},
				ask: async (_type: string, text?: string) => {
					calls.ask.push(text ?? "")
					rows.push({ type: "ask", ask: _type, text })
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
		return { config, calls, rows }
	}

	const run = (command: string, requiresApproval: boolean, opts: Parameters<typeof makeConfig>[0] = {}) => {
		const { config, calls, rows } = makeConfig(opts)
		const handler = new ExecuteCommandToolHandler({} as any)
		const block: any = {
			name: AiHydroDefaultTool.BASH,
			params: { command, requires_approval: String(requiresApproval) },
			partial: false,
		}
		return handler.execute(config, block).then((result) => ({ result, calls, rows }))
	}

	it("T14 python -c with requires_approval=false asks under default settings (the model's flag is not trusted)", async () => {
		const { calls } = await run("python -c 'print(1)'", false)
		expect(calls.ask).to.have.length(1)
		expect(calls.executed).to.have.length(1) // ran only after the (simulated) human approval
	})

	// The classifier fails closed on Windows (the shell is not modelled), so nothing auto-runs there: assert that instead.
	it("T14 on Windows nothing is classified read-only, so even ls asks", async function () {
		if (process.platform !== "win32") {
			this.skip()
		}
		for (const command of ["ls", "git status", "cat README.md"]) {
			const { calls } = await run(command, false)
			expect(calls.ask, command).to.have.length(1)
		}
	})

	it("T14 ls, git status and cat README.md run without asking", async function () {
		if (process.platform === "win32") {
			this.skip()
		}
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
		"node dist/aihydro-pack.cjs sign pack.unsigned --key k --out p",
		"npm run aihydro-pack -- init-key",
		"aihydro-pack sign x",
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

	it("T15 the retired aihydro CLI subagent is refused in every setting, with a message and without asking or running", async () => {
		for (const opts of [
			{},
			{ yolo: true },
			{ safe: true, all: true },
			{ subagentsEnabled: true },
			{ subagentsEnabled: false },
		]) {
			const { result, calls } = await run('aihydro "x"', false, opts)
			expect(calls.ask, JSON.stringify(opts)).to.have.length(0)
			expect(calls.executed, JSON.stringify(opts)).to.have.length(0)
			expect(String(result)).to.include("was retired")
		}
	})

	it("a command that mentions a protected path asks even under execute-all", async () => {
		const { calls } = await run("cat ~/.ssh/id_ed25519", false, { safe: true, all: true })
		expect(calls.ask).to.have.length(1)
	})

	it("W2-0h marks a policy-flagged command row with its policyClass; unremarkable commands carry none", async function () {
		if (process.platform === "win32") {
			this.skip()
		}
		const readOnly = await run("ls", false)
		expect(readOnly.rows.find((r) => r.say === "command")?.policyClass).to.equal(undefined)
		const allOn = await run("python -c 'print(1)'", false, { all: true })
		expect(allOn.rows.find((r) => r.say === "command")?.policyClass).to.equal("auto_run_all")
		const modelAsked = await run("ls", true)
		expect(modelAsked.rows.find((r) => r.ask === "command")?.policyClass).to.equal("model_requested_approval")
	})
})
