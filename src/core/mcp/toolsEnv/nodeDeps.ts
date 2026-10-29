/**
 * Real process/fs implementation of `ToolsEnvDeps`. The only place the tools environment touches the machine.
 * Child processes are spawned without a shell (argv arrays), so requirement strings with brackets are safe on
 * every platform.
 */
import { spawn } from "node:child_process"
import * as fs from "fs/promises"
import * as path from "path"
import type { HandshakeResult, RunOptions, RunResult, ToolsEnvDeps } from "./managedVenv"

const MAX_CAPTURE = 256 * 1024
/** A child that ignores the first kill is force-killed after this long. */
const FORCE_KILL_MS = 2_000

/** The process environment without the variables that would redirect Python to another environment. */
export function scrubbedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env = { ...base }
	for (const key of Object.keys(env)) {
		if (key.toUpperCase() === "PYTHONPATH" || key.toUpperCase() === "PYTHONHOME") {
			delete env[key]
		}
	}
	return env
}

/** Terminate, then SIGKILL if it has not exited shortly after. */
function terminate(child: ReturnType<typeof spawn>): void {
	try {
		child.kill()
	} catch {
		// already gone
	}
	const timer = setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) {
			try {
				child.kill("SIGKILL")
			} catch {
				// already gone
			}
		}
	}, FORCE_KILL_MS)
	timer.unref()
}

function pushLines(buffer: { text: string }, chunk: string, onLine?: (line: string) => void): void {
	buffer.text += chunk
	let idx = buffer.text.indexOf("\n")
	while (idx >= 0) {
		const line = buffer.text.slice(0, idx).replace(/\r$/, "")
		buffer.text = buffer.text.slice(idx + 1)
		if (line) {
			onLine?.(line)
		}
		idx = buffer.text.indexOf("\n")
	}
}

export function runProcess(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
	return new Promise((resolve) => {
		if (options.signal?.aborted) {
			resolve({ exitCode: null, stdout: "", stderr: "", aborted: true })
			return
		}
		let child: ReturnType<typeof spawn>
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				env: scrubbedEnv(),
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			})
		} catch (error) {
			resolve({
				exitCode: null,
				stdout: "",
				stderr: "",
				spawnError: error instanceof Error ? error.message : String(error),
			})
			return
		}
		let stdout = ""
		let stderr = ""
		let aborted = false
		let timedOut = false
		const outLines = { text: "" }
		const errLines = { text: "" }
		const kill = () => terminate(child)
		const onAbort = () => {
			aborted = true
			kill()
		}
		options.signal?.addEventListener("abort", onAbort, { once: true })
		const timer = options.timeoutMs
			? setTimeout(() => {
					timedOut = true
					kill()
				}, options.timeoutMs)
			: undefined
		child.stdout?.on("data", (d: Buffer) => {
			const text = d.toString("utf-8")
			if (stdout.length < MAX_CAPTURE) {
				stdout += text
			}
			pushLines(outLines, text, options.onLine)
		})
		child.stderr?.on("data", (d: Buffer) => {
			const text = d.toString("utf-8")
			if (stderr.length < MAX_CAPTURE) {
				stderr += text
			}
			pushLines(errLines, text, options.onLine)
		})
		const finish = (result: RunResult) => {
			if (timer) {
				clearTimeout(timer)
			}
			options.signal?.removeEventListener("abort", onAbort)
			resolve(result)
		}
		child.on("error", (error) => finish({ exitCode: null, stdout, stderr, aborted, timedOut, spawnError: error.message }))
		child.on("close", (code) => finish({ exitCode: aborted || timedOut ? null : code, stdout, stderr, aborted, timedOut }))
	})
}

/**
 * MCP stdio handshake: initialize, notifications/initialized, tools/list. MCP stdio frames are newline-delimited
 * JSON. The child is always terminated. Never `--help`: the server blocks on stdin waiting for a client.
 */
export function mcpHandshake(
	command: string,
	args: string[],
	options: { signal?: AbortSignal; timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<HandshakeResult> {
	return new Promise((resolve) => {
		if (options.signal?.aborted) {
			resolve({ ok: false, error: "cancelled" })
			return
		}
		let child: ReturnType<typeof spawn>
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				env: scrubbedEnv(options.env),
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			})
		} catch (error) {
			resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
			return
		}
		let settled = false
		let buffer = ""
		let stderr = ""
		let serverName: string | undefined
		const done = (result: HandshakeResult) => {
			if (settled) {
				return
			}
			settled = true
			clearTimeout(timer)
			options.signal?.removeEventListener("abort", onAbort)
			try {
				child.stdin?.end()
			} catch {
				// already gone
			}
			terminate(child)
			resolve(result)
		}
		const onAbort = () => done({ ok: false, error: "cancelled" })
		options.signal?.addEventListener("abort", onAbort, { once: true })
		const timer = setTimeout(
			() =>
				done({
					ok: false,
					error: `no response within ${Math.round(options.timeoutMs / 1000)} s${stderr ? `: ${stderr.trim().split(/\r?\n/).pop()}` : ""}`,
				}),
			options.timeoutMs,
		)
		const send = (message: unknown) => {
			try {
				child.stdin?.write(`${JSON.stringify(message)}\n`)
			} catch {
				// the exit handler reports it
			}
		}
		child.on("error", (error) => done({ ok: false, error: error.message }))
		child.on("close", (code) =>
			done({ ok: false, error: `the server exited (code ${code}) ${stderr.trim().split(/\r?\n/).pop() ?? ""}`.trim() }),
		)
		child.stderr?.on("data", (d: Buffer) => {
			stderr = (stderr + d.toString("utf-8")).slice(-4096)
		})
		child.stdout?.on("data", (d: Buffer) => {
			buffer += d.toString("utf-8")
			let idx = buffer.indexOf("\n")
			while (idx >= 0) {
				const line = buffer.slice(0, idx).trim()
				buffer = buffer.slice(idx + 1)
				idx = buffer.indexOf("\n")
				if (!line) {
					continue
				}
				let msg: {
					id?: number
					result?: { serverInfo?: { name?: string }; tools?: unknown[] }
					error?: { message?: string }
				}
				try {
					msg = JSON.parse(line)
				} catch {
					continue // banner or log line on stdout
				}
				if (msg.error) {
					done({ ok: false, error: msg.error.message ?? "the server returned an error" })
					return
				}
				if (msg.id === 1 && msg.result) {
					serverName = msg.result.serverInfo?.name
					send({ jsonrpc: "2.0", method: "notifications/initialized" })
					send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
				} else if (msg.id === 2 && msg.result) {
					done({
						ok: true,
						serverName,
						toolCount: Array.isArray(msg.result.tools) ? msg.result.tools.length : undefined,
					})
					return
				}
			}
		})
		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "ai-hydro-extension-health", version: "1" },
			},
		})
	})
}

/** `O_EXCL` lock file holding our pid. A lock whose pid is no longer alive is stale and is taken over once. */
export async function acquireLock(
	lockPath: string,
): Promise<{ ok: true; release(): Promise<void> } | { ok: false; pid?: number }> {
	await fs.mkdir(path.dirname(lockPath), { recursive: true })
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const handle = await fs.open(lockPath, "wx")
			await handle.writeFile(String(process.pid))
			await handle.close()
			return {
				ok: true,
				release: async () => {
					await fs.rm(lockPath, { force: true })
				},
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				return { ok: false }
			}
		}
		let pid = Number.NaN
		try {
			pid = Number.parseInt((await fs.readFile(lockPath, "utf-8")).trim(), 10)
		} catch {
			continue // vanished between open and read: try again
		}
		let alive = false
		if (Number.isInteger(pid) && pid > 0) {
			try {
				process.kill(pid, 0)
				alive = true
			} catch (error) {
				alive = (error as NodeJS.ErrnoException).code === "EPERM"
			}
		}
		if (alive && pid !== process.pid) {
			return { ok: false, pid }
		}
		await fs.rm(lockPath, { force: true }) // stale (dead pid or unreadable)
	}
	return { ok: false }
}

export function createNodeToolsEnvDeps(log: (line: string) => void, handshakeCwd?: string): ToolsEnvDeps {
	return {
		platform: process.platform,
		pathExists: async (p) => {
			try {
				await fs.access(p)
				return true
			} catch {
				return false
			}
		},
		listDir: async (p) => {
			try {
				return await fs.readdir(p)
			} catch {
				return []
			}
		},
		run: runProcess,
		lock: acquireLock,
		handshake: (command, args, options) => mcpHandshake(command, args, { ...options, cwd: handshakeCwd }),
		log,
	}
}
