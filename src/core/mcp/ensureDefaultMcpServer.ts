import { ensureSettingsDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { aihydroPath } from "@shared/aihydro/aihydroHome"
import { ShowMessageType } from "@shared/proto/host/window"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { createVscodeToolsEnv } from "@/hosts/vscode/VscodeToolsEnv"
import { HostProvider } from "@/hosts/host-provider"
import { migrateFirstPartyAnchor } from "./firstPartyLauncher"
import { findFirstPartyEntryName, readMcpSettings } from "./toolsEnv/launcherRegistration"

const CACHE_DIR = aihydroPath("cache")
const ACTIVE_WORKSPACE_FILE = aihydroPath("active_workspace.json")

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
 * Start the managed tools environment at activation (X0-3). It registers the managed `aihydro-mcp` as the
 * first-party MCP server when the environment is already on disk, reconciles the first-party trust record (a
 * changed launcher always needs the user's confirmation), and verifies or installs the environment in the
 * background with a cancellable progress notification. A failed install stays visible and retryable on the Welcome
 * and sidebar status chip, the status bar item and `AI-Hydro: Show Tools Log`; there is no permanent dismissal.
 *
 * This runs once at activation, before McpHub reads the settings file.
 */
export async function ensureDefaultMcpServer(context: vscode.ExtensionContext): Promise<void> {
	try {
		const settingsDir = await ensureSettingsDirectoryExists()
		const settingsPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
		await fs.mkdir(CACHE_DIR, { recursive: true })

		const settings = await readMcpSettings(settingsPath)
		if (settings.ok && findFirstPartyEntryName(settings.config.mcpServers)) {
			// The recorded server may be disabled while a legacy first-party-named entry is the one in use (S6):
			// re-point the trust anchor first (never by name alone, see planFirstPartyAnchor).
			await migrateAnchor(settingsDir, settings.config.mcpServers)
		}

		const controller = createVscodeToolsEnv(context, {
			venvsDir: aihydroPath("venvs"),
			settingsDir,
			settingsPath,
			cacheDir: CACHE_DIR,
		})
		await controller.startup()
	} catch (error) {
		// Non-fatal: the status chip and the install commands stay available.
		console.error("[AI-Hydro] Failed to start the tools environment:", error)
	}
}
