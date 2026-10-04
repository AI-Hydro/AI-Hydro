import { ensureSettingsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { fileExistsAtPath } from "@utils/fs"
import crypto from "crypto"
import * as fs from "fs/promises"
import os from "os"
import * as path from "path"

const SERVER_NAME = "ai-hydro"

export interface AihydroStdioServerConfig {
	command: string
	args?: string[]
	cwd?: string
	env?: Record<string, string>
	[key: string]: unknown
}

/**
 * Read the ai-hydro server entry from the SAME persisted settings file
 * McpHub reads (written once by ensureDefaultMcpServer.ts on extension
 * activation) — one source of truth, no duplicate detection logic. Shared by
 * writeEngineMcpConfig (claude's --mcp-config file) and CodexEngine's
 * mcp_servers.* override args, which need the raw fields, not a file path.
 */
export async function readAihydroServerConfig(): Promise<AihydroStdioServerConfig> {
	const settingsDir = await ensureSettingsDirectoryExists()
	const settingsPath = path.join(settingsDir, GlobalFileNames.mcpSettings)

	if (!(await fileExistsAtPath(settingsPath))) {
		throw new Error(
			`No MCP settings found at ${settingsPath}. The "${SERVER_NAME}" server has not been detected/registered yet ` +
				`(ensureDefaultMcpServer runs on extension activation) — open the extension once before using engine mode.`,
		)
	}

	const config = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as {
		mcpServers?: Record<string, unknown>
	}
	const serverConfig = config.mcpServers?.[SERVER_NAME] as AihydroStdioServerConfig | undefined
	if (!serverConfig) {
		throw new Error(`"${SERVER_NAME}" is not registered in ${settingsPath}. Install aihydro-tools and reload the extension.`)
	}
	return serverConfig
}

/** Emit a minimal single-server MCP config JSON file for claude's --mcp-config flag. */
export async function writeEngineMcpConfig(): Promise<string> {
	const serverConfig = await readAihydroServerConfig()
	const engineConfig = { mcpServers: { [SERVER_NAME]: serverConfig } }
	// Caller is responsible for cleanup once a task-loop caller exists;
	// nothing invokes this yet, so premature disposal logic has no consumer to test against.
	const outPath = path.join(os.tmpdir(), `aihydro-engine-mcp-${crypto.randomUUID()}.json`)
	await fs.writeFile(outPath, JSON.stringify(engineConfig, null, 2), "utf-8")
	return outPath
}
