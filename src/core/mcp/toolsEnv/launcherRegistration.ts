/**
 * Registering the managed environment's `aihydro-mcp` as the first-party MCP server, and recording it as the trust
 * anchor (X0-3). Trust is never widened silently:
 *  - no previous record: the launcher registered here is recorded (the existing first-registration behaviour);
 *  - a record that matches: nothing to do;
 *  - a record that differs: the user must confirm in `confirmTrust` (a modal in the extension). Declining leaves the
 *    entry registered and untrusted.
 *
 * Host-neutral: no `vscode` import; the human gate and the file locations are injected.
 */
import {
	explainServerTrust,
	FIRST_PARTY_SERVER_NAMES,
	launchContextHash,
	looksLikeFirstPartyLauncher,
} from "@shared/aihydro/firstPartyServers"
import type { ToolsTrustVerdict } from "@shared/aihydro/toolsEnv"
import * as fs from "fs/promises"
import { atomicWriteFile } from "./atomicWrite"
import { loadFirstPartyLauncher, readFirstPartyLauncher, recordFirstPartyLauncher } from "../firstPartyLauncher"

export const DEFAULT_SERVER_NAME = "ai-hydro"

export interface McpSettingsFile {
	mcpServers: Record<string, Record<string, unknown>>
	[key: string]: unknown
}

export type ReadSettingsResult = { ok: true; config: McpSettingsFile; existed: boolean } | { ok: false; error: string }

export async function readMcpSettings(settingsPath: string): Promise<ReadSettingsResult> {
	const first = await readMcpSettingsOnce(settingsPath)
	if (first.ok || first.retryable !== true) {
		return first.ok ? first : { ok: false, error: first.error }
	}
	// Another writer may have been mid-write: one short retry before reporting the file unreadable.
	await new Promise((resolve) => setTimeout(resolve, 150))
	const second = await readMcpSettingsOnce(settingsPath)
	return second.ok ? second : { ok: false, error: second.error }
}

async function readMcpSettingsOnce(
	settingsPath: string,
): Promise<{ ok: true; config: McpSettingsFile; existed: boolean } | { ok: false; error: string; retryable?: boolean }> {
	let text: string
	try {
		text = await fs.readFile(settingsPath, "utf-8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { ok: true, config: { mcpServers: {} }, existed: false }
		}
		return { ok: false, error: error instanceof Error ? error.message : String(error) }
	}
	try {
		const parsed = JSON.parse(text)
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { ok: false, error: "The MCP settings file is not a JSON object." }
		}
		if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
			parsed.mcpServers = {}
		}
		return { ok: true, config: parsed, existed: true }
	} catch {
		// Malformed JSON: McpHub reports it; never overwrite the user's file.
		return { ok: false, error: "The MCP settings file is not valid JSON.", retryable: true }
	}
}

/** The key of the first-party server entry: the default name first, then any other first-party name. */
export function findFirstPartyEntryName(servers: Record<string, unknown>): string | undefined {
	if (servers[DEFAULT_SERVER_NAME]) {
		return DEFAULT_SERVER_NAME
	}
	return Object.keys(servers).find((name) => FIRST_PARTY_SERVER_NAMES.has(name.trim().toLowerCase()) && !!servers[name])
}

export type LauncherClass = "none" | "managed" | "custom-working" | "custom-broken" | "non-standard"

function entryCommand(entry: Record<string, unknown> | undefined): { command: string; args: string[] } {
	const args = Array.isArray(entry?.args) ? (entry.args as unknown[]).filter((a): a is string => typeof a === "string") : []
	return { command: typeof entry?.command === "string" ? entry.command : "", args }
}

function sameFile(a: string, b: string, platform: NodeJS.Platform): boolean {
	return platform === "win32" ? a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase() : a === b
}

/** How an existing registration relates to the managed launcher. */
export async function classifyLauncher(
	entry: Record<string, unknown> | undefined,
	managedCommand: string,
	deps: { platform: NodeJS.Platform; pathExists(p: string): Promise<boolean> },
): Promise<LauncherClass> {
	if (!entry) {
		return "none"
	}
	const { command, args } = entryCommand(entry)
	if (command && args.length === 0 && sameFile(command, managedCommand, deps.platform)) {
		return "managed"
	}
	if (!looksLikeFirstPartyLauncher(command, args)) {
		return "non-standard"
	}
	const absolute = /^([A-Za-z]:)?[\\/]/.test(command)
	if (absolute && !(await deps.pathExists(command))) {
		return "custom-broken"
	}
	return "custom-working"
}

export type RecordOutcome = "recorded" | "unchanged" | "confirmed" | "declined"

export interface RegisterOptions {
	settingsDir: string
	settingsPath: string
	managedCommand: string
	/** Where the registered server runs and keeps temp files (the existing registration used `~/.aihydro/cache`). */
	cacheDir: string
	/** Rewrite an existing, different first-party command to the managed one. Only true after the caller decided so. */
	switchExisting: boolean
	/** A record was written on this machine before (marker), so an absent one is a loss to confirm, not a first run. */
	recordExisted?: boolean
	/** The human gate for a launcher that differs from the recorded one. Never answered by the model. */
	confirmTrust: (
		launcher: { name: string; command: string; args: string[] },
		recorded: { command: string; args: string[] } | undefined,
	) => Promise<boolean>
}

export interface RegisterResult {
	serverName: string
	wrote: boolean
	switchedFrom?: string
	record: RecordOutcome
}

function managedEntry(cacheDir: string, managedCommand: string): Record<string, unknown> {
	return {
		command: managedCommand,
		args: [],
		cwd: cacheDir,
		timeout: 600,
		env: { TMPDIR: cacheDir, TEMP: cacheDir, TMP: cacheDir },
	}
}

/**
 * Make the first-party server entry launch the managed `aihydro-mcp`, and reconcile the trust record.
 * Throws only when the settings file cannot be read safely (callers surface SETTINGS_UNREADABLE).
 */
export async function registerManagedLauncher(options: RegisterOptions): Promise<RegisterResult> {
	const read = await readMcpSettings(options.settingsPath)
	if (!read.ok) {
		throw new Error(read.error)
	}
	const { config } = read
	const existingName = findFirstPartyEntryName(config.mcpServers)
	const serverName = existingName ?? DEFAULT_SERVER_NAME
	const existing = existingName ? config.mcpServers[existingName] : undefined
	let wrote = false
	let switchedFrom: string | undefined

	if (!existing) {
		config.mcpServers[serverName] = managedEntry(options.cacheDir, options.managedCommand)
		wrote = true
	} else if (entryCommand(existing).command !== options.managedCommand || entryCommand(existing).args.length > 0) {
		if (options.switchExisting) {
			switchedFrom = [entryCommand(existing).command, ...entryCommand(existing).args].join(" ")
			const env = { ...((existing.env as Record<string, string> | undefined) ?? {}) }
			// These would redirect the managed interpreter back to another environment.
			delete env.PYTHONPATH
			delete env.PYTHONHOME
			config.mcpServers[serverName] = { ...existing, command: options.managedCommand, args: [], env }
			wrote = true
		}
	}
	if (wrote) {
		await atomicWriteFile(options.settingsPath, JSON.stringify(config, null, 2))
	}

	const entry = config.mcpServers[serverName]
	const current = {
		name: serverName,
		command: entryCommand(entry).command,
		args: entryCommand(entry).args,
		launchHash: launchContextHash({ env: entry.env, cwd: entry.cwd }),
	}
	const record = await reconcileLauncherRecord(options.settingsDir, current, options.confirmTrust, {
		recordExisted: options.recordExisted,
	})
	return { serverName, wrote, switchedFrom, record }
}

export interface ReconcileOptions {
	/** Always show the confirmation unless the launcher already equals the record. Used by the explicit "trust" action. */
	forceConfirm?: boolean
	/** A record existed before (marker), so an absent one needs confirmation instead of silent first-run recording. */
	recordExisted?: boolean
}

/**
 * Compare a registered launcher with the recorded one.
 * Same: nothing. No record: record it silently ONLY on a genuine first registration (never with `forceConfirm`, never when
 * a record is known to have existed). Otherwise record only after `confirmTrust` returns true. A declined confirmation
 * leaves the old record and loads it into memory.
 */
export async function reconcileLauncherRecord(
	settingsDir: string,
	current: { name: string; command: string; args: string[]; launchHash: string },
	confirmTrust: RegisterOptions["confirmTrust"],
	options: ReconcileOptions = {},
): Promise<RecordOutcome> {
	const recorded = await readFirstPartyLauncher(settingsDir)
	if (
		recorded &&
		recorded.name === current.name &&
		recorded.command === current.command &&
		recorded.args.length === current.args.length &&
		recorded.args.every((a, i) => a === current.args[i]) &&
		(recorded.launchHash ?? launchContextHash({})) === current.launchHash
	) {
		await loadFirstPartyLauncher(settingsDir) // install the anchor in memory; the file is unchanged
		return "unchanged"
	}
	if (!recorded && !options.forceConfirm && !options.recordExisted) {
		await recordFirstPartyLauncher(settingsDir, current)
		return "recorded"
	}
	if (await confirmTrust({ name: current.name, command: current.command, args: current.args }, recorded)) {
		await recordFirstPartyLauncher(settingsDir, current)
		return "confirmed"
	}
	await loadFirstPartyLauncher(settingsDir)
	return "declined"
}

export interface TrustSnapshot {
	serverName: string
	serverCommand: string
	trust: ToolsTrustVerdict
	reason: string
}

/** The trust verdict for what is registered right now, from the same evaluation the MCP hub uses. */
export async function readTrustSnapshot(settingsDir: string, settingsPath: string): Promise<TrustSnapshot> {
	const read = await readMcpSettings(settingsPath)
	if (!read.ok) {
		return { serverName: "", serverCommand: "", trust: "unregistered", reason: read.error }
	}
	const name = findFirstPartyEntryName(read.config.mcpServers)
	if (!name) {
		return { serverName: "", serverCommand: "", trust: "unregistered", reason: "No AI-Hydro server is registered." }
	}
	const entry = read.config.mcpServers[name]
	const { command, args } = entryCommand(entry)
	const recorded = await readFirstPartyLauncher(settingsDir)
	const verdict = explainServerTrust(
		{ name, config: JSON.stringify({ type: "stdio", command, args, env: entry.env, cwd: entry.cwd }) },
		recorded,
	)
	return {
		serverName: name,
		serverCommand: [command, ...args].join(" "),
		trust: verdict.trusted ? "trusted" : "untrusted",
		reason: verdict.reason,
	}
}
