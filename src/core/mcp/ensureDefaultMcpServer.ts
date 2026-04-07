import { ensureSettingsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { execa } from "@packages/execa"
import { fileExistsAtPath } from "@utils/fs"
import * as fs from "fs/promises"
import os from "os"
import * as path from "path"

const SERVER_NAME = "ai-hydro"
const CACHE_DIR = path.join(os.homedir(), ".aihydro", "cache")

/**
 * Auto-detect and register the `aihydro-tools` MCP server on extension startup.
 *
 * - If the `ai-hydro` server is already in settings → skip (respect user config).
 * - If `aihydro-mcp` console script is found on PATH → register it.
 * - If not found → silently skip (user can install manually).
 *
 * This runs once at activation, before McpHub reads the settings file.
 */
export async function ensureDefaultMcpServer(): Promise<void> {
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
			// Not installed — silently skip
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
