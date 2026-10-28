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
import {
	type FirstPartyLauncher,
	planFirstPartyAnchor,
	type SettingsServerEntry,
	setRecordedFirstPartyLauncher,
} from "@shared/aihydro/firstPartyServers"
import * as fs from "fs/promises"
import { atomicWriteFile } from "./toolsEnv/atomicWrite"
import * as path from "path"

export const FIRST_PARTY_LAUNCHER_FILE = "aihydro_first_party_launcher.json"

function parseLauncher(value: unknown): FirstPartyLauncher | undefined {
	if (!value || typeof value !== "object") {
		return undefined
	}
	const { name, command, args, launchHash } = value as Record<string, unknown>
	if (
		typeof name !== "string" ||
		typeof command !== "string" ||
		!Array.isArray(args) ||
		!args.every((a) => typeof a === "string")
	) {
		return undefined
	}
	return { name, command, args: args as string[], ...(typeof launchHash === "string" ? { launchHash } : {}) }
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
	await atomicWriteFile(
		path.join(settingsDir, FIRST_PARTY_LAUNCHER_FILE),
		JSON.stringify(
			{ name: launcher.name, command: launcher.command, args: launcher.args, launchHash: launcher.launchHash },
			null,
			2,
		),
	)
	setRecordedFirstPartyLauncher(launcher)
}

export type FirstPartyAnchorMigrationOutcome = "none" | "renamed" | "confirmed" | "declined" | "ambiguous"

/**
 * Re-point the trust anchor when the recorded server is disabled/gone but exactly one enabled first-party-shaped
 * server is in use under another first-party name (session study S6; see `planFirstPartyAnchor` for the rules).
 * `confirm` is the human gate (a modal dialog in the extension); it is called only for a launch line that differs
 * from the verified record, with the exact line the user would be trusting. Host-neutral: no `vscode` import.
 *
 * `servers` is the `mcpServers` object of the settings file, read at startup. Nothing here is driven by tool
 * input or model output.
 */
export async function migrateFirstPartyAnchor(
	settingsDir: string,
	servers: Record<string, unknown>,
	confirm: (
		candidate: { name: string; command: string; args: string[] },
		recorded: FirstPartyLauncher | undefined,
	) => Promise<boolean>,
): Promise<FirstPartyAnchorMigrationOutcome> {
	const entries: SettingsServerEntry[] = Object.entries(servers ?? {}).map(([name, raw]) => {
		const e = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
		return { name, type: e.type, command: e.command, args: e.args, disabled: e.disabled, env: e.env, cwd: e.cwd }
	})
	const recorded = (await readFirstPartyLauncher(settingsDir)) ?? undefined
	const plan = planFirstPartyAnchor(entries, recorded)
	switch (plan.action) {
		case "none":
			return "none"
		case "ambiguous":
			return "ambiguous"
		case "rename": {
			await recordFirstPartyLauncher(settingsDir, {
				name: plan.candidate.name,
				command: plan.candidate.command,
				args: plan.candidate.args,
				launchHash: plan.candidate.launchHash,
			})
			return "renamed"
		}
		case "confirm": {
			const launcher = {
				name: plan.candidate.name,
				command: plan.candidate.command,
				args: plan.candidate.args,
				launchHash: plan.candidate.launchHash,
			}
			if (!(await confirm(launcher, recorded))) {
				return "declined"
			}
			await recordFirstPartyLauncher(settingsDir, launcher)
			return "confirmed"
		}
	}
}
