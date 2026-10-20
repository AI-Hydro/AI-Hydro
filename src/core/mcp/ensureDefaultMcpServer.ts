import { ensureSettingsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { execa } from "@packages/execa"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { looksLikeFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import { ShowMessageType } from "@shared/proto/host/window"
import { ExecuteCommandInTerminalRequest } from "@shared/proto/host/workspace"
import { fileExistsAtPath } from "@utils/fs"
import * as fs from "fs/promises"
import os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { loadFirstPartyLauncher, migrateFirstPartyAnchor, recordFirstPartyLauncher } from "./firstPartyLauncher"

const SERVER_NAME = "ai-hydro"
const CACHE_DIR = aihydroPath("cache")
const ACTIVE_WORKSPACE_FILE = aihydroPath("active_workspace.json")
const PIP_COMMAND = "pip install aihydro-tools"

/**
 * Write the current VS Code workspace root to ~/.aihydro/active_workspace.json.
 *
 * The Python MCP server reads this file in _maybe_set_workspace() so that
 * session.workspace_dir is populated even without per-call _workspace injection.
 * Called on activation and whenever workspace folders change.
 */
async function writeActiveWorkspace(): Promise<void> {
	try {
		// Use HostProvider abstraction to satisfy the no-direct-vscode lint rule.
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const primaryPath = workspacePaths.paths?.[0]
		if (!primaryPath) {
			return
		}
		const content = JSON.stringify({ workspace: primaryPath, updated_at: new Date().toISOString() }, null, 2)
		await fs.mkdir(path.dirname(ACTIVE_WORKSPACE_FILE), { recursive: true })
		await fs.writeFile(ACTIVE_WORKSPACE_FILE, content, "utf-8")
	} catch {
		// Non-fatal — MCP per-call injection is still the primary path
	}
}

/**
 * Write the active workspace on extension activation and keep it updated
 * whenever workspace folders change.  Returns a disposable to push onto
 * context.subscriptions.
 */
export async function setupActiveWorkspaceTracking(context: vscode.ExtensionContext): Promise<void> {
	await writeActiveWorkspace()
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => writeActiveWorkspace()))
}

/**
 * Return candidate paths where pip may have installed `aihydro-mcp`.
 * Checked when `which`/`where` fails (common for user-level pip installs).
 */
function getPipScriptCandidates(): string[] {
	const home = os.homedir()
	const candidates: string[] = []

	if (process.platform === "win32") {
		// User-level: %APPDATA%\Python\Python3XX\Scripts
		const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
		const pythonDir = path.join(appData, "Python")
		// Check common Python versions (3.9 through 3.13)
		for (const ver of ["39", "310", "311", "312", "313"]) {
			candidates.push(path.join(pythonDir, `Python${ver}`, "Scripts", "aihydro-mcp.exe"))
		}
		// System-level: C:\PythonXX\Scripts  or  C:\Program Files\PythonXX\Scripts
		for (const ver of ["39", "310", "311", "312", "313"]) {
			candidates.push(path.join("C:", `Python${ver}`, "Scripts", "aihydro-mcp.exe"))
		}
	} else {
		// macOS / Linux user-level
		candidates.push(path.join(home, ".local", "bin", "aihydro-mcp"))
		// Homebrew / system Python
		candidates.push("/usr/local/bin/aihydro-mcp")
		candidates.push("/opt/homebrew/bin/aihydro-mcp")
		// Conda default
		candidates.push(path.join(home, "miniconda3", "bin", "aihydro-mcp"))
		candidates.push(path.join(home, "anaconda3", "bin", "aihydro-mcp"))
		candidates.push("/opt/miniconda3/bin/aihydro-mcp")
	}

	return candidates
}

/**
 * Install the trust anchor for an already-registered first-party server.
 *  - No record yet (registered before this version): record the entry if it has the first-party launcher shape.
 *    This trusts what is on disk at upgrade time; an entry with any other shape stays untrusted.
 *  - Record exists and matches: nothing to do.
 *  - Record exists and the entry changed: the server is untrusted until the user confirms in this dialog.
 *    The dialog is the only path that rewrites the record, and it is shown to the human, not the model.
 */
async function reconcileFirstPartyLauncher(settingsDir: string, entry: unknown): Promise<void> {
	try {
		const { command, args } = (entry ?? {}) as { command?: unknown; args?: unknown }
		const current = {
			name: SERVER_NAME,
			command: typeof command === "string" ? command : "",
			args: Array.isArray(args) ? (args as unknown[]).filter((a): a is string => typeof a === "string") : [],
		}
		const recorded = await loadFirstPartyLauncher(settingsDir)
		const sameLaunch =
			recorded?.command === current.command &&
			recorded.args.length === current.args.length &&
			recorded.args.every((a, i) => a === current.args[i])
		if (sameLaunch) {
			return
		}
		if (!looksLikeFirstPartyLauncher(current.command, current.args)) {
			// Not recorded and not trusted: say so once per start instead of silently losing claim-approval prompts.
			await HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message:
					`The "${SERVER_NAME}" MCP server uses a non-standard launcher (\`${[current.command, ...current.args].join(" ")}\`), ` +
					"so AI-Hydro does not treat it as the first-party server: claim-approval prompts and read-only subagent " +
					"tools are off for it. To restore them, register the standard `aihydro-mcp` or `python -m ai_hydro.mcp` launcher.",
				options: { items: [] },
			})
			return
		}
		if (!recorded) {
			await recordFirstPartyLauncher(settingsDir, current)
			console.log("[AI-Hydro] Recorded the existing first-party launcher as the trust anchor")
			return
		}
		const trust = "Trust this launcher"
		const action = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message:
				`The "${SERVER_NAME}" MCP server now launches \`${[current.command, ...current.args].join(" ")}\`, which differs from the ` +
				"launcher AI-Hydro registered. Until you confirm, it is not treated as the first-party server " +
				"(claim-approval prompts and read-only subagent tools are off).",
			options: { items: [trust, "Dismiss"], modal: true },
		})
		if (action.selectedOption === trust) {
			await recordFirstPartyLauncher(settingsDir, current)
		}
	} catch (error) {
		console.error("[AI-Hydro] Failed to reconcile the first-party launcher record:", error)
	}
}

/** S6 migration wired to the human-facing confirmation dialog. */
async function migrateAnchor(settingsDir: string, servers: Record<string, unknown>): Promise<void> {
	try {
		const outcome = await migrateFirstPartyAnchor(settingsDir, servers, async (candidate, recorded) => {
			const trust = "Trust this server"
			const action = await HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message:
					`The "${candidate.name}" MCP server launches \`${[candidate.command, ...candidate.args].join(" ")}\`, which looks like the ` +
					`AI-Hydro launcher, but the recorded first-party server${recorded ? ` ("${recorded.name}")` : ""} is not enabled. ` +
					"Until you confirm, this server is not treated as first-party: its instructions are not sent to the model, " +
					"and claim-approval prompts and read-only subagent tools are off.",
				options: { items: [trust, "Dismiss"], modal: true },
			})
			return action.selectedOption === trust
		})
		if (outcome === "renamed" || outcome === "confirmed") {
			console.log(`[AI-Hydro] Re-pointed the first-party trust anchor (${outcome})`)
		} else if (outcome === "ambiguous") {
			console.warn("[AI-Hydro] More than one enabled first-party-shaped MCP server; the trust anchor was not changed")
		}
	} catch (error) {
		console.error("[AI-Hydro] Failed to migrate the first-party launcher record:", error)
	}
}

/**
 * Auto-detect and register the `aihydro-tools` MCP server on extension startup.
 *
 * Detection order:
 * 1. `which`/`where` aihydro-mcp (PATH lookup)
 * 2. Common pip install locations (user-level, system-level, conda)
 * 3. `python -m ai_hydro.mcp` probe (universal fallback)
 * 4. If not found → one-time install notification
 *
 * This runs once at activation, before McpHub reads the settings file.
 */
export async function ensureDefaultMcpServer(context: vscode.ExtensionContext): Promise<void> {
	try {
		// 1. Read current MCP settings
		const settingsDir = await ensureSettingsDirectoryExists()
		const settingsPath = path.join(settingsDir, GlobalFileNames.mcpSettings)

		let config: { mcpServers: Record<string, unknown> } = { mcpServers: {} }
		if (await fileExistsAtPath(settingsPath)) {
			try {
				config = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
			} catch {
				// Malformed JSON — McpHub will handle the error later
				return
			}
		}

		if (!config.mcpServers) {
			config.mcpServers = {}
		}

		// 2. Skip if already registered (but make sure the trust anchor exists for it, see below)
		if (config.mcpServers[SERVER_NAME]) {
			// The recorded server may be disabled while a legacy first-party-named entry is the one in use (S6):
			// re-point the trust anchor first (never by name alone, see planFirstPartyAnchor). A disabled
			// SERVER_NAME entry cannot be launched, so its own reconcile (and its dialogs) is skipped.
			await migrateAnchor(settingsDir, config.mcpServers)
			if ((config.mcpServers[SERVER_NAME] as { disabled?: unknown }).disabled !== true) {
				await reconcileFirstPartyLauncher(settingsDir, config.mcpServers[SERVER_NAME])
			}
			return
		}

		// 3. Detect aihydro-mcp: first try PATH, then common pip locations
		let mcpPath: string | undefined

		// 3a. PATH lookup
		const whichCmd = process.platform === "win32" ? "where" : "which"
		try {
			const result = await execa(whichCmd, ["aihydro-mcp"])
			mcpPath = result.stdout?.trim()
		} catch {
			// Not on PATH — fall through to candidate search
		}

		// 3b. Check common pip install directories
		if (!mcpPath) {
			for (const candidate of getPipScriptCandidates()) {
				if (await fileExistsAtPath(candidate)) {
					mcpPath = candidate
					console.log(`[AI-Hydro] Found aihydro-mcp at: ${candidate} (not on PATH)`)
					break
				}
			}
		}

		// 3c. Try `python -m ai_hydro.mcp` as universal fallback
		let pythonModuleFallback = false
		if (!mcpPath) {
			const pythonCandidates = process.platform === "win32" ? ["python", "python3", "py"] : ["python3", "python"]

			for (const py of pythonCandidates) {
				try {
					// Probe: import the package to verify it's installed
					await execa(py, ["-c", "import ai_hydro.mcp"])
					mcpPath = py
					pythonModuleFallback = true
					console.log(`[AI-Hydro] Found ai_hydro.mcp via: ${py} -m ai_hydro.mcp`)
					break
				} catch {
					// This python doesn't have aihydro-tools — try next
				}
			}
		}

		// 3d. Not found anywhere — prompt user
		if (!mcpPath) {
			const dismissed = context.globalState.get<boolean>("aihydroToolsPromptDismissed")
			if (!dismissed) {
				showInstallNotification(context)
			}
			return
		}

		// 4. Register the default server
		await fs.mkdir(CACHE_DIR, { recursive: true })

		const serverConfig = pythonModuleFallback
			? {
					command: mcpPath,
					args: ["-m", "ai_hydro.mcp"],
					cwd: CACHE_DIR,
					timeout: 600,
					env: {
						TMPDIR: CACHE_DIR,
						TEMP: CACHE_DIR,
						TMP: CACHE_DIR,
					},
				}
			: {
					command: mcpPath,
					args: [],
					cwd: CACHE_DIR,
					timeout: 600,
					env: {
						TMPDIR: CACHE_DIR,
						TEMP: CACHE_DIR,
						TMP: CACHE_DIR,
					},
				}

		config.mcpServers[SERVER_NAME] = serverConfig

		await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))
		// Approval redesign AP1 (B4): record the exact launcher we registered. First-party trust compares the live
		// connection against this record, so reusing the name "ai-hydro" is not enough to be trusted.
		await recordFirstPartyLauncher(settingsDir, {
			name: SERVER_NAME,
			command: serverConfig.command,
			args: serverConfig.args,
		})
		console.log("[AI-Hydro] Auto-registered aihydro-tools MCP server")
	} catch (error) {
		// Non-fatal — user can still add manually via setup_mcp.py
		console.error("[AI-Hydro] Failed to auto-register MCP server:", error)
	}
}

/**
 * Show a notification prompting the user to install the aihydro-tools Python package.
 * Marked as dismissed after any button click so it only appears once.
 */
async function showInstallNotification(context: vscode.ExtensionContext): Promise<void> {
	try {
		const installNow = "Install Now"
		const copyCommand = "Copy Command"
		const dismiss = "Dismiss"

		const action = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message:
				"The aihydro-tools Python package is required for AI-Hydro to function. " +
				"Without it, hydrological tools (watershed delineation, streamflow analysis, modelling, etc.) " +
				"will not be available. Install it now to get started.",
			options: { items: [installNow, copyCommand, dismiss] },
		})

		if (action.selectedOption === installNow) {
			await HostProvider.workspace.executeCommandInTerminal(
				ExecuteCommandInTerminalRequest.create({
					command: PIP_COMMAND,
				}),
			)
		} else if (action.selectedOption === copyCommand) {
			await HostProvider.env.clipboardWriteText({ value: PIP_COMMAND })
			await HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Copied to clipboard: ${PIP_COMMAND}`,
				options: { items: [] },
			})
		}

		// Mark as dismissed regardless of choice — user saw the prompt
		await context.globalState.update("aihydroToolsPromptDismissed", true)
	} catch (error) {
		console.error("[AI-Hydro] Failed to show install notification:", error)
	}
}
