import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import * as readline from "node:readline"
import * as vscode from "vscode"
import { type CellProvenanceRecord, hashCode, hashOutputs, mapResultStatus, writeCellProvenance } from "./artifactProvenance"
import {
	discoverPythonEnvironments,
	getWorkspaceFolderPath,
	getWorkspaceKey,
	isWorkspaceDerived,
	pickDefaultProfile,
} from "./discoverPythonEnvironments"
import type { KernelProfile } from "./KernelProfile"
import { buildSessionKeyForArtifact } from "./kernelSessionKey"
import { scrubKernelEnv } from "./scrubKernelEnv"

export type ArtifactKernelState = "stopped" | "starting" | "ready" | "busy" | "error"

export interface ArtifactKernelInfo {
	artifactId: string
	profileId: string
	label: string
	interpreterPath: string
	state: ArtifactKernelState
	cwd: string
	lastError: string
	pythonVersion: string
	packagesProbe: string
	kernelDirty: boolean
	executionCount: number
}

export interface RunArtifactCodeResult {
	stdout: string
	stderr: string
	status: "ok" | "error" | "denied" | "timeout" | "interrupted"
	error: string
	resultRepr: string
	imagesPngBase64: string[]
	videosMp4Base64: string[]
	truncated: boolean
	provenanceId?: string
}

/** One execute() call from arrival until it settles, so Stop can cancel runs that have not started. */
interface RunTicket {
	cancelled: boolean
	started: boolean
	done: Promise<void>
}

/** Kill a kernel and anything it spawned (subprocess.Popen children, multiprocessing workers). */
function killProcessTree(child: ChildProcessWithoutNullStreams, hard: boolean): void {
	const pid = child.pid
	try {
		if (pid !== undefined && process.platform === "win32") {
			// /T walks the tree, /F because a hung kernel will not honour a polite request.
			spawn("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true }).on("error", () => {
				child.kill()
			})
			return
		}
		if (pid !== undefined) {
			// The kernel leads its own process group (spawned detached), so -pid reaches the whole tree.
			process.kill(-pid, hard ? "SIGKILL" : "SIGTERM")
			return
		}
	} catch {
		// fall through to the single-process kill
	}
	try {
		child.kill(hard ? "SIGKILL" : undefined)
	} catch {
		// already gone
	}
}

/** The exec currently running in a kernel (at most one: execution is serialised per session). */
interface ActiveExec {
	id: string
	/** Why an interrupt was requested; the first cause wins. */
	cause?: "user" | "timeout"
	interruptSent: boolean
	graceTimer?: NodeJS.Timeout
	/** How the exec ended, set exactly once before `done` resolves. */
	outcome?: "completed" | "interrupted" | "restarted" | "failed"
	done: Promise<void>
	markDone: () => void
}

interface KernelSession {
	sessionKey: string
	artifactId: string
	/** One namespace shared by every artifact (aihydro.htmlPreview.shareKernelAcrossArtifacts). */
	shared: boolean
	profile: KernelProfile
	process: ChildProcessWithoutNullStreams
	rl: readline.Interface
	state: ArtifactKernelState
	lastError: string
	pythonVersion: string
	executionsSinceRestart: number
	pending: Map<
		string,
		{
			resolve: (r: RunArtifactCodeResult) => void
			reject: (e: Error) => void
			timer: NodeJS.Timeout
		}
	>
	nextId: number
	current?: ActiveExec
	/** Set before we deliberately end the process, so the exit handler stays quiet. */
	stopping: boolean
	/** Cells executed in this process (any outcome); non-zero means variables may exist. */
	execCount: number
	/** sha256 of the sorted installed-distribution list, once the kernel has reported it. */
	packagesDigest: string
}

function getTimeoutMs(): number {
	const seconds = vscode.workspace.getConfiguration("aihydro.htmlPreview").get<number>("pythonTimeoutSeconds", 120)
	const clamped = Math.min(600, Math.max(30, seconds))
	return clamped * 1000
}

const MAX_OUTPUT_CHARS = 50_000
/**
 * How long the kernel gets to confirm an interrupt before we give up on it and
 * restart the process.  A pure-Python loop answers in milliseconds; this only
 * runs out for code stuck in a native call (or one that swallows KeyboardInterrupt).
 */
export const INTERRUPT_GRACE_MS = 5_000

const PROBE_CODE = `import json, sys
pkgs = ["numpy", "pandas", "rasterio", "matplotlib"]
missing = []
for p in pkgs:
    try:
        __import__(p)
    except ImportError:
        missing.append(p)
print(json.dumps({"ok": missing == [], "missing": missing, "python": sys.version}))`

function getRunnerScriptPath(extensionPath: string): string {
	return path.join(extensionPath, "dist", "services", "artifact-preview", "artifact_kernel_runner.py")
}

function truncateOutput(text: string): { text: string; truncated: boolean } {
	if (text.length <= MAX_OUTPUT_CHARS) {
		return { text, truncated: false }
	}
	return { text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated]`, truncated: true }
}

export class ArtifactKernelService {
	private readonly sessions = new Map<string, KernelSession>()
	private readonly activeProfileByWorkspace = new Map<string, string>()
	/** Per-session tail of the execution chain; cells run one at a time, in arrival order. */
	private readonly execChains = new Map<string, Promise<void>>()
	/** Sessions whose kernel died while idle after running cells: tell the learner on the next run. */
	private readonly lostState = new Map<string, string>()
	/** Runs from arrival to settlement, per session; lets Stop cancel runs still waiting or starting up. */
	private readonly tickets = new Map<string, Set<RunTicket>>()
	/** Overridable so tests can exercise the give-up path without waiting seconds. */
	interruptGraceMs = INTERRUPT_GRACE_MS
	private readonly outputChannel = vscode.window.createOutputChannel("AI-Hydro Studio")

	constructor(private readonly context: vscode.ExtensionContext) {}

	// Only an interpreter the user explicitly picked is persisted here (the old
	// `activeProfile` key also held auto-selected defaults, including workspace venvs).
	private profileStateKey(workspaceKey: string): string {
		return `aihydro.htmlPreview.selectedProfile.${workspaceKey}`
	}

	private loadPersistedProfile(workspaceKey: string): string {
		return this.context.globalState.get<string>(this.profileStateKey(workspaceKey)) ?? ""
	}

	private persistActiveProfile(workspaceKey: string, profileId: string): void {
		void this.context.globalState.update(this.profileStateKey(workspaceKey), profileId)
	}

	dispose(): void {
		for (const key of [...this.sessions.keys()]) {
			this.stopKernel(key)
		}
	}

	private explicitProfileId(workspaceKey: string): string {
		return this.activeProfileByWorkspace.get(workspaceKey) ?? this.loadPersistedProfile(workspaceKey)
	}

	async listEnvironments(): Promise<{ environments: KernelProfile[]; activeProfileId: string }> {
		const environments = await discoverPythonEnvironments()
		const workspaceKey = getWorkspaceKey()
		const explicit = this.explicitProfileId(workspaceKey)
		if (explicit && environments.some((e) => e.id === explicit)) {
			return { environments, activeProfileId: explicit }
		}
		// No (valid) explicit choice: show the safe default without persisting it.
		return { environments, activeProfileId: pickDefaultProfile(environments)?.id ?? "" }
	}

	/** An explicit user selection (kernel picker). The only way a workspace interpreter can run. */
	setActiveProfile(profileId: string): void {
		const workspaceKey = getWorkspaceKey()
		this.activeProfileByWorkspace.set(workspaceKey, profileId)
		this.persistActiveProfile(workspaceKey, profileId)
	}

	getActiveProfileId(): string {
		return this.explicitProfileId(getWorkspaceKey())
	}

	async resolveProfile(profileId?: string): Promise<KernelProfile> {
		const { environments, activeProfileId } = await this.listEnvironments()
		const id = profileId?.trim() || activeProfileId
		const found = environments.find((e) => e.id === id)
		if (found) {
			if (isWorkspaceDerived(found) && found.id !== this.explicitProfileId(getWorkspaceKey())) {
				throw new Error(
					`"${found.label}" comes from the workspace, so it only runs if you select it in the kernel picker. Pick it there, or set aihydro.htmlPreview.pythonInterpreter.`,
				)
			}
			return found
		}
		const fallback = pickDefaultProfile(environments)
		if (!fallback) {
			throw new Error(
				"No Python interpreter found. Set aihydro.htmlPreview.pythonInterpreter, or select an interpreter in the kernel picker.",
			)
		}
		return fallback
	}

	private resolveSessionKey(artifactId: string, profileId?: string): string {
		const aid = artifactId.trim()
		if (!aid) {
			throw new Error("artifact_id is required for kernel operations")
		}
		const profile = profileId?.trim() || this.getActiveProfileId()
		if (!profile) {
			throw new Error("No active Python profile. Select a kernel in the AI-Hydro Studio toolbar.")
		}
		return buildSessionKeyForArtifact(aid, profile)
	}

	getInfo(artifactId: string, profileId?: string): ArtifactKernelInfo | null {
		const aid = artifactId.trim()
		if (!aid) {
			return null
		}
		const pid = profileId?.trim() || this.getActiveProfileId()
		const sessionKey = pid ? buildSessionKeyForArtifact(aid, pid) : ""
		const session = sessionKey ? this.sessions.get(sessionKey) : undefined
		if (session) {
			return this.sessionToInfo(session)
		}
		return null
	}

	getInfoOrDefault(artifactId: string, profileId?: string): Promise<ArtifactKernelInfo> {
		const existing = this.getInfo(artifactId, profileId)
		if (existing) {
			return Promise.resolve(existing)
		}
		return this.resolveProfile(profileId).then((profile) => ({
			artifactId: artifactId.trim(),
			profileId: profile.id,
			label: profile.label,
			interpreterPath: profile.interpreterPath,
			state: "stopped" as const,
			cwd: profile.cwd,
			lastError: "",
			pythonVersion: "",
			packagesProbe: "",
			kernelDirty: false,
			executionCount: 0,
		}))
	}

	restartKernel(artifactId: string, profileId?: string): void {
		const sessionKey = this.resolveSessionKey(artifactId, profileId)
		this.stopKernel(sessionKey)
	}

	stopSessionsForArtifact(artifactId: string): void {
		const aid = artifactId.trim()
		for (const [key, session] of this.sessions) {
			if (session.artifactId === aid) {
				this.stopKernel(key)
			}
		}
	}

	/**
	 * A shared kernel holds state from every artifact that ran in it, so revoking any one
	 * document must not leave that namespace (and whatever it started) running.
	 */
	stopSharedSessions(): void {
		for (const [key, session] of this.sessions) {
			if (session.shared) {
				this.stopKernel(key)
			}
		}
	}

	stopKernel(sessionKey: string, hard = false): void {
		const session = this.sessions.get(sessionKey)
		if (!session) {
			return
		}
		session.stopping = true
		this.lostState.delete(sessionKey)
		if (session.current?.graceTimer) {
			clearTimeout(session.current.graceTimer)
		}
		for (const pending of session.pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(new Error("The kernel was restarted while this cell was running. Variables were cleared."))
		}
		session.pending.clear()
		session.rl.close()
		killProcessTree(session.process, hard)
		this.sessions.delete(sessionKey)
	}

	/**
	 * Ask the kernel to stop the running cell and wait for the real outcome.
	 *
	 * The interrupt is in-band (a protocol message), so it works the same on
	 * every platform, including Windows where a signal cannot be delivered
	 * without killing the process.  `recovered` is true only when the kernel
	 * itself confirmed the stop (variables kept) or had nothing running; if it
	 * does not confirm within INTERRUPT_GRACE_MS the process is restarted and
	 * `recovered` is false.  The cell's own result carries the same outcome.
	 */
	async interruptKernel(artifactId: string, profileId?: string): Promise<{ recovered: boolean; error?: string }> {
		const sessionKey = this.resolveSessionKey(artifactId, profileId)
		const session = this.sessions.get(sessionKey)
		// Runs that have not started (queued behind another, or waiting for the kernel to
		// spawn) are cancelled so they never execute after Stop.
		const waiting = [...(this.tickets.get(sessionKey) ?? [])].filter((t) => !t.started)
		for (const ticket of waiting) {
			ticket.cancelled = true
		}
		const exec = session?.current
		if (session && exec) {
			this.beginInterrupt(session, exec, "user")
			await exec.done
		}
		await Promise.all(waiting.map((t) => t.done))
		if (exec?.outcome === "restarted") {
			return {
				recovered: false,
				error: "The running code did not stop, so the kernel was restarted. Kernel restarted: variables were cleared.",
			}
		}
		if (exec?.outcome === "failed") {
			return { recovered: false, error: "The kernel exited while it was being interrupted. Variables were cleared." }
		}
		return { recovered: true }
	}

	/** Send the in-band interrupt once and arm the give-up timer. */
	private beginInterrupt(session: KernelSession, exec: ActiveExec, cause: "user" | "timeout"): void {
		exec.cause ??= cause
		if (exec.interruptSent) {
			return
		}
		exec.interruptSent = true
		try {
			session.process.stdin.write(`${JSON.stringify({ op: "interrupt", target: exec.id })}\n`)
		} catch {
			// the grace timer below reports the outcome
		}
		exec.graceTimer = setTimeout(() => this.forceRestart(session, exec), this.interruptGraceMs)
	}

	/** The kernel did not confirm an interrupt: end it, and say so in the cell's result. */
	private forceRestart(session: KernelSession, exec: ActiveExec): void {
		const pending = session.pending.get(exec.id)
		if (!pending || session.current !== exec) {
			return
		}
		clearTimeout(pending.timer)
		session.pending.delete(exec.id)
		exec.outcome = "restarted"
		const lead =
			exec.cause === "timeout"
				? "Execution timed out and the running code did not respond to the interrupt"
				: "The running code did not respond to the interrupt"
		pending.resolve({
			stdout: "",
			stderr: "",
			status: exec.cause === "timeout" ? "timeout" : "error",
			error: `${lead} within ${this.interruptGraceMs / 1000}s, so the kernel was restarted. Kernel restarted: variables were cleared.`,
			resultRepr: "",
			imagesPngBase64: [],
			videosMp4Base64: [],
			truncated: false,
		})
		this.stopKernel(session.sessionKey, true)
	}

	async execute(
		code: string,
		artifactId: string,
		profileId?: string,
		timeoutMs?: number,
		cellId?: string,
	): Promise<RunArtifactCodeResult> {
		const profile = await this.resolveProfile(profileId)
		const sessionKey = buildSessionKeyForArtifact(artifactId, profile.id)
		// Cells for one kernel run strictly one at a time, in arrival order.  The
		// timeout clock therefore starts when a cell starts, not while it waits.
		const previous = this.execChains.get(sessionKey) ?? Promise.resolve()
		const ticket: RunTicket = { cancelled: false, started: false, done: Promise.resolve() }
		const tickets = this.tickets.get(sessionKey) ?? new Set<RunTicket>()
		tickets.add(ticket)
		this.tickets.set(sessionKey, tickets)
		const run = previous.then(() => this.executeSerialized(code, artifactId, profile, ticket, timeoutMs, cellId))
		ticket.done = run.then(
			() => undefined,
			() => undefined,
		)
		void ticket.done.then(() => {
			tickets.delete(ticket)
			if (tickets.size === 0 && this.tickets.get(sessionKey) === tickets) {
				this.tickets.delete(sessionKey)
			}
		})
		const tail = run.then(
			() => undefined,
			() => undefined,
		)
		this.execChains.set(sessionKey, tail)
		void tail.then(() => {
			if (this.execChains.get(sessionKey) === tail) {
				this.execChains.delete(sessionKey)
			}
		})
		return run
	}

	private async executeSerialized(
		code: string,
		artifactId: string,
		profile: KernelProfile,
		ticket: RunTicket,
		timeoutMs?: number,
		cellId?: string,
	): Promise<RunArtifactCodeResult> {
		const sessionKey = buildSessionKeyForArtifact(artifactId, profile.id)
		const cancelledResult = (): RunArtifactCodeResult => ({
			stdout: "",
			stderr: "",
			status: "interrupted",
			error: "Cancelled: Stop was pressed before this cell started.",
			resultRepr: "",
			imagesPngBase64: [],
			videosMp4Base64: [],
			truncated: false,
		})
		if (ticket.cancelled) {
			return cancelledResult()
		}
		const session = await this.ensureSession(artifactId, profile)
		if (ticket.cancelled) {
			return cancelledResult()
		}
		ticket.started = true
		// A kernel that died while idle took the learner's variables with it;
		// ensureSession() has just replaced it, so say so on this run.
		const lostReason = this.lostState.get(sessionKey)
		this.lostState.delete(sessionKey)
		const id = `exec_${session.nextId++}`
		const effectiveTimeout = timeoutMs ?? getTimeoutMs()
		const startedAt = new Date().toISOString()
		const startMs = Date.now()

		this.outputChannel.appendLine(
			`[${profile.label}][${artifactId}] Executing Python (${code.split("\n").length} lines) cwd=${session.profile.cwd}`,
		)

		let markDone = () => {}
		const exec: ActiveExec = {
			id,
			interruptSent: false,
			done: new Promise<void>((resolve) => {
				markDone = resolve
			}),
			markDone: () => markDone(),
		}
		session.current = exec
		session.state = "busy"

		let result: RunArtifactCodeResult
		try {
			result = await new Promise<RunArtifactCodeResult>((resolve, reject) => {
				// A timeout asks the kernel to stop the cell, exactly like the Stop
				// button.  Only if it cannot is the process restarted (forceRestart).
				const timer = setTimeout(() => this.beginInterrupt(session, exec, "timeout"), effectiveTimeout)
				session.pending.set(id, { resolve, reject, timer })
				const payload = `${JSON.stringify({ op: "exec", id, code })}\n`
				session.process.stdin.write(payload, (err) => {
					if (err) {
						clearTimeout(timer)
						session.pending.delete(id)
						reject(err)
					}
				})
			})
			exec.outcome ??= result.status === "interrupted" ? "interrupted" : "completed"
		} catch (error) {
			exec.outcome ??= "failed"
			throw error
		} finally {
			if (exec.graceTimer) {
				clearTimeout(exec.graceTimer)
			}
			if (session.current === exec) {
				session.current = undefined
				if (session.state === "busy") {
					session.state = "ready"
				}
			}
			session.execCount++
			exec.markDone()
		}

		result = this.describeInterruptOutcome(result, exec, effectiveTimeout)

		if (result.status === "ok") {
			session.executionsSinceRestart++
		}
		if (lostReason && cellId !== "probe") {
			result = {
				...result,
				stderr: `Kernel restarted: variables were cleared (${lostReason}).\n${result.stderr}`,
			}
		}

		const durationMs = Date.now() - startMs
		// The run has finished; failing to record it (read-only workspace, full disk) must not
		// turn a successful result into an error.
		let provenanceId: string | undefined
		try {
			provenanceId = await writeCellProvenance(getWorkspaceFolderPath(), {
				artifactId,
				cellId: cellId?.trim() || "legacy",
				codeHash: hashCode(code),
				codeText: code,
				pythonExecutable: profile.interpreterPath,
				pythonVersion: session.pythonVersion,
				packagesDigest: session.packagesDigest,
				cwd: profile.cwd,
				profileId: profile.id,
				startedAt,
				durationMs,
				status: mapResultStatus(result),
				outputDigests: hashOutputs(result),
				recording: "practice-not-server-recorded",
			} satisfies CellProvenanceRecord)
		} catch (error) {
			this.outputChannel.appendLine(`[${profile.label}][${artifactId}] Could not write run record: ${String(error)}`)
		}

		return { ...result, provenanceId }
	}

	/**
	 * Word the result from what the kernel actually did.  "Interrupted" is only
	 * ever reported when the kernel confirmed it; a timeout the kernel survived
	 * says so (variables kept), and a restart is handled in forceRestart().
	 */
	private describeInterruptOutcome(result: RunArtifactCodeResult, exec: ActiveExec, timeoutMs: number): RunArtifactCodeResult {
		if (result.status !== "interrupted") {
			return result
		}
		if (exec.cause === "timeout") {
			return {
				...result,
				status: "timeout",
				error: `Execution timed out after ${timeoutMs / 1000}s and was interrupted. The kernel kept its variables.\n${result.error}`,
			}
		}
		return { ...result, error: `Interrupted: the kernel stopped the running cell.\n${result.error}` }
	}

	async probeEnvironment(artifactId: string, profileId?: string): Promise<RunArtifactCodeResult> {
		return this.execute(PROBE_CODE, artifactId, profileId, 30_000, "probe")
	}

	private sessionToInfo(session: KernelSession): ArtifactKernelInfo {
		return {
			artifactId: session.artifactId,
			profileId: session.profile.id,
			label: session.profile.label,
			interpreterPath: session.profile.interpreterPath,
			state: session.state,
			cwd: session.profile.cwd,
			lastError: session.lastError,
			pythonVersion: session.pythonVersion,
			packagesProbe: "",
			kernelDirty: session.executionsSinceRestart > 0,
			executionCount: session.executionsSinceRestart,
		}
	}

	private async ensureSession(artifactId: string, profile: KernelProfile): Promise<KernelSession> {
		const sessionKey = buildSessionKeyForArtifact(artifactId, profile.id)
		const existing = this.sessions.get(sessionKey)
		if (existing && existing.state !== "error") {
			return existing
		}
		if (existing) {
			this.stopKernel(sessionKey)
			if (existing.execCount > 0) {
				this.lostState.set(sessionKey, "the previous kernel stopped responding")
			}
		}

		const runnerPath = getRunnerScriptPath(this.context.extensionPath)
		if (!fs.existsSync(runnerPath)) {
			throw new Error(`Extension bundle missing artifact_kernel_runner.py at ${runnerPath}. Reinstall the AI-Hydro VSIX.`)
		}

		const session: KernelSession = {
			sessionKey,
			artifactId,
			shared: vscode.workspace.getConfiguration("aihydro.htmlPreview").get<boolean>("shareKernelAcrossArtifacts", false),
			profile,
			process: undefined as unknown as ChildProcessWithoutNullStreams,
			rl: undefined as unknown as readline.Interface,
			state: "starting",
			lastError: "",
			pythonVersion: "",
			executionsSinceRestart: 0,
			pending: new Map(),
			nextId: 1,
			stopping: false,
			execCount: 0,
			packagesDigest: "",
		}

		// Secret-shaped vars (API keys, tokens, cloud credentials) are scrubbed
		// before the child sees them — artifact code is workspace-trusted, not
		// credential-trusted. See scrubKernelEnv.ts.
		// AIHYDRO_AGENT_CONTEXT is last so a kernel profile env cannot clear it (AP1, B4): artifact code is
		// agent-influenced, and the claim-approval CLI refuses to run where the marker is set.
		const env = { ...scrubKernelEnv(process.env), PYTHONUNBUFFERED: "1", ...profile.env, AIHYDRO_AGENT_CONTEXT: "1" }
		const child = spawn(profile.interpreterPath, [runnerPath], {
			cwd: profile.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			// Own process group on POSIX so killProcessTree() can reach the kernel's children.
			detached: process.platform !== "win32",
		})

		session.process = child
		session.rl = readline.createInterface({ input: child.stdout })

		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString()
			session.lastError = text.trim()
			this.outputChannel.appendLine(`[kernel ${profile.label} stderr] ${text.trim()}`)
		})

		child.on("exit", (code) => {
			session.state = "error"
			session.lastError = `Kernel exited with code ${code ?? "unknown"}`
			if (session.stopping) {
				return
			}
			if (session.current) {
				session.current.outcome ??= "failed"
			}
			const hadPending = session.pending.size > 0
			if (!hadPending && session.execCount > 0) {
				// Died while idle: the next run starts a fresh kernel, so it must say variables are gone.
				this.lostState.set(sessionKey, `the previous kernel exited unexpectedly (code ${code ?? "unknown"})`)
			}
			for (const pending of session.pending.values()) {
				clearTimeout(pending.timer)
				pending.resolve({
					stdout: "",
					stderr: session.lastError,
					status: "error",
					error: `${session.lastError}. Variables were cleared; the kernel starts fresh on the next run.`,
					resultRepr: "",
					imagesPngBase64: [],
					videosMp4Base64: [],
					truncated: false,
				})
			}
			session.pending.clear()
			this.sessions.delete(sessionKey)
		})

		session.rl.on("line", (line) => {
			this.handleKernelLine(session, line)
		})

		this.sessions.set(sessionKey, session)

		try {
			const pingResult = await this.sendOp(session, { op: "ping", id: "ping" })
			session.state = "ready"
			const versionResult = await this.sendOp(session, {
				op: "exec",
				id: "version",
				code: "import sys\nprint(sys.version)",
			})
			session.pythonVersion = versionResult.stdout.trim().split("\n")[0] ?? ""
			try {
				// Reproducibility: digest of the installed distributions, recorded with every cell run.
				const envResult = await this.sendOp(session, { op: "env", id: "env" })
				session.packagesDigest = hashCode(envResult.stdout)
			} catch {
				// best-effort; a missing digest is recorded as empty rather than failing the run
			}
			this.outputChannel.appendLine(
				`[${profile.label}][${artifactId}] Kernel ready: ${profile.interpreterPath} (cwd=${profile.cwd})`,
			)
			if (pingResult.status !== "ok") {
				throw new Error(session.lastError || pingResult.error || "Kernel ping failed")
			}
			// Pre-import numpy/matplotlib in the background while the kernel is
			// idle so the learner's first real cell isn't stalled by import cost.
			this.sendOp(session, { op: "warm", id: "warm" }).catch(() => {
				/* best-effort; a failed warm-up just means the first cell pays the cost */
			})
			return session
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error)
			const detail = session.lastError ? `${msg}\n${session.lastError}` : msg
			this.stopKernel(sessionKey)
			throw new Error(detail)
		}
	}

	private handleKernelLine(session: KernelSession, line: string): void {
		let parsed: {
			id?: string
			stdout?: string
			stderr?: string
			error?: string
			status?: string
			result_repr?: string
			images_png_base64?: string[]
			videos_mp4_base64?: string[]
		}
		try {
			parsed = JSON.parse(line) as typeof parsed
		} catch {
			session.lastError = `Invalid kernel response: ${line.slice(0, 200)}`
			return
		}

		const id = parsed.id ?? ""
		const pending = session.pending.get(id)
		if (!pending) {
			return
		}

		clearTimeout(pending.timer)
		session.pending.delete(id)
		// Another request (e.g. the warm-up) can answer while a cell is still running.
		session.state = session.current && session.current.id !== id ? "busy" : "ready"

		const rawStatus = parsed.status ?? "error"
		const status = rawStatus === "ok" ? "ok" : rawStatus === "interrupted" ? "interrupted" : "error"
		const outStdout = truncateOutput(parsed.stdout ?? "")
		const outStderr = truncateOutput(parsed.stderr ?? "")
		pending.resolve({
			stdout: outStdout.text,
			stderr: outStderr.text,
			status,
			error: parsed.error ?? "",
			resultRepr: parsed.result_repr ?? "",
			imagesPngBase64: Array.isArray(parsed.images_png_base64) ? parsed.images_png_base64 : [],
			videosMp4Base64: Array.isArray(parsed.videos_mp4_base64) ? parsed.videos_mp4_base64 : [],
			truncated: outStdout.truncated || outStderr.truncated,
		})
	}

	private sendOp(session: KernelSession, op: Record<string, string>): Promise<RunArtifactCodeResult> {
		const id = op.id ?? `op_${session.nextId++}`
		return new Promise<RunArtifactCodeResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				session.pending.delete(id)
				const detail = session.lastError
					? `Kernel operation timed out: ${session.lastError}`
					: "Kernel operation timed out"
				reject(new Error(detail))
			}, 15_000)

			session.pending.set(id, { resolve, reject, timer })

			const payload = `${JSON.stringify({ ...op, id })}\n`
			session.process.stdin.write(payload, (err) => {
				if (err) {
					clearTimeout(timer)
					session.pending.delete(id)
					reject(err)
				}
			})
		})
	}
}
