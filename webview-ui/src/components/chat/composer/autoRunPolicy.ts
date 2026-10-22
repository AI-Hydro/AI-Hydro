import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpServer } from "@shared/mcp"
import { ACTION_METADATA } from "../auto-approve-menu/constants"

export interface AutoRunPolicy {
	/** Master switch (`enableAutoApprove`). */
	enabled: boolean
	/** Short names of what auto-runs, in menu order, e.g. ["Read", "Edit", "MCP"]. Sub-actions replace their parent. */
	labels: string[]
	/** MCP tools (on enabled servers) with a per-tool "always allow" grant, independent of the `useMcp` action. */
	mcpAlwaysAllowed: number
	/** Plain-language risky grants. Empty means nothing risky. */
	riskReasons: string[]
	risky: boolean
	/** "Auto-run: Read, Edit, MCP" (no risk marker; the chip adds an icon and "(risky)" text). */
	chipText: string
	/** Full policy as a sentence, used for the accessible name. */
	summary: string
}

/** Meta toggles in ACTION_METADATA that are not actions themselves. */
const META_IDS = new Set(["enableAutoApprove", "enableAll"])

/**
 * Derives the composer's auto-run policy from the existing settings. The action list and short names come from
 * `auto-approve-menu/constants.ts` so the chip can never drift from the menu. Risky grants are those that widen
 * what runs without asking beyond the workspace or beyond a read-only filter: edit any file, run any command,
 * every action on at once, and per-server MCP tool "always allow".
 */
export function deriveAutoRunPolicy(settings: AutoApprovalSettings, mcpServers: McpServer[] = []): AutoRunPolicy {
	const actions = (settings.actions ?? {}) as Record<string, boolean | undefined>
	const enabled = settings.enabled !== false

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

	const mcpAlwaysAllowed = mcpServers
		.filter((s) => !s.disabled)
		.reduce((n, s) => n + (s.tools ?? []).filter((t) => t.autoApprove === true).length, 0)

	const riskReasons: string[] = []
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
		if (actions.executeAllCommands) {
			riskReasons.push("runs any terminal command without asking")
		}
	}
	if (mcpAlwaysAllowed > 0) {
		riskReasons.push(`${mcpAlwaysAllowed} MCP ${mcpAlwaysAllowed === 1 ? "tool" : "tools"} always allowed`)
	}

	const chipText = !enabled ? "Auto-run: off" : labels.length === 0 ? "Auto-run: none" : `Auto-run: ${labels.join(", ")}`
	const risky = riskReasons.length > 0
	const summary = `${chipText}${risky ? `. Risky: ${riskReasons.join("; ")}` : ""}`
	return { enabled, labels, mcpAlwaysAllowed, riskReasons, risky, chipText, summary }
}
