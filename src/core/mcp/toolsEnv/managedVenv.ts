/**
 * Lifecycle of the managed AI-Hydro tools virtualenv (X0-3): find a usable Python, create the venv, install the
 * pinned `aihydro-tools`, and decide health (importable + the `aihydro-mcp` server answers an MCP handshake).
 *
 * Everything that touches the machine goes through `ToolsEnvDeps`, so the lifecycle is tested with a fake
 * process/fs layer and no test ever runs pip. Rules enforced here:
 *  - pip only ever runs as `<venv python> -m pip`; the discovered base interpreter is only used for `-m venv`.
 *  - an existing healthy environment is adopted as-is (no pip, no recreation);
 *  - a directory that is not a virtualenv is never overwritten;
 *  - cancellation (AbortSignal) stops the running child and returns "cancelled", leaving the venv for a retry.
 *
 * Host-neutral: no `vscode` import.
 */
import { pythonMeetsMinimum, TOOLS_REQUIREMENT, venvMcpPath, venvPythonPath, versionMeetsFloor } from "@shared/aihydro/toolsEnv"

export interface RunOptions {
	signal?: AbortSignal
	timeoutMs?: number
	cwd?: string
	/** Called for each output line (stdout and stderr) as it arrives. */
	onLine?: (line: string) => void
}

export interface RunResult {
	/** null when the process could not start, was killed, or timed out. */
	exitCode: number | null
	stdout: string
	stderr: string
	aborted?: boolean
	timedOut?: boolean
	/** Spawn failure (e.g. ENOENT). */
	spawnError?: string
}

export interface HandshakeResult {
	ok: boolean
	serverName?: string
	toolCount?: number
	error?: string
}

export interface ToolsEnvDeps {
	platform: NodeJS.Platform
	pathExists(p: string): Promise<boolean>
	listDir(p: string): Promise<string[]>
	run(command: string, args: string[], options?: RunOptions): Promise<RunResult>
	/** Spawn `command` and perform MCP initialize + tools/list over stdio, then terminate it. */
	handshake(command: string, args: string[], options: { signal?: AbortSignal; timeoutMs: number }): Promise<HandshakeResult>
	log(line: string): void
}

export type EnsureErrorCode = "NO_PYTHON" | "VENV_FAILED" | "NOT_A_VENV" | "PIP_FAILED" | "OFFLINE" | "UNHEALTHY"

export interface ProbeResult {
	venvExists: boolean
	pythonExists: boolean
	mcpExists: boolean
	pythonRuns: boolean
	importOk: boolean
	version: string
	handshakeOk: boolean
	toolCount?: number
	error?: string
	/** importOk && handshakeOk */
	healthy: boolean
}

export type EnsureOutcome = "adopted" | "created" | "repaired" | "upgraded" | "cancelled" | "failed"

export interface EnsureResult {
	outcome: EnsureOutcome
	probe: ProbeResult
	basePython: string
	errorCode?: EnsureErrorCode
	message?: string
}

export interface EnsureOptions {
	venvDir: string
	/** Interpreters to try, in order, to create the venv (configured first). Bare names are resolved on PATH by the OS. */
	pythonCandidates: string[]
	requirement?: string
	signal?: AbortSignal
	onStep?: (step: string) => void
	/** Force a pip run even when the environment looks healthy (Repair). */
	repair?: boolean
	handshakeTimeoutMs?: number
}

const PY_VERSION_SNIPPET = "import sys;print('%d.%d.%d' % sys.version_info[:3])"
const TOOLS_IMPORT_SNIPPET = "import importlib.metadata as m, ai_hydro.mcp; print(m.version('aihydro-tools'))"
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 90_000
const OFFLINE_PATTERN =
	/Could not find a version that satisfies|No matching distribution|Temporary failure in name resolution|Network is unreachable|Connection (?:refused|reset|timed out|aborted)|getaddrinfo|ProxyError|SSLError|Max retries exceeded|Name or service not known|nodename nor servname/i

function tail(text: string, lines = 6): string {
	return text.trim().split(/\r?\n/).slice(-lines).join("\n")
}

/** Default interpreter search order after the configured ones. */
export function defaultPythonNames(platform: NodeJS.Platform): string[] {
	return platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"]
}

export interface BasePython {
	path: string
	version: string
}

/** First candidate that runs and is Python >= 3.10. Records why others were skipped in the log. */
export async function findBasePython(
	deps: ToolsEnvDeps,
	candidates: string[],
	signal?: AbortSignal,
): Promise<BasePython | undefined> {
	const seen = new Set<string>()
	for (const candidate of candidates) {
		if (!candidate || seen.has(candidate)) {
			continue
		}
		seen.add(candidate)
		if (signal?.aborted) {
			return undefined
		}
		// `py` is the Windows launcher: it needs `-3` to pick a Python 3.
		const launcherArgs =
			candidate
				.replace(/\.exe$/i, "")
				.split(/[\\/]/)
				.pop() === "py"
				? ["-3"]
				: []
		const r = await deps.run(candidate, [...launcherArgs, "-c", PY_VERSION_SNIPPET], { signal, timeoutMs: 20_000 })
		const version = r.exitCode === 0 ? r.stdout.trim() : ""
		if (!version) {
			deps.log(`[python] ${candidate}: not usable${r.spawnError ? ` (${r.spawnError})` : ""}`)
			continue
		}
		if (!pythonMeetsMinimum(version)) {
			deps.log(`[python] ${candidate}: ${version} is older than 3.10, skipped`)
			continue
		}
		return { path: candidate, version }
	}
	return undefined
}

/** Read-only health probe of an environment. Never installs. */
export async function probeToolsEnv(
	deps: ToolsEnvDeps,
	venvDir: string,
	options: { signal?: AbortSignal; handshakeTimeoutMs?: number } = {},
): Promise<ProbeResult> {
	const python = venvPythonPath(venvDir, deps.platform)
	const mcp = venvMcpPath(venvDir, deps.platform)
	const result: ProbeResult = {
		venvExists: await deps.pathExists(venvDir),
		pythonExists: await deps.pathExists(python),
		mcpExists: await deps.pathExists(mcp),
		pythonRuns: false,
		importOk: false,
		version: "",
		handshakeOk: false,
		healthy: false,
	}
	if (!result.pythonExists) {
		result.error = "The environment has no Python interpreter."
		return result
	}
	const py = await deps.run(python, ["-c", PY_VERSION_SNIPPET], { signal: options.signal, timeoutMs: 20_000 })
	result.pythonRuns = py.exitCode === 0
	if (!result.pythonRuns) {
		result.error = `The environment's Python does not run${py.spawnError ? ` (${py.spawnError})` : ""}.`
		return result
	}
	const imp = await deps.run(python, ["-c", TOOLS_IMPORT_SNIPPET], { signal: options.signal, timeoutMs: 60_000 })
	if (imp.exitCode !== 0) {
		result.error = `aihydro-tools is not importable: ${tail(imp.stderr, 3) || "no output"}`
		return result
	}
	result.importOk = true
	result.version = imp.stdout.trim().split(/\r?\n/).pop() ?? ""
	if (!result.mcpExists) {
		result.error = "The aihydro-mcp launcher is missing from the environment."
		return result
	}
	const hs = await deps.handshake(mcp, [], {
		signal: options.signal,
		timeoutMs: options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
	})
	result.handshakeOk = hs.ok
	result.toolCount = hs.toolCount
	if (!hs.ok) {
		result.error = `aihydro-mcp did not complete the MCP handshake: ${hs.error ?? "no response"}`
		return result
	}
	result.healthy = true
	return result
}

async function runPip(deps: ToolsEnvDeps, python: string, requirement: string, opts: EnsureOptions, force: boolean) {
	const args = [
		"-m",
		"pip",
		"install",
		"--upgrade",
		"--disable-pip-version-check",
		...(force ? ["--force-reinstall"] : []),
		requirement,
	]
	deps.log(`$ ${python} ${args.join(" ")}`)
	return deps.run(python, args, { signal: opts.signal, onLine: (l) => deps.log(l) })
}

function fail(probe: ProbeResult, basePython: string, errorCode: EnsureErrorCode, message: string): EnsureResult {
	return { outcome: "failed", probe, basePython, errorCode, message }
}

/**
 * Bring the managed environment to a healthy state: adopt it when it already is, otherwise create and/or install.
 * Resolves (never throws) with the outcome; the caller maps it onto status and notifications.
 */
export async function ensureToolsEnv(deps: ToolsEnvDeps, opts: EnsureOptions): Promise<EnsureResult> {
	const requirement = opts.requirement ?? TOOLS_REQUIREMENT
	const python = venvPythonPath(opts.venvDir, deps.platform)
	let basePython = ""
	const cancelled = (probe: ProbeResult): EnsureResult => ({
		outcome: "cancelled",
		probe,
		basePython,
		message: "Install cancelled.",
	})

	opts.onStep?.("Checking the tools environment")
	let probe = await probeToolsEnv(deps, opts.venvDir, { signal: opts.signal, handshakeTimeoutMs: opts.handshakeTimeoutMs })
	if (opts.signal?.aborted) {
		return cancelled(probe)
	}
	if (probe.healthy && versionMeetsFloor(probe.version) && !opts.repair) {
		deps.log(`[env] adopted existing environment ${opts.venvDir} (aihydro-tools ${probe.version})`)
		return { outcome: "adopted", probe, basePython }
	}
	const wasMissing = !probe.pythonExists || !probe.pythonRuns
	const wasHealthy = probe.healthy

	if (wasMissing) {
		opts.onStep?.("Looking for Python 3.10 or newer")
		const found = await findBasePython(deps, opts.pythonCandidates, opts.signal)
		if (opts.signal?.aborted) {
			return cancelled(probe)
		}
		if (!found) {
			return fail(
				probe,
				"",
				"NO_PYTHON",
				"No Python 3.10 or newer was found. Install Python from python.org or your package manager, or set aihydro.tools.pythonPath to an interpreter, then choose Retry.",
			)
		}
		basePython = found.path
		deps.log(`[python] using ${found.path} (${found.version}) to create the environment`)

		// Never overwrite a directory that is not one of our virtualenvs.
		let clear = false
		if (probe.venvExists) {
			const hasCfg = await deps.pathExists(
				`${opts.venvDir.replace(/[\\/]+$/, "")}${deps.platform === "win32" ? "\\" : "/"}pyvenv.cfg`,
			)
			const entries = await deps.listDir(opts.venvDir)
			if (hasCfg) {
				clear = true
			} else if (entries.length > 0) {
				return fail(
					probe,
					basePython,
					"NOT_A_VENV",
					`${opts.venvDir} exists and is not a Python virtual environment, so AI-Hydro will not overwrite it. Move it or set aihydro.tools.venvPath.`,
				)
			}
		}
		opts.onStep?.("Creating the virtual environment")
		const launcherArgs =
			basePython
				.replace(/\.exe$/i, "")
				.split(/[\\/]/)
				.pop() === "py"
				? ["-3"]
				: []
		const venvArgs = [...launcherArgs, "-m", "venv", ...(clear ? ["--clear"] : []), opts.venvDir]
		deps.log(`$ ${basePython} ${venvArgs.join(" ")}`)
		const created = await deps.run(basePython, venvArgs, { signal: opts.signal, onLine: (l) => deps.log(l) })
		if (opts.signal?.aborted || created.aborted) {
			return cancelled(probe)
		}
		if (created.exitCode !== 0) {
			const debian = /ensurepip|python3-venv/i.test(created.stderr)
				? " On Debian or Ubuntu, install the python3-venv package."
				: ""
			return fail(
				probe,
				basePython,
				"VENV_FAILED",
				`Could not create the virtual environment: ${tail(created.stderr, 3) || created.spawnError || "unknown error"}.${debian}`,
			)
		}
	}

	opts.onStep?.("Installing AI-Hydro tools (this can take several minutes)")
	let pip = await runPip(deps, python, requirement, opts, false)
	if (opts.signal?.aborted || pip.aborted) {
		return cancelled(probe)
	}
	if (pip.exitCode !== 0) {
		const offline = OFFLINE_PATTERN.test(pip.stderr) || OFFLINE_PATTERN.test(pip.stdout)
		return fail(
			probe,
			basePython,
			offline ? "OFFLINE" : "PIP_FAILED",
			offline
				? `pip could not download aihydro-tools. Check your network or proxy settings, then choose Retry. ${tail(pip.stderr, 2)}`.trim()
				: `pip failed to install ${requirement}: ${tail(pip.stderr, 4) || pip.spawnError || "unknown error"}`,
		)
	}

	opts.onStep?.("Checking the tools environment")
	probe = await probeToolsEnv(deps, opts.venvDir, { signal: opts.signal, handshakeTimeoutMs: opts.handshakeTimeoutMs })
	if (opts.signal?.aborted) {
		return cancelled(probe)
	}
	if (!probe.healthy) {
		// One forced reinstall repairs a half-installed package set.
		opts.onStep?.("Reinstalling AI-Hydro tools")
		pip = await runPip(deps, python, requirement, opts, true)
		if (opts.signal?.aborted || pip.aborted) {
			return cancelled(probe)
		}
		if (pip.exitCode === 0) {
			probe = await probeToolsEnv(deps, opts.venvDir, { signal: opts.signal, handshakeTimeoutMs: opts.handshakeTimeoutMs })
			if (opts.signal?.aborted) {
				return cancelled(probe)
			}
		}
	}
	if (!probe.healthy) {
		return fail(probe, basePython, "UNHEALTHY", probe.error ?? "The installed tools did not pass the health check.")
	}
	const outcome: EnsureOutcome = wasMissing ? "created" : wasHealthy && !opts.repair ? "upgraded" : "repaired"
	return { outcome, probe, basePython }
}
