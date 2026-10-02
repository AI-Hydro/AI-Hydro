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

/**
 * Resolve the Python interpreter to run the required modules with. Order:
 *   1. the explicit `pythonPath` setting
 *   2. the interpreter behind the registered `ai-hydro` MCP server
 *   3. the active virtualenv, then `python3` / `python` on PATH
 * The first candidate that can import every required module wins. No machine-specific paths are probed and
 * PYTHONPATH is never injected: the package must be installed in the chosen environment.
 */
export async function resolveAiHydroPython(input: ResolveInput, deps: ResolveDeps): Promise<ResolveResult> {
	const candidates: PythonCandidate[] = []
	const seen = new Set<string>()
	const add = (command: string | undefined, source: string) => {
		const c = command?.trim()
		if (!c || seen.has(c)) return
		seen.add(c)
		candidates.push({ command: c, source })
	}

	add(input.configuredPath, `setting ${input.settingName}`)
	add(await pythonFromMcpServer(input.mcpServer, deps), "ai-hydro MCP server config")
	const venv = deps.env.VIRTUAL_ENV
	if (venv) {
		add(
			deps.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python"),
			"VIRTUAL_ENV",
		)
	}
	if (deps.platform === "win32") {
		add("python", "PATH")
		add("python3", "PATH")
		add("py", "PATH")
	} else {
		add("python3", "PATH")
		add("python", "PATH")
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
