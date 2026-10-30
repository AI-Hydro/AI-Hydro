import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { getRecordedFirstPartyLauncher, setRecordedFirstPartyLauncher } from "@/shared/aihydro/firstPartyServers"
import { describeToolsStatus, type ToolsEnvStatus, venvMcpPath } from "@/shared/aihydro/toolsEnv"
import { readFirstPartyLauncher, recordFirstPartyLauncher } from "../../firstPartyLauncher"
import { ToolsEnvController, type ToolsEnvHost, type ToolsEnvPersisted } from "../ToolsEnvController"
import { createFakeMachine, type FakeMachine, makeVenv } from "./fakeToolsEnv"

describe("ToolsEnvController", () => {
	let dir: string
	let venv: string
	let settingsPath: string
	let machine: FakeMachine
	let saved: ReturnType<typeof getRecordedFirstPartyLauncher>
	let trustAnswers: boolean[]
	let trustAsked: number
	let notices: { kind: string; message: string; actions: string[] }[]
	let state: ToolsEnvPersisted
	let config: { autoInstall: boolean; venvPath: string }
	let installAnswer: boolean
	let installAsked: { venvPath: string; requirement: string }[]
	let recreateAnswer: boolean
	let switchAnswer: "switch" | "keep" | undefined
	let abortOnProgress: boolean
	let chooseAnswer: string | undefined
	let chooseAsked: { name: string; command: string }[][]

	beforeEach(async () => {
		saved = getRecordedFirstPartyLauncher()
		setRecordedFirstPartyLauncher(undefined)
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "tools-ctl-"))
		venv = path.join(dir, "venvs", "tools-2.8") // the default managed dir under paths.venvsDir
		settingsPath = path.join(dir, "aihydro_mcp_settings.json")
		machine = createFakeMachine(venv)
		trustAnswers = []
		trustAsked = 0
		notices = []
		state = {}
		config = { autoInstall: true, venvPath: "" }
		installAnswer = true
		installAsked = []
		recreateAnswer = false
		switchAnswer = "switch"
		abortOnProgress = false
		chooseAnswer = undefined
		chooseAsked = []
	})
	afterEach(async () => {
		setRecordedFirstPartyLauncher(saved)
		await fs.rm(dir, { recursive: true, force: true })
	})

	const host = (): ToolsEnvHost => ({
		getConfig: () => ({ venvPath: config.venvPath, pythonPaths: [], autoInstall: config.autoInstall }),
		withProgress: async (_title, task) => {
			const ac = new AbortController()
			if (abortOnProgress) {
				setTimeout(() => ac.abort(), 0)
			}
			return task(() => {}, ac.signal)
		},
		confirmTrust: async () => {
			trustAsked++
			return trustAnswers.shift() ?? false
		},
		chooseLauncher: async (candidates) => {
			chooseAsked.push(candidates.map((c) => ({ name: c.name, command: c.command })))
			return chooseAnswer
		},
		askSwitch: async () => switchAnswer,
		notify: async (kind, message, actions) => {
			notices.push({ kind, message, actions })
			return undefined
		},
		showLog: () => {},
		copyText: async () => {},
		readState: async () => ({ ...state }),
		writeState: async (patch) => {
			state = { ...state, ...patch }
		},
		confirmInstall: async (info) => {
			installAsked.push(info)
			return installAnswer
		},
		confirmRecreate: async () => recreateAnswer,
		extensionVersion: () => "0.0.0-test",
	})
	const controller = () =>
		new ToolsEnvController(host(), machine.deps, {
			venvsDir: path.join(dir, "venvs"),
			settingsDir: dir,
			settingsPath,
			cacheDir: path.join(dir, "cache"),
		})
	const settled = async (c: ToolsEnvController) => {
		// startup() kicks off the background refresh; refresh() joins the running one.
		await c.refresh({ auto: false })
	}
	const readEntry = async (name: string) =>
		(JSON.parse(await fs.readFile(settingsPath, "utf-8")).mcpServers as Record<string, Record<string, unknown>>)[name]
	const mcp = () => venvMcpPath(venv, "linux")

	it("fresh profile: installs, registers, records trust, and ends ready + trusted + healthy with the version", async () => {
		const c = controller()
		const phases: string[] = []
		c.onDidChange((s) => phases.push(s.phase))
		await c.startup()
		await c.refresh({ auto: false }) // joins the in-flight install
		const s = c.getStatus()
		expect(phases).to.include("installing")
		expect(s).to.include({ phase: "ready", healthy: true, version: "2.8.2", trust: "trusted", serverName: "ai-hydro" })
		expect(s.serverCommand).to.equal(mcp())
		expect((await readEntry("ai-hydro")).command).to.equal(mcp())
		expect((await readFirstPartyLauncher(dir))?.command).to.equal(mcp())
		expect(trustAsked).to.equal(0) // first registration records without a prompt
		expect(installAsked).to.have.length(1) // one-time consent naming the venv path
		expect(installAsked[0].venvPath).to.equal(venv)
		expect(state.installConsent).to.equal(true)
		expect(state.recordExisted).to.equal(true)
		expect(machine.calls.filter((x) => x.includes("pip"))).to.have.length(1)
	})

	it("autoInstall:false (test hosts) never creates a venv or runs pip, and reports 'missing' with Install available", async () => {
		const c = controller()
		await c.startup({ autoInstall: false })
		await settled(c)
		expect(c.getStatus().phase).to.equal("missing")
		expect(machine.calls.some((x) => x.includes("pip") || x.includes("venv"))).to.equal(false)
		await c.runAction("install")
		expect(c.getStatus().phase).to.equal("ready")
	})

	it("no consent, or autoInstall off, or a custom venvPath: nothing is installed automatically", async () => {
		installAnswer = false
		let c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus().phase).to.equal("missing")
		expect(state.installConsent).to.equal(undefined)
		installAnswer = true
		config.autoInstall = false
		c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus().phase).to.equal("missing")
		config = { autoInstall: true, venvPath: venv }
		c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus().phase).to.equal("missing")
		expect(machine.calls.some((x) => x.includes("pip") || x.includes("venv"))).to.equal(false)
	})

	it("an existing but unhealthy venv is never auto-repaired; Repair does it", async () => {
		makeVenv(machine, "2.8.2")
		machine.handshakeFailures.count = 1
		const c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus().phase).to.equal("unhealthy")
		expect(machine.calls.some((x) => x.includes("pip"))).to.equal(false)
		await c.runAction("repair")
		expect(c.getStatus().phase).to.equal("ready")
	})

	it("an outdated healthy venv (2.8.0) is reported, not upgraded automatically", async () => {
		makeVenv(machine, "2.8.0")
		const c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus()).to.include({ phase: "unhealthy", version: "2.8.0" })
		expect(machine.calls.some((x) => x.includes("pip"))).to.equal(false)
		await c.runAction("repair")
		expect(c.getStatus()).to.include({ phase: "ready", version: "2.8.2" })
	})

	it("a forged 'trust' with no record shows the modal and records nothing without confirmation", async () => {
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: { "ai-hydro": { command: mcp(), args: [] } } }))
		const c = controller()
		trustAnswers = [false]
		await c.runAction("trust")
		expect(trustAsked).to.equal(1)
		expect(await readFirstPartyLauncher(dir)).to.equal(undefined)
		trustAnswers = [true]
		await c.runAction("trust")
		expect((await readFirstPartyLauncher(dir))?.command).to.equal(mcp())
	})

	it("a record that existed and is now missing is not silently re-recorded: notice plus confirmation", async () => {
		makeVenv(machine, "2.8.2")
		state.recordExisted = true
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: { "ai-hydro": { command: mcp(), args: [] } } }))
		trustAnswers = [false]
		const c = controller()
		await c.startup()
		await settled(c)
		expect(trustAsked).to.equal(1)
		expect(notices.some((n) => /record .* is missing/.test(n.message))).to.equal(true)
		expect(await readFirstPartyLauncher(dir)).to.equal(undefined)
		expect(c.getStatus().trust).to.equal("untrusted")
	})

	it("after a declined confirmation the existing record is loaded into memory", async () => {
		makeVenv(machine, "2.8.2")
		await recordFirstPartyLauncher(dir, { name: "ai-hydro", command: "/opt/old/aihydro-mcp", args: [] })
		setRecordedFirstPartyLauncher(undefined)
		await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: { "ai-hydro": { command: mcp(), args: [] } } }))
		trustAnswers = [false]
		const c = controller()
		await c.startup()
		await settled(c)
		expect(getRecordedFirstPartyLauncher()?.command).to.equal("/opt/old/aihydro-mcp")
	})

	it("adopts an existing healthy venv: no pip, no venv creation, registered and recorded", async () => {
		makeVenv(machine, "2.8.2")
		const c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus()).to.include({ phase: "ready", healthy: true, trust: "trusted" })
		expect(machine.calls.some((x) => x.includes("pip") || x.includes("venv"))).to.equal(false)
	})

	it("owner machine: entry already points at the managed venv but the record names another command -> asks, untrusted until confirmed", async () => {
		makeVenv(machine, "2.8.2")
		await recordFirstPartyLauncher(dir, { name: "aihydro-tools", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] })
		await fs.writeFile(
			settingsPath,
			JSON.stringify({ mcpServers: { "aihydro-tools": { command: mcp(), args: [], autoApprove: ["a"] } } }),
		)
		trustAnswers = [false, false]
		const c = controller()
		await c.startup()
		await settled(c)
		expect(trustAsked).to.equal(1) // declined once; the background re-check does not show the modal again
		expect(c.getStatus()).to.include({ phase: "ready", healthy: true, trust: "untrusted", serverName: "aihydro-tools" })
		expect((await readFirstPartyLauncher(dir))?.command).to.equal("/opt/miniconda3/bin/aihydro-mcp")
		expect(Object.keys(JSON.parse(await fs.readFile(settingsPath, "utf-8")).mcpServers)).to.deep.equal(["aihydro-tools"])

		trustAnswers = [true]
		await c.runAction("trust")
		expect(c.getStatus().trust).to.equal("trusted")
		expect((await readFirstPartyLauncher(dir))?.command).to.equal(mcp())
	})

	it("stale record (old ai-hydro disabled, aihydro-tools running): untrusted, says so, and trust is recorded only after the modal is confirmed", async () => {
		makeVenv(machine, "2.8.2")
		await recordFirstPartyLauncher(dir, { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] })
		await fs.writeFile(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					"ai-hydro": { command: "/opt/miniconda3/bin/aihydro-mcp", args: [], disabled: true },
					"aihydro-tools": { command: mcp(), args: [] },
				},
			}),
		)
		const notes: (string | undefined)[] = []
		const base = host()
		const withNotes: ToolsEnvHost = {
			...base,
			confirmTrust: async (launcher, recorded, note) => {
				notes.push(note)
				return base.confirmTrust(launcher, recorded, note)
			},
		}
		const c = new ToolsEnvController(withNotes, machine.deps, {
			venvsDir: path.join(dir, "venvs"),
			settingsDir: dir,
			settingsPath,
			cacheDir: path.join(dir, "cache"),
		})
		trustAnswers = [false, false]
		await c.startup()
		await settled(c)
		// The status describes the server in use (not the disabled entry the record names), in plain words.
		const s = c.getStatus()
		expect(s).to.include({ phase: "ready", trust: "untrusted", serverName: "aihydro-tools" })
		expect(s.trustReason).to.contain("running from a new location")
		expect(s.trustReason).to.contain(mcp())
		expect(s.trustReason).to.contain("Previously trusted: ai-hydro (disabled).")
		expect(describeToolsStatus(s).actions).to.include("trust")
		// Declining the modal records nothing.
		expect((await readFirstPartyLauncher(dir))?.name).to.equal("ai-hydro")
		trustAnswers = [false]
		await c.runAction("trust")
		expect((await readFirstPartyLauncher(dir))?.name).to.equal("ai-hydro")
		expect(c.getStatus().trust).to.equal("untrusted")
		expect(notes.at(-1)).to.equal("Previously trusted: ai-hydro (disabled).")
		// Confirming records the ENABLED entry, and the in-memory anchor follows at once.
		trustAnswers = [true]
		await c.runAction("trust")
		expect(await readFirstPartyLauncher(dir)).to.include({ name: "aihydro-tools", command: mcp() })
		expect(getRecordedFirstPartyLauncher()).to.include({ name: "aihydro-tools", command: mcp() })
		expect(c.getStatus().trust).to.equal("trusted")
	})

	describe("two enabled first-party launchers (no silent pick)", () => {
		const twoEnabled = async () => {
			makeVenv(machine, "2.8.2")
			await recordFirstPartyLauncher(dir, { name: "ai-hydro", command: "/opt/old/aihydro-mcp", args: [] })
			await fs.writeFile(
				settingsPath,
				JSON.stringify({
					mcpServers: {
						"ai-hydro": { command: "/opt/old/aihydro-mcp", args: [] },
						"aihydro-tools": { command: mcp(), args: [] },
					},
				}),
			)
		}
		const prompts: { name: string; note?: string }[] = []
		const ctl = () => {
			prompts.length = 0
			const base = host()
			return new ToolsEnvController(
				{
					...base,
					confirmTrust: async (launcher, recorded, note) => {
						prompts.push({ name: launcher.name, note })
						return base.confirmTrust(launcher, recorded, note)
					},
				},
				machine.deps,
				{ venvsDir: path.join(dir, "venvs"), settingsDir: dir, settingsPath, cacheDir: path.join(dir, "cache") },
			)
		}

		it("a named request confirms THAT entry (not the default name), says the other is registered, and records only on yes", async () => {
			await twoEnabled()
			const c = ctl()
			trustAnswers = [false]
			await c.runAction("trust", "aihydro-tools")
			expect(prompts).to.have.length(1)
			expect(prompts[0].name).to.equal("aihydro-tools")
			expect(prompts[0].note).to.contain("Another enabled AI-Hydro launcher is also registered: ai-hydro")
			expect((await readFirstPartyLauncher(dir))?.name).to.equal("ai-hydro") // declined: unchanged
			trustAnswers = [true]
			await c.runAction("trust", "aihydro-tools")
			expect(await readFirstPartyLauncher(dir)).to.include({ name: "aihydro-tools", command: mcp() })
		})

		it("an unnamed request with two candidates asks which, by exact command; dismissing records nothing and shows no modal", async () => {
			await twoEnabled()
			const c = ctl()
			chooseAnswer = undefined
			await c.runAction("trust")
			expect(chooseAsked).to.have.length(1)
			expect(chooseAsked[0].map((x) => x.name)).to.have.members(["ai-hydro", "aihydro-tools"])
			expect(chooseAsked[0].find((x) => x.name === "aihydro-tools")?.command).to.equal(mcp())
			expect(prompts).to.have.length(0)
			expect((await readFirstPartyLauncher(dir))?.name).to.equal("ai-hydro")
			chooseAnswer = "aihydro-tools"
			trustAnswers = [true]
			await c.runAction("trust")
			expect(prompts.map((p) => p.name)).to.deep.equal(["aihydro-tools"])
			expect((await readFirstPartyLauncher(dir))?.name).to.equal("aihydro-tools")
		})

		it("a chooser answer that is not a candidate is ignored", async () => {
			await twoEnabled()
			const c = ctl()
			chooseAnswer = "evil"
			await c.runAction("trust")
			expect(prompts).to.have.length(0)
		})

		it("the host re-validates a webview-supplied name: disabled, unknown and non-first-party names do nothing", async () => {
			makeVenv(machine, "2.8.2")
			await fs.writeFile(
				settingsPath,
				JSON.stringify({
					mcpServers: {
						"ai-hydro": { command: "/opt/old/aihydro-mcp", args: [], disabled: true },
						swat: { command: "/usr/bin/swat", args: [] },
						"aihydro-tools": { command: mcp(), args: [] },
					},
				}),
			)
			const c = ctl()
			trustAnswers = [true, true, true]
			for (const forged of ["ai-hydro", "swat", "nope"]) {
				await c.runAction("trust", forged)
			}
			expect(prompts).to.have.length(0)
			expect(await readFirstPartyLauncher(dir)).to.equal(undefined)
			expect(notices.length).to.equal(3)
		})
	})

	it("a failed install stays visible as 'failed', raises an error notice with Retry, and Retry works (no permanent dismiss)", async () => {
		machine.pipResult = { exitCode: 1, stderr: "Temporary failure in name resolution" }
		const c = controller()
		await c.startup()
		await settled(c)
		let s: ToolsEnvStatus = c.getStatus()
		expect(s.phase).to.equal("failed")
		expect(s.errorCode).to.equal("OFFLINE")
		expect(notices.some((n) => n.kind === "error" && n.actions.includes("Retry"))).to.equal(true)

		// A later session still shows it (nothing was dismissed). The half-created venv is "unhealthy" and is only
		// repaired by an explicit action, never automatically.
		const again = controller()
		await again.startup()
		await settled(again)
		expect(again.getStatus().phase).to.equal("unhealthy")

		machine.pipResult = { exitCode: 0, stderr: "" }
		await c.runAction("retry")
		s = c.getStatus()
		expect(s).to.include({ phase: "ready", healthy: true, trust: "trusted" })
	})

	it("no Python 3.10+: status is failed/NO_PYTHON with a message that names the setting", async () => {
		machine.pythons.clear()
		const c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus()).to.include({ phase: "failed", errorCode: "NO_PYTHON" })
		expect(c.getStatus().message).to.match(/aihydro\.tools\.pythonPath/)
	})

	it("cancelling the install ends in failed/CANCELLED (retryable), not ready", async () => {
		abortOnProgress = true
		machine.onPip = async (options) => {
			await new Promise((r) => setTimeout(r, 20))
			return options?.signal?.aborted ? { exitCode: null, stdout: "", stderr: "", aborted: true } : undefined
		}
		const c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus()).to.include({ phase: "failed", errorCode: "CANCELLED" })
		machine.onPip = undefined
		abortOnProgress = false
		await c.runAction("retry")
		expect(c.getStatus().phase).to.equal("ready")
	})

	it("an unhealthy venv is reported 'unhealthy' on a manual probe and Repair fixes it", async () => {
		makeVenv(machine, "2.8.2")
		machine.handshakeFailures.count = 1
		const c = controller()
		await c.refresh({ auto: false })
		expect(c.getStatus()).to.include({ phase: "unhealthy", healthy: false })
		expect(c.getStatus().message).to.match(/handshake/)
		await c.runAction("repair")
		expect(c.getStatus()).to.include({ phase: "ready", healthy: true })
	})

	it("a legacy custom launcher is left alone when the user keeps it, and the choice is remembered", async () => {
		makeVenv(machine, "2.8.2")
		machine.files.add("/usr/local/bin/aihydro-mcp")
		await fs.writeFile(
			settingsPath,
			JSON.stringify({ mcpServers: { "ai-hydro": { command: "/usr/local/bin/aihydro-mcp", args: [] } } }),
		)
		switchAnswer = "keep"
		const c = controller()
		await c.startup()
		await settled(c)
		expect(c.getStatus().phase).to.equal("custom")
		expect(state.keptLauncher).to.equal("/usr/local/bin/aihydro-mcp")
		expect((await readEntry("ai-hydro")).command).to.equal("/usr/local/bin/aihydro-mcp")
		// Next start does not ask again.
		switchAnswer = "switch"
		const next = controller()
		await next.startup()
		await settled(next)
		expect(next.getStatus().phase).to.equal("custom")
		expect((await readEntry("ai-hydro")).command).to.equal("/usr/local/bin/aihydro-mcp")
	})

	it("switching a legacy launcher rewrites the command and still needs trust confirmation", async () => {
		makeVenv(machine, "2.8.2")
		machine.files.add("/usr/local/bin/aihydro-mcp")
		await recordFirstPartyLauncher(dir, { name: "ai-hydro", command: "/usr/local/bin/aihydro-mcp", args: [] })
		await fs.writeFile(
			settingsPath,
			JSON.stringify({ mcpServers: { "ai-hydro": { command: "/usr/local/bin/aihydro-mcp", args: [] } } }),
		)
		trustAnswers = [false] // the legacy reconcile at startup asks nothing (same launcher); only the switch asks
		const c = controller()
		await c.startup()
		await settled(c)
		expect((await readEntry("ai-hydro")).command).to.equal(mcp())
		expect(trustAsked).to.equal(1)
		expect(c.getStatus()).to.include({ phase: "ready", trust: "untrusted" })
		expect(notices.some((n) => /managed environment/.test(n.message))).to.equal(true)
	})

	it("diagnostics name interpreter, venv path, version, server command and trust verdict", async () => {
		const c = controller()
		await c.startup()
		await settled(c)
		const d = c.diagnostics()
		expect(d).to.match(/Tools version: 2\.8\.2/)
		expect(d).to.include(`Venv path: ${venv}`)
		expect(d).to.include(`Server command: ${mcp()}`)
		expect(d).to.match(/Interpreter: .*bin\/python/)
		expect(d).to.match(/Trust: trusted/)
		expect(d).to.match(/Extension build: 0\.0\.0-test/)
	})

	it("malformed MCP settings are reported and left untouched", async () => {
		await fs.writeFile(settingsPath, "{ bad")
		const c = controller()
		await c.startup()
		expect(c.getStatus()).to.include({ phase: "failed", errorCode: "SETTINGS_UNREADABLE" })
		expect(await fs.readFile(settingsPath, "utf-8")).to.equal("{ bad")
	})
})
