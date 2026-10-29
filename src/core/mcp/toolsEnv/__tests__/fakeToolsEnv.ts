/** A faked process/fs layer for the tools-environment tests: no real pip, venv or interpreter is ever run. */
import { venvMcpPath, venvPythonPath } from "@shared/aihydro/toolsEnv"
import type { HandshakeResult, RunOptions, RunResult, ToolsEnvDeps } from "../managedVenv"

export interface FakeMachine {
	deps: ToolsEnvDeps
	/** Every `run` call as `[command, ...args]`. */
	calls: string[][]
	handshakes: string[]
	files: Set<string>
	/** Version `aihydro-tools` currently has in the venv ("" = not installed). */
	installed: { version: string }
	/** Interpreter path -> version ("" or missing = does not run). */
	pythons: Map<string, string>
	pipResult: { exitCode: number; stderr: string }
	/** Make the next N handshakes fail. */
	handshakeFailures: { count: number }
	/** Runs when pip starts; lets a test abort or block. */
	onPip?: (options?: RunOptions) => Promise<RunResult | undefined>
	/** Version pip installs. */
	pipInstalls: { version: string }
	logs: string[]
	/** The venv's python runs but reports sys.prefix == sys.base_prefix (a conda base, Homebrew or system prefix). */
	nonVenvPython: { value: boolean }
	/** The venv's python file exists but spawning it fails or times out. */
	venvPythonBroken: { value: boolean }
	/** Another process holds the install lock. */
	lockHeld: { pid: number | undefined }
	locks: number
}

export function createFakeMachine(venvDir: string, platform: NodeJS.Platform = "linux"): FakeMachine {
	const venvPy = venvPythonPath(venvDir, platform)
	const venvMcp = venvMcpPath(venvDir, platform)
	const m: FakeMachine = {
		calls: [],
		handshakes: [],
		files: new Set(),
		installed: { version: "" },
		pythons: new Map([["python3", "3.12.1"]]),
		pipResult: { exitCode: 0, stderr: "" },
		handshakeFailures: { count: 0 },
		pipInstalls: { version: "2.8.2" },
		logs: [],
		nonVenvPython: { value: false },
		venvPythonBroken: { value: false },
		lockHeld: { pid: undefined },
		locks: 0,
		deps: undefined as unknown as ToolsEnvDeps,
	}
	const venvIsReal = () => m.files.has(venvPy)
	m.deps = {
		platform,
		pathExists: async (p) => m.files.has(p),
		listDir: async (p) =>
			[...m.files].filter((f) => f.startsWith(`${p}/`) || f.startsWith(`${p}\\`)).map((f) => f.slice(p.length + 1)),
		log: (line) => m.logs.push(line),
		lock: async () => {
			if (m.lockHeld.pid !== undefined) {
				return { ok: false, pid: m.lockHeld.pid }
			}
			m.locks++
			return { ok: true, release: async () => {} }
		},
		run: async (command, args, options): Promise<RunResult> => {
			m.calls.push([command, ...args])
			if (options?.signal?.aborted) {
				return { exitCode: null, stdout: "", stderr: "", aborted: true }
			}
			const joined = args.join(" ")
			if (command === venvPy) {
				if (m.venvPythonBroken.value) {
					return { exitCode: null, stdout: "", stderr: "", timedOut: true }
				}
				if (joined.includes("base_prefix")) {
					return { exitCode: 0, stdout: m.nonVenvPython.value ? "False\n" : "True\n", stderr: "" }
				}
				if (args[0] === "-m" && args[1] === "pip") {
					const hook = await m.onPip?.(options)
					if (hook) {
						return hook
					}
					if (m.pipResult.exitCode === 0) {
						m.installed.version = m.pipInstalls.version
						m.files.add(venvMcp)
					}
					return { exitCode: m.pipResult.exitCode, stdout: "", stderr: m.pipResult.stderr }
				}
				if (joined.includes("importlib.metadata")) {
					return m.installed.version
						? { exitCode: 0, stdout: `${m.installed.version}\n`, stderr: "" }
						: { exitCode: 1, stdout: "", stderr: "ModuleNotFoundError: No module named 'ai_hydro'" }
				}
				return { exitCode: 0, stdout: "3.12.1\n", stderr: "" }
			}
			if (args.includes("venv")) {
				const dir = args[args.length - 1]
				if (!m.pythons.get(command)) {
					return { exitCode: 1, stdout: "", stderr: "no python" }
				}
				m.files.add(dir)
				m.files.add(`${dir}${platform === "win32" ? "\\" : "/"}pyvenv.cfg`)
				m.files.add(venvPy)
				return { exitCode: 0, stdout: "", stderr: "" }
			}
			const version = m.pythons.get(command)
			if (version) {
				return { exitCode: 0, stdout: `${version}\n`, stderr: "" }
			}
			return { exitCode: null, stdout: "", stderr: "", spawnError: "spawn ENOENT" }
		},
		handshake: async (command): Promise<HandshakeResult> => {
			m.handshakes.push(command)
			if (m.handshakeFailures.count > 0) {
				m.handshakeFailures.count--
				return { ok: false, error: "the server exited (code 1)" }
			}
			return m.installed.version
				? { ok: true, toolCount: 12, serverName: "ai-hydro" }
				: { ok: false, error: "not installed" }
		},
	}
	// helper to simulate a venv that exists already
	;(m as unknown as { makeVenv: (version: string) => void }).makeVenv = (version: string) => {
		m.files.add(venvDir)
		m.files.add(`${venvDir}${platform === "win32" ? "\\" : "/"}pyvenv.cfg`)
		m.files.add(venvPy)
		if (version) {
			m.files.add(venvMcp)
			m.installed.version = version
		}
	}
	void venvIsReal
	return m
}

export function makeVenv(m: FakeMachine, version: string): void {
	;(m as unknown as { makeVenv: (v: string) => void }).makeVenv(version)
}
