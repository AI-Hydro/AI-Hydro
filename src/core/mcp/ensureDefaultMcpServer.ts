import { ensureSettingsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { execa } from "@packages/execa"
import { ShowMessageType } from "@shared/proto/host/window"
import { ExecuteCommandInTerminalRequest } from "@shared/proto/host/workspace"
import { fileExistsAtPath } from "@utils/fs"
import * as fs from "fs/promises"
import os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"

const SERVER_NAME = "ai-hydro"
const CACHE_DIR = path.join(os.homedir(), ".aihydro", "cache")
const PIP_COMMAND = "pip install aihydro-tools[all,mcp]"

/**
 * Auto-detect and register the `aihydro-tools` MCP server on extension startup.
 *
 * - If the `ai-hydro` server is already in settings → skip (respect user config).
 * - If `aihydro-mcp` console script is found on PATH → register it.
 * - If not found → show a one-time notification prompting the user to install.
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

		// 2. Skip if already registered
		if (config.mcpServers[SERVER_NAME]) {
			return
		}

		// 3. Detect aihydro-mcp on PATH
		const whichCmd = process.platform === "win32" ? "where" : "which"
		let mcpPath: string | undefined
		try {
			const result = await execa(whichCmd, ["aihydro-mcp"])
			mcpPath = result.stdout?.trim()
		} catch {
			// Not installed — prompt user if not previously dismissed
			const dismissed = context.globalState.get<boolean>("aihydroToolsPromptDismissed")
			if (!dismissed) {
				// Fire-and-forget: don't block extension activation
				showInstallNotification(context)
			}
			return
		}

		if (!mcpPath) {
			return
		}

		// 4. Register the default server
		await fs.mkdir(CACHE_DIR, { recursive: true })
		config.mcpServers[SERVER_NAME] = {
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

		await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))
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
