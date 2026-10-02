import { GlobalFileNames, ensureSettingsDirectoryExists } from "@core/storage/disk"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { type McpServerEntry, nodeResolveDeps, type ResolveResult, resolveAiHydroPython } from "./resolveAiHydroPython"

/** Registered name of the aihydro MCP server (see core/mcp/ensureDefaultMcpServer.ts). */
const MCP_SERVER_NAME = "ai-hydro"

/** Read the `ai-hydro` entry from the MCP settings file; undefined if absent or unreadable. */
export async function readAiHydroMcpServer(): Promise<McpServerEntry | undefined> {
	try {
		const settingsPath = path.join(await ensureSettingsDirectoryExists(), GlobalFileNames.mcpSettings)
		const parsed = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as { mcpServers?: Record<string, McpServerEntry> }
		return parsed.mcpServers?.[MCP_SERVER_NAME]
	} catch {
		return undefined
	}
}

/**
 * Resolve the interpreter for a Python CLI that lives in the aihydro-tools package, sharing the
 * environment of the registered MCP server. `settingName` is the user-facing override.
 */
export async function resolveAiHydroPythonRuntime(params: {
	configuredPath?: string
	modules: string[]
	settingName: string
}): Promise<ResolveResult> {
	return resolveAiHydroPython({ ...params, mcpServer: await readAiHydroMcpServer() }, nodeResolveDeps)
}
