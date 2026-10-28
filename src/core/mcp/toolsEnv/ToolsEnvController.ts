/**
 * Owns the managed tools environment's state (X0-3): probes it, installs/repairs it with cancellable progress,
 * registers its `aihydro-mcp` as the first-party server, reconciles the trust record, and publishes one
 * `ToolsEnvStatus` to every surface (Welcome and sidebar chip, status bar, About diagnostics).
 *
 * There is no permanent dismissal: a failed install leaves phase "failed" with Retry until it succeeds.
 * Host-neutral: all UI and configuration go through `ToolsEnvHost`; all machine access through `ToolsEnvDeps`.
 */
import {
	emptyToolsEnvStatus,
	formatToolsDiagnostics,
	MANAGED_VENV_NAME,
	TOOLS_REQUIREMENT,
	type ToolsEnvAction,
	type ToolsEnvStatus,
	venvMcpPath,
	venvPythonPath,
	versionMeetsFloor,
} from "@shared/aihydro/toolsEnv"
import { launchContextHash, looksLikeFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import * as path from "path"
import { loadFirstPartyLauncher, readFirstPartyLauncher } from "../firstPartyLauncher"
import { defaultPythonNames, ensureToolsEnv, probeToolsEnv, type ToolsEnvDeps } from "./managedVenv"
import {
	classifyLauncher,
	findFirstPartyEntryName,
	type LauncherClass,
	readMcpSettings,
	readTrustSnapshot,
	registerManagedLauncher,
	reconcileLauncherRecord,
} from "./launcherRegistration"

export interface ToolsEnvConfig {
	/** `aihydro.tools.venvPath`; empty means `<aihydro_home>/venvs/tools-2.8`. */
	venvPath: string
	/** Interpreters to try first, in order (settings). */
	pythonPaths: string[]
	/** `aihydro.tools.autoInstall`: allow the one consented first install without a click. Default true. */
	autoInstall: boolean
}

/** Small per-machine state kept next to the first-party launcher record (settings dir). */
export interface ToolsEnvPersisted {
	/** The launcher command the user chose to keep instead of the managed one. */
	keptLauncher?: string
	/** The user agreed to the first network install (PyPI) into the default venv. */
	installConsent?: boolean
	/** A first-party launcher record has been written on this machine before. */
	recordExisted?: boolean
}

export interface TrustPrompt {
	name: string
	command: string
	args: string[]
}

export interface ToolsEnvHost {
	getConfig(): ToolsEnvConfig
	/** Run `task` under a cancellable progress notification; `signal` aborts when the user cancels. */
	withProgress<T>(title: string, task: (report: (step: string) => void, signal: AbortSignal) => Promise<T>): Promise<T>
	/** Modal: "Trust this launcher" vs dismiss. The only path that rewrites an existing record. */
	confirmTrust(launcher: TrustPrompt, recorded: { command: string; args: string[] } | undefined): Promise<boolean>
	/** Non-modal choice between switching the legacy launcher to the managed one and keeping it. undefined = ignored. */
	askSwitch(currentCommand: string, managedCommand: string): Promise<"switch" | "keep" | undefined>
	/** Surface a result; resolves with the clicked action label, if any. */
	notify(kind: "info" | "error", message: string, actions: string[]): Promise<string | undefined>
	showLog(): void
	copyText(text: string): Promise<void>
	readState(): Promise<ToolsEnvPersisted>
	writeState(patch: Partial<ToolsEnvPersisted>): Promise<void>
	/** One-time consent before the first network install: names PyPI, the approximate size and the venv path. */
	confirmInstall(info: { venvPath: string; requirement: string }): Promise<boolean>
	/** Confirmation before recreating the default managed venv whose interpreter file has gone missing. */
	confirmRecreate(venvPath: string): Promise<boolean>
	extensionVersion(): string
}

export interface ToolsEnvPaths {
	/** `<aihydro_home>/venvs` */
	venvsDir: string
	settingsDir: string
	settingsPath: string
	cacheDir: string
}

export class ToolsEnvController {
	private status: ToolsEnvStatus
	private listeners = new Set<(s: ToolsEnvStatus) => void>()
	private running: Promise<void> | undefined
	/** Launchers the user declined to trust this session, so one start never shows the same modal twice. */
	private declined = new Set<string>()
	private abort: AbortController | undefined

	constructor(
		private readonly host: ToolsEnvHost,
		private readonly deps: ToolsEnvDeps,
		private readonly paths: ToolsEnvPaths,
	) {
		this.status = emptyToolsEnvStatus({ venvPath: this.venvDir(), requirement: TOOLS_REQUIREMENT })
	}

	// ── State ───────────────────────────────────────────────────────────────

	getStatus(): ToolsEnvStatus {
		return this.status
	}

	onDidChange(listener: (s: ToolsEnvStatus) => void): { dispose(): void } {
		this.listeners.add(listener)
		return { dispose: () => this.listeners.delete(listener) }
	}

	diagnostics(): string {
		return formatToolsDiagnostics(this.status, this.host.extensionVersion())
	}

	private setStatus(patch: Partial<ToolsEnvStatus>): void {
		this.status = { ...this.status, ...patch }
		for (const listener of [...this.listeners]) {
			try {
				listener(this.status)
			} catch (error) {
				console.error("[AI-Hydro] tools status listener failed:", error)
			}
		}
	}

	venvDir(): string {
		const configured = this.host.getConfig().venvPath.trim()
		return configured || path.join(this.paths.venvsDir, MANAGED_VENV_NAME)
	}

	private managedCommand(): string {
		return venvMcpPath(this.venvDir(), this.deps.platform)
	}

	private pythonCandidates(): string[] {
		return [
			...this.host
				.getConfig()
				.pythonPaths.map((p) => p.trim())
				.filter(Boolean),
			...defaultPythonNames(this.deps.platform),
		]
	}

	// ── Entry points ────────────────────────────────────────────────────────

	/**
	 * Activation: register the managed launcher right away when the environment is already on disk (so the MCP hub
	 * starts it), then verify health or, unless `autoInstall` is false (test hosts), install in the background. Resolves after the quick part; the slow part
	 * continues and is observable through `onDidChange`.
	 */
	async startup(options: { autoInstall?: boolean } = {}): Promise<void> {
		const autoInstall = options.autoInstall ?? true
		await loadFirstPartyLauncher(this.paths.settingsDir) // install the recorded anchor before anything can decline
		const venv = this.venvDir()
		this.setStatus({ venvPath: venv, interpreterPath: "", serverCommand: this.managedCommand() })
		const settings = await readMcpSettings(this.paths.settingsPath)
		if (!settings.ok) {
			this.setStatus({ phase: "failed", errorCode: "SETTINGS_UNREADABLE", message: settings.error, healthy: false })
			return
		}
		const name = findFirstPartyEntryName(settings.config.mcpServers)
		const entry = name ? settings.config.mcpServers[name] : undefined
		const cls = await classifyLauncher(entry, this.managedCommand(), this.deps)
		await this.noticeMissingRecord()
		const onDisk =
			(await this.deps.pathExists(venvPythonPath(venv, this.deps.platform))) &&
			(await this.deps.pathExists(this.managedCommand()))
		if (entry && cls !== "managed" && cls !== "custom-broken") {
			// A launcher the user (or an older version) registered. Keep the existing trust behaviour for it.
			await this.reconcileExisting(name as string, entry)
		}
		if (onDisk && (cls === "none" || cls === "managed" || cls === "custom-broken")) {
			await this.register(false)
		}
		await this.refreshTrust()
		void this.refresh({ auto: autoInstall && (cls === "none" || cls === "managed" || cls === "custom-broken"), cls })
	}

	/** Re-probe (and, when `auto`, install if needed). Safe to call repeatedly: a second call joins the running one. */
	refresh(options: { auto: boolean; cls?: LauncherClass } = { auto: false }): Promise<void> {
		return this.runExclusive(() => this.refreshInner(options))
	}

	private async refreshInner(options: { auto: boolean; cls?: LauncherClass }): Promise<void> {
		this.setStatus({ phase: "checking", message: "Checking the tools environment", errorCode: "" })
		const probe = await probeToolsEnv(this.deps, this.venvDir())
		if (probe.healthy) {
			this.setStatus({ interpreterPath: venvPythonPath(this.venvDir(), this.deps.platform), version: probe.version })
			await this.adopt(probe.version, options.cls)
			return
		}
		if (options.cls === "custom-working") {
			this.setStatus({ phase: "custom", healthy: false, message: "" })
			return
		}
		this.setStatus({
			phase: probe.venvExists && probe.pythonExists ? "unhealthy" : "missing",
			healthy: false,
			version: probe.version,
			message: probe.error ?? "",
		})
		await this.refreshTrust()
		// Automatic install is limited to a fresh, missing default venv, with the user's one-time consent. An existing but
		// unhealthy environment is never touched without an explicit Repair.
		if (options.auto && !probe.venvExists && (await this.mayAutoInstall())) {
			await this.doInstall({ repair: false })
		}
	}

	private async mayAutoInstall(): Promise<boolean> {
		const config = this.host.getConfig()
		if (!config.autoInstall || config.venvPath.trim()) {
			return false
		}
		const state = await this.host.readState()
		if (state.installConsent) {
			return true
		}
		const yes = await this.host.confirmInstall({ venvPath: this.venvDir(), requirement: TOOLS_REQUIREMENT })
		if (yes) {
			await this.host.writeState({ installConsent: true })
		}
		return yes
	}

	private async adopt(version: string, cls: LauncherClass | undefined): Promise<void> {
		// Below the pinned floor: report it; the upgrade within ~=2.8.2 is the user's Repair, not automatic.
		if (!versionMeetsFloor(version)) {
			this.setStatus({
				phase: "unhealthy",
				healthy: false,
				version,
				message: `aihydro-tools ${version} is older than the pinned 2.8.2. Choose Repair to upgrade within ~=2.8.2.`,
			})
			await this.refreshTrust()
			return
		}
		await this.finishReady(version, cls)
	}

	private async finishReady(version: string, cls: LauncherClass | undefined): Promise<void> {
		const settings = await readMcpSettings(this.paths.settingsPath)
		const name = settings.ok ? findFirstPartyEntryName(settings.config.mcpServers) : undefined
		const entry = name && settings.ok ? settings.config.mcpServers[name] : undefined
		const current = cls ?? (await classifyLauncher(entry, this.managedCommand(), this.deps))
		let switchExisting = false
		if (current === "custom-working") {
			const kept = (await this.host.readState()).keptLauncher
			const command = typeof entry?.command === "string" ? entry.command : ""
			if (kept !== undefined && kept === command) {
				this.setStatus({ phase: "custom", healthy: true, version })
				await this.refreshTrust()
				return
			}
			const choice = await this.host.askSwitch(command, this.managedCommand())
			if (choice === "keep") {
				await this.host.writeState({ keptLauncher: command })
				this.setStatus({ phase: "custom", healthy: true, version })
				await this.refreshTrust()
				return
			}
			if (choice !== "switch") {
				this.setStatus({ phase: "custom", healthy: true, version })
				await this.refreshTrust()
				return
			}
			switchExisting = true
		}
		try {
			const registration = await this.register(switchExisting)
			if (registration?.switchedFrom) {
				void this.host.notify(
					"info",
					`AI-Hydro now launches its tools from the managed environment (${this.venvDir()}). It replaced \`${registration.switchedFrom}\`. PYTHONPATH and PYTHONHOME entries were removed from the server's environment.`,
					[],
				)
			}
		} catch (error) {
			this.setStatus({
				phase: "failed",
				healthy: false,
				errorCode: "SETTINGS_UNREADABLE",
				message: error instanceof Error ? error.message : String(error),
			})
			return
		}
		await this.host.writeState({ keptLauncher: undefined })
		this.setStatus({
			phase: "ready",
			healthy: true,
			version,
			message: "",
			errorCode: "",
			interpreterPath: venvPythonPath(this.venvDir(), this.deps.platform),
		})
		await this.refreshTrust()
	}

	/** Install, upgrade or repair. Single-flight: a second call joins the running one. */
	install(options: { repair: boolean }): Promise<void> {
		return this.runExclusive(() => this.doInstall(options))
	}

	private runExclusive(fn: () => Promise<void>): Promise<void> {
		if (this.running) {
			return this.running
		}
		const p = fn().finally(() => {
			this.running = undefined
			this.abort = undefined
		})
		this.running = p
		return p
	}

	private async doInstall(options: { repair: boolean }): Promise<void> {
		const venv = this.venvDir()
		this.abort = new AbortController()
		const signal = this.abort.signal
		this.setStatus({ phase: "installing", healthy: false, message: "Starting", errorCode: "", venvPath: venv })
		this.deps.log(`[install] ${options.repair ? "repair" : "install"} ${TOOLS_REQUIREMENT} in ${venv}`)
		const result = await this.host.withProgress(
			"AI-Hydro: setting up the tools environment",
			async (report, progressSignal) => {
				progressSignal.addEventListener("abort", () => this.abort?.abort(), { once: true })
				return ensureToolsEnv(this.deps, {
					venvDir: venv,
					isDefaultDir: !this.host.getConfig().venvPath.trim(),
					confirmRecreate: () => this.host.confirmRecreate(venv),
					pythonCandidates: this.pythonCandidates(),
					signal,
					repair: options.repair,
					onStep: (step) => {
						report(step)
						this.setStatus({ message: step })
					},
				})
			},
		)
		const base = { basePython: result.basePython, interpreterPath: venvPythonPath(venv, this.deps.platform) }
		if (result.outcome === "cancelled") {
			this.setStatus({
				...base,
				phase: "failed",
				healthy: false,
				errorCode: "CANCELLED",
				message: "The install was cancelled. Choose Retry to continue.",
			})
			await this.refreshTrust()
			return
		}
		if (result.outcome === "failed") {
			this.setStatus({
				...base,
				phase: result.probe.importOk ? "unhealthy" : "failed",
				healthy: false,
				version: result.probe.version,
				errorCode: result.errorCode ?? "UNHEALTHY",
				message: result.message ?? "",
			})
			await this.refreshTrust()
			void this.host
				.notify("error", `AI-Hydro could not set up its tools: ${result.message ?? "unknown error"}`, [
					"Retry",
					"Show log",
				])
				.then((choice) => {
					if (choice === "Retry") {
						void this.install({ repair: false })
					} else if (choice === "Show log") {
						this.host.showLog()
					}
				})
			return
		}
		this.setStatus(base)
		await this.finishReady(result.probe.version, undefined)
	}

	cancel(): void {
		this.abort?.abort()
	}

	/** Actions the chip, status bar and commands dispatch. */
	async runAction(action: ToolsEnvAction): Promise<void> {
		switch (action) {
			case "install":
			case "retry":
				await this.install({ repair: false })
				return
			case "repair":
				await this.install({ repair: true })
				return
			case "cancel":
				this.cancel()
				return
			case "showLog":
				this.host.showLog()
				return
			case "copyDiagnostics":
				await this.host.copyText(this.diagnostics())
				return
			case "trust":
				await this.trustCurrent()
				return
			case "useManaged":
				await this.host.writeState({ keptLauncher: undefined })
				await this.install({ repair: false })
				return
		}
	}

	// ── Trust ───────────────────────────────────────────────────────────────

	/** The explicit "Trust this launcher" path: shows the confirmation again and records only on yes. */
	async trustCurrent(): Promise<void> {
		this.declined.clear() // an explicit request: ask again
		const settings = await readMcpSettings(this.paths.settingsPath)
		if (!settings.ok) {
			return
		}
		const name = findFirstPartyEntryName(settings.config.mcpServers)
		const entry = name ? settings.config.mcpServers[name] : undefined
		if (!name || !entry) {
			return
		}
		await this.reconcileExisting(name, entry, true)
		await this.refreshTrust()
	}

	private async reconcileExisting(name: string, entry: Record<string, unknown>, forceConfirm = false): Promise<void> {
		const args = Array.isArray(entry.args) ? (entry.args as unknown[]).filter((a): a is string => typeof a === "string") : []
		const command = typeof entry.command === "string" ? entry.command : ""
		if (!looksLikeFirstPartyLauncher(command, args)) {
			// Not recorded and not trusted: say so instead of silently losing claim-approval prompts.
			void this.host.notify(
				"info",
				`The "${name}" MCP server uses a non-standard launcher (\`${[command, ...args].join(" ")}\`), so AI-Hydro does not treat it as the first-party server: claim-approval prompts and read-only subagent tools are off for it. To restore them, register the standard \`aihydro-mcp\` or \`python -m ai_hydro.mcp\` launcher.`,
				[],
			)
			return
		}
		const state = await this.host.readState()
		const outcome = await reconcileLauncherRecord(
			this.paths.settingsDir,
			{ name, command, args, launchHash: launchContextHash({ env: entry.env, cwd: entry.cwd }) },
			(launcher, recorded) => this.confirmTrustOnce(launcher, recorded),
			{ forceConfirm, recordExisted: state.recordExisted },
		)
		await this.markRecord(outcome)
	}

	private async markRecord(outcome: string): Promise<void> {
		if (outcome === "recorded" || outcome === "confirmed" || outcome === "unchanged") {
			if (!(await this.host.readState()).recordExisted) {
				await this.host.writeState({ recordExisted: true })
			}
		}
	}

	/** A record that existed before is gone: say so and ask again instead of silently re-trusting. */
	private async noticeMissingRecord(): Promise<void> {
		const state = await this.host.readState()
		if (state.recordExisted && !(await readFirstPartyLauncher(this.paths.settingsDir))) {
			this.deps.log("[trust] the first-party launcher record is missing; it will not be re-recorded without confirmation")
			void this.host.notify(
				"info",
				"AI-Hydro's record of the first-party tools launcher is missing. The registered launcher is not trusted until you confirm it (Trust this launcher).",
				[],
			)
		}
	}

	private async confirmTrustOnce(
		launcher: TrustPrompt,
		recorded: { command: string; args: string[] } | undefined,
	): Promise<boolean> {
		const key = JSON.stringify([launcher.name, launcher.command, launcher.args])
		if (this.declined.has(key)) {
			return false
		}
		const yes = await this.host.confirmTrust(launcher, recorded)
		if (!yes) {
			this.declined.add(key)
		}
		return yes
	}

	private async register(switchExisting: boolean) {
		const state = await this.host.readState()
		this.deps.log(`[register] managed launcher ${this.managedCommand()}`)
		const registration = await registerManagedLauncher({
			recordExisted: state.recordExisted,
			settingsDir: this.paths.settingsDir,
			settingsPath: this.paths.settingsPath,
			managedCommand: this.managedCommand(),
			cacheDir: this.paths.cacheDir,
			switchExisting,
			confirmTrust: (launcher, recorded) => this.confirmTrustOnce(launcher, recorded),
		})
		await this.markRecord(registration.record)
		return registration
	}

	private async refreshTrust(): Promise<void> {
		const snap = await readTrustSnapshot(this.paths.settingsDir, this.paths.settingsPath)
		const reason =
			snap.trust === "untrusted" && snap.reason.startsWith("Not trusted: its launch command differs")
				? 'The registered launcher differs from the one AI-Hydro recorded. Choose "Trust this launcher" to review the change.'
				: snap.reason
		this.setStatus({
			serverName: snap.serverName,
			serverCommand: snap.serverCommand || this.status.serverCommand,
			trust: snap.trust,
			trustReason: reason,
		})
	}
}
