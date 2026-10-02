import { execFile } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** Shape of one entry in the MCP settings file (`mcpServers[name]`). */
export interface McpServerEntry {
	command?: string
	args?: string[]
}

export interface PythonCandidate {
	/** Executable to probe. */
	command: string
	/** Where this candidate came from, for diagnostics. */
	source: string
}

export interface ResolveDeps {
	/** True when `command` can import every module. */
	canImport: (command: string, modules: string[]) => Promise<boolean>
	/** First line of a file, or undefined if unreadable. Used for console-script shebangs. */
	readFirstLine: (file: string) => Promise<string | undefined>
	/** Whether a file exists. */
	exists: (file: string) => Promise<boolean>
	platform: NodeJS.Platform
	env: NodeJS.ProcessEnv
}

export interface ResolveInput {
	/** Value of the user-facing `pythonPath` setting (may be empty). */
	configuredPath?: string
	/** The `ai-hydro` entry of the MCP settings file, if registered. */
	mcpServer?: McpServerEntry
	/** Modules that the chosen interpreter must be able to import. */
	modules: string[]
	/** Name of the setting, only used in the error message. */
	settingName: string
}

export type ResolveResult = { ok: true; command: string; source: string } | { ok: false; error: string; tried: PythonCandidate[] }

const PYTHON_NAME = /^python(\d+(\.\d+)*)?(\.exe)?$/i

/**
 * Derive the interpreter that runs the aihydro MCP server from its registered config, so the
 * extension and the MCP server always use the same environment.
 *
 * - `command` is a python executable (`python -m ai_hydro.mcp` form): use it directly.
 * - `command` is the `aihydro-mcp` console script: read its shebang (POSIX), else look for a
 *   python next to it / in the parent (Windows venv `Scripts`, conda `bin`).
 */
export async function pythonFromMcpServer(
	server: McpServerEntry | undefined,
	deps: Pick<ResolveDeps, "readFirstLine" | "exists" | "platform">,
): Promise<string | undefined> {
	const command = server?.command?.trim()
	if (!command) return undefined
	const base = path.basename(command)
	if (PYTHON_NAME.test(base) || base === "py" || base === "py.exe") {
		return command
	}
	if (!path.isAbsolute(command)) return undefined

	const first = await deps.readFirstLine(command)
	if (first?.startsWith("#!")) {
		const parts = first.slice(2).trim().split(/\s+/)
		// `#!/usr/bin/env python3` carries no interpreter location; ignore it.
		if (parts[0] && path.basename(parts[0]) !== "env" && path.isAbsolute(parts[0])) {
			return parts[0]
		}
	}
	const dir = path.dirname(command)
	const names = deps.platform === "win32" ? ["python.exe"] : ["python", "python3"]
	for (const d of [dir, path.dirname(dir)]) {
		for (const n of names) {
			const candidate = path.join(d, n)
			if (await deps.exists(candidate)) return candidate
		}
	}
	return undefined
}

/** Path flavour for the (possibly mocked) target platform. */
function pathFor(platform: NodeJS.Platform): typeof path.posix {
	return platform === "win32" ? path.win32 : path.posix
}

/**
 * Resolve a bare executable name to an absolute path using only the PATH entries. The current
 * working directory is never searched (Windows' CreateProcess does that implicitly, which would let
 * a workspace-planted python.exe run), and relative PATH entries are ignored. Returns undefined if
 * the name is not found.
 */
export async function resolveOnPath(
	name: string,
	deps: Pick<ResolveDeps, "exists" | "platform" | "env">,
): Promise<string | undefined> {
	const p = pathFor(deps.platform)
	const win = deps.platform === "win32"
	const pathVar = (win ? (deps.env.Path ?? deps.env.PATH) : deps.env.PATH) ?? ""
	const exts = win ? (deps.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""]
	const hasExt = win && exts.some((e) => name.toLowerCase().endsWith(e.toLowerCase()))
	for (const dir of pathVar.split(win ? ";" : ":")) {
		if (!dir || !p.isAbsolute(dir)) continue
		// Only .exe can be spawned directly by execFile without a shell.
		for (const ext of win ? (hasExt ? [""] : [".exe"]) : [""]) {
			const candidate = p.join(dir, name + ext)
			if (await deps.exists(candidate)) return candidate
		}
	}
	return undefined
}

/**
 * Resolve the Python interpreter to run the required modules with. Order:
 *   1. the explicit `pythonPath` setting
 *   2. the interpreter behind the registered `ai-hydro` MCP server
 *   3. the active virtualenv, then `python3` / `python` found via PATH
 * Bare names are resolved to absolute paths through PATH entries only (never the cwd). The first
 * candidate that can import every required module wins. No machine-specific paths are probed and
 * PYTHONPATH is never injected: the package must be installed in the chosen environment.
 */
export async function resolveAiHydroPython(input: ResolveInput, deps: ResolveDeps): Promise<ResolveResult> {
	const p = pathFor(deps.platform)
	const candidates: PythonCandidate[] = []
	const seen = new Set<string>()
	const add = async (command: string | undefined, source: string) => {
		let c = command?.trim()
		if (!c) return
		if (!p.isAbsolute(c)) {
			// Bare name -> PATH lookup. Relative paths with separators are cwd-relative: refuse.
			if (/[\\/]/.test(c)) return
			c = await resolveOnPath(c, deps)
			if (!c) return
		}
		if (seen.has(c)) return
		seen.add(c)
		candidates.push({ command: c, source })
	}

	await add(input.configuredPath, `setting ${input.settingName}`)
	await add(await pythonFromMcpServer(input.mcpServer, deps), "ai-hydro MCP server config")
	const venv = deps.env.VIRTUAL_ENV
	if (venv) {
		await add(
			deps.platform === "win32" ? p.join(venv, "Scripts", "python.exe") : p.join(venv, "bin", "python"),
			"VIRTUAL_ENV",
		)
	}
	for (const name of deps.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"]) {
		await add(name, "PATH")
	}

	for (const c of candidates) {
		if (await deps.canImport(c.command, input.modules)) {
			return { ok: true, command: c.command, source: c.source }
		}
	}
	const tried = candidates.map((c) => `${c.command} (${c.source})`).join(", ")
	return {
		ok: false,
		tried: candidates,
		error:
			`No Python interpreter with the '${input.modules[0].split(".")[0]}' package was found (tried: ${tried || "none"}). ` +
			`Install it with "pip install aihydro-tools" in the environment you use, or set "${input.settingName}" ` +
			`to the interpreter that has it.`,
	}
}

/** Production dependencies (real subprocess / filesystem). */
export const nodeResolveDeps: ResolveDeps = {
	canImport: async (command, modules) => {
		try {
			await execFileAsync(command, ["-c", modules.map((m) => `import ${m}`).join("; ")], { timeout: 15000 })
			return true
		} catch {
			return false
		}
	},
	readFirstLine: async (file) => {
		try {
			const fh = await fs.open(file, "r")
			try {
				const buf = Buffer.alloc(512)
				const { bytesRead } = await fh.read(buf, 0, 512, 0)
				return buf.toString("utf-8", 0, bytesRead).split(/\r?\n/, 1)[0]
			} finally {
				await fh.close()
			}
		} catch {
			return undefined
		}
	},
	exists: async (file) => {
		try {
			await fs.access(file)
			return true
		} catch {
			return false
		}
	},
	platform: process.platform,
	env: process.env,
}

/** Minimal shape of `WorkspaceConfiguration.inspect()` needed to pick a trusted value. */
export interface InspectedSetting {
	globalValue?: string
	workspaceValue?: string
	workspaceFolderValue?: string
}

/**
 * Pick the interpreter setting from user/machine scope only. Workspace and folder values live in
 * the repository's `.vscode/settings.json`, so honouring them would let an opened project choose
 * the executable we spawn; they are ignored and reported via `log`.
 */
export function trustedPythonSetting(
	inspected: InspectedSetting | undefined,
	settingName: string,
	log: (msg: string) => void = console.warn,
): string | undefined {
	const ignored = inspected?.workspaceFolderValue ?? inspected?.workspaceValue
	if (ignored) {
		log(`[AI-Hydro] Ignoring workspace-scoped ${settingName} ("${ignored}"): set it in user settings instead.`)
	}
	return inspected?.globalValue?.trim() || undefined
}
