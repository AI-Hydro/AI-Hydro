import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { type AlwaysAllowRefusalReason, alwaysAllowVerdict } from "@shared/aihydro/alwaysAllowPolicy"
import type { McpServer } from "@shared/mcp"
import { ACTION_METADATA } from "../auto-approve-menu/constants"

export interface AutoRunPolicy {
	/** Master switch (`enableAutoApprove`). */
	enabled: boolean
	/** Short names of what auto-runs, in menu order, e.g. ["Read", "Edit", "MCP"]. Sub-actions replace their parent. */
	labels: string[]
	/** MCP tools (on enabled servers) with a per-tool "always allow" grant the host would honour when the tool runs. */
	mcpAlwaysAllowed: number
	/** Granted tools the host's run-time recheck (M-3) pauses: trust lost, destructive now, not listed once. They ask. */
	mcpPaused: number
	/** True when those grants cannot fire right now (auto-run or MCP auto-run is off). Still flagged: over-warning is safe. */
	mcpDormant: boolean
	/** Why each paused grant is paused: reason -> number of tools. Empty when none are paused. */
	mcpPausedReasons: Partial<Record<AlwaysAllowRefusalReason, number>>
	/** Visible text for the MCP grants ("2 MCP tools always allowed"), or "" when none. */
	mcpLabel: string
	/** Global YOLO mode (`yoloModeToggled`): core approves everything first, regardless of `enabled`. */
	yolo: boolean
	/** Plain-language risky grants. Empty means nothing risky. */
	riskReasons: string[]
	risky: boolean
	/** "Auto-run: Read, Edit, MCP" (no risk marker; the popover lists it, the compact chip shows a count instead). */
	chipText: string
	/** The one-line form for the composer chip: "Auto-run: 5 on", "Auto-run: off", "YOLO". The chip adds the risk marker. */
	compactText: string
	/** Full policy as a sentence, used for the accessible name. */
	summary: string
}

/**
 * Why a per-tool "always allow" grant cannot fire right now, or undefined when it can. The one wording shared by the
 * composer chip (mcpLabel) and the inline approval's "Always" button. Core honours YOLO first, so a grant is never
 * inactive under it.
 */
export function mcpGrantInactiveReason(settings: AutoApprovalSettings, yolo = false): string | undefined {
	if (yolo) {
		return undefined
	}
	const actions = (settings.actions ?? {}) as Record<string, boolean | undefined>
	if (!settings.enabled) {
		return "inactive while auto-run is off"
	}
	return actions.useMcp ? undefined : "inactive while MCP auto-run is off"
}

/** Meta toggles in ACTION_METADATA that are not actions themselves. */
const META_IDS = new Set(["enableAutoApprove", "enableAll"])

/**
 * Derives the composer's auto-run policy from the existing settings. The action list and short names come from
 * `auto-approve-menu/constants.ts` so the chip can never drift from the menu. Risky grants are those that widen
 * what runs without asking beyond the workspace or beyond a read-only filter: edit any file, run any command,
 * every action on at once, and per-server MCP tool "always allow".
 */
export function deriveAutoRunPolicy(settings: AutoApprovalSettings, mcpServers: McpServer[] = [], yolo = false): AutoRunPolicy {
	const actions = (settings.actions ?? {}) as Record<string, boolean | undefined>
	// Truthiness, as in core (src/core/task/tools/autoApprove.ts).
	const enabled = !!settings.enabled

	const labels: string[] = []
	for (const meta of ACTION_METADATA) {
		if (META_IDS.has(meta.id)) {
			continue
		}
		if (!actions[meta.id]) {
			continue
		}
		const sub = meta.subAction
		labels.push(sub && actions[sub.id] ? sub.shortName : meta.shortName)
	}

	// The host rechecks every grant when the tool runs (alwaysAllowVerdict, M-3). A grant it would pause asks instead
	// of auto-running, so it is labelled "paused" and is not a risk. Only judged when the server's trust verdict
	// reached the webview; without it the grant counts as active (over-warning is the safe side).
	let mcpAlwaysAllowed = 0
	let mcpPaused = 0
	const mcpPausedReasons: AlwaysAllowRefusalReason[] = []
	for (const s of mcpServers.filter((srv) => !srv.disabled)) {
		for (const t of (s.tools ?? []).filter((tool) => tool.autoApprove === true)) {
			const verdict =
				s.trust !== undefined
					? alwaysAllowVerdict({
							serverTrusted: s.trust.trusted,
							serverConnected: s.status === "connected",
							tools: s.tools,
							toolName: t.name,
						})
					: undefined
			if (verdict && !verdict.ok) {
				mcpPaused++
				mcpPausedReasons.push(verdict.reason)
			} else {
				mcpAlwaysAllowed++
			}
		}
	}

	const riskReasons: string[] = []
	if (yolo) {
		// Core honours YOLO first and approves everything, even when auto-run is switched off.
		riskReasons.push(
			"YOLO mode is on: everything auto-runs, even when auto-run is off, except MCP tools without a working Always grant",
		)
	}
	if (enabled) {
		// "Toggle all" / YOLO: every action in the menu, sub-actions included, is on.
		const allIds = ACTION_METADATA.filter((m) => !META_IDS.has(m.id)).flatMap((m) => [m.id, m.subAction?.id])
		const allOn = allIds.every((id) => !id || actions[id] === true)
		if (allOn) {
			riskReasons.push("all actions auto-run")
		}
		if (actions.editFilesExternally) {
			riskReasons.push("edits any file on your computer without asking")
		}
		// Core gates "all commands" on the safe-commands grant too (commandPolicy: !autoApproveSafe asks first).
		if (actions.executeAllCommands && actions.executeSafeCommands) {
			riskReasons.push("runs any terminal command without asking")
		}
	}
	const inactiveReason = mcpGrantInactiveReason(settings, yolo)
	const mcpDormant = mcpAlwaysAllowed > 0 && inactiveReason !== undefined
	const noun = mcpAlwaysAllowed === 1 ? "tool" : "tools"
	const activeLabel =
		mcpAlwaysAllowed === 0
			? ""
			: mcpDormant
				? `${mcpAlwaysAllowed} MCP ${noun} set to always allow (${inactiveReason})`
				: `${mcpAlwaysAllowed} MCP ${noun} always allowed`
	if (activeLabel) {
		riskReasons.push(activeLabel)
	}
	const pausedLabel = mcpPaused === 0 ? "" : `${mcpPaused} MCP ${mcpPaused === 1 ? "tool" : "tools"} paused (asks first)`
	const mcpLabel = [activeLabel, pausedLabel].filter(Boolean).join(", ")

	const chipText = yolo
		? "YOLO: auto-runs all but MCP tools without a working Always"
		: !enabled
			? "Auto-run: off"
			: labels.length === 0
				? "Auto-run: none"
				: `Auto-run: ${labels.join(", ")}`
	const compactText = yolo
		? "YOLO"
		: !enabled
			? "Auto-run: off"
			: labels.length === 0
				? "Auto-run: none"
				: `Auto-run: ${labels.length} on`
	const risky = riskReasons.length > 0
	const pausedByReason: Partial<Record<AlwaysAllowRefusalReason, number>> = {}
	for (const reason of mcpPausedReasons) {
		pausedByReason[reason] = (pausedByReason[reason] ?? 0) + 1
	}
	const summary = `${chipText}${risky ? `. Risky: ${riskReasons.join("; ")}` : ""}`
	return {
		enabled,
		labels,
		mcpAlwaysAllowed,
		mcpPaused,
		mcpPausedReasons: pausedByReason,
		mcpDormant,
		mcpLabel,
		yolo,
		riskReasons,
		risky,
		chipText,
		compactText,
		summary,
	}
}
