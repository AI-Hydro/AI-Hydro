/**
 * Persistence for the first-party launcher record (approval redesign AP1, finding B4).
 *
 * `ensureDefaultMcpServer` records the exact command/args it registers for the first-party server. The record
 * lives in the extension's settings directory, which is a protected path: agent file writes and commands that
 * mention it always ask. It is loaded once at startup into `setRecordedFirstPartyLauncher`; editing the file
 * mid-session changes nothing until the next start, and then only for a human-approved edit.
 *
 * Host/CLI-neutral: no `vscode` import, so the standalone and CLI hosts load it the same way.
 */
import { type FirstPartyLauncher, setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import * as fs from "fs/promises"
import * as path from "path"

export const FIRST_PARTY_LAUNCHER_FILE = "aihydro_first_party_launcher.json"

function parseLauncher(value: unknown): FirstPartyLauncher | undefined {
	if (!value || typeof value !== "object") {
		return undefined
	}
	const { name, command, args } = value as Record<string, unknown>
	if (
		typeof name !== "string" ||
		typeof command !== "string" ||
		!Array.isArray(args) ||
		!args.every((a) => typeof a === "string")
	) {
		return undefined
	}
	return { name, command, args: args as string[] }
}

/** Read the record without installing it. Missing or malformed means no record (fail closed). */
export async function readFirstPartyLauncher(settingsDir: string): Promise<FirstPartyLauncher | undefined> {
	try {
		return parseLauncher(JSON.parse(await fs.readFile(path.join(settingsDir, FIRST_PARTY_LAUNCHER_FILE), "utf-8")))
	} catch {
		return undefined
	}
}

/** Load the record from disk and install it as the process's trust anchor. */
export async function loadFirstPartyLauncher(settingsDir: string): Promise<FirstPartyLauncher | undefined> {
	const launcher = await readFirstPartyLauncher(settingsDir)
	setRecordedFirstPartyLauncher(launcher)
	return launcher
}

/** Persist and install a record. Call only from registration or an explicit user action in the UI. */
export async function recordFirstPartyLauncher(settingsDir: string, launcher: FirstPartyLauncher): Promise<void> {
	await fs.mkdir(settingsDir, { recursive: true })
	await fs.writeFile(
		path.join(settingsDir, FIRST_PARTY_LAUNCHER_FILE),
		JSON.stringify({ name: launcher.name, command: launcher.command, args: launcher.args }, null, 2),
	)
	setRecordedFirstPartyLauncher(launcher)
}
