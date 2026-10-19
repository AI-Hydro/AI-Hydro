/**
 * Policy-loosening detection for the MCP settings file (approval redesign AP1, finding B3).
 *
 * The settings file holds per-server approval policy (`autoApprove`, and the reserved `trustAnnotations`,
 * `alwaysAsk`, `deny`). The agent can write that file (a file edit the user did not read closely, or a shell
 * command), and McpHub reloads it. So a change that LOOSENS policy and did not come from the UI is not applied
 * until the user confirms it; a change that tightens policy applies immediately.
 *
 * Loosening is:
 *  - a tool added to `autoApprove`;
 *  - `trustAnnotations` turned on;
 *  - a tool removed from `deny`;
 *  - a tool removed from `alwaysAsk`.
 *
 * Pure functions over plain JSON objects (the validated config or the raw file), so they are unit-tested
 * without a VS Code host (T16, T17).
 */

import * as fs from "fs/promises"

export interface ServerPolicyFields {
	autoApprove?: string[]
	trustAnnotations?: boolean
	deny?: string[]
	alwaysAsk?: string[]
}

export type ServersLike = Record<string, ServerPolicyFields & Record<string, unknown>>

export type PolicyChange =
	| { kind: "autoApprove-added"; server: string; tool: string }
	| { kind: "trust-added"; server: string }
	| { kind: "deny-removed"; server: string; tool: string }
	| { kind: "alwaysAsk-removed"; server: string; tool: string }

const asList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [])

/** Every loosening between the last accepted policy and a newly read one. */
export function findLoosenings(prev: ServersLike, next: ServersLike): PolicyChange[] {
	const changes: PolicyChange[] = []
	for (const [server, nextConfig] of Object.entries(next)) {
		const prevConfig = prev[server]
		const prevAllow = new Set(asList(prevConfig?.autoApprove))
		for (const tool of asList(nextConfig?.autoApprove)) {
			if (!prevAllow.has(tool)) {
				changes.push({ kind: "autoApprove-added", server, tool })
			}
		}
		if (nextConfig?.trustAnnotations === true && prevConfig?.trustAnnotations !== true) {
			changes.push({ kind: "trust-added", server })
		}
		if (prevConfig) {
			const nextDeny = new Set(asList(nextConfig?.deny))
			for (const tool of asList(prevConfig.deny)) {
				if (!nextDeny.has(tool)) {
					changes.push({ kind: "deny-removed", server, tool })
				}
			}
			const nextAsk = new Set(asList(nextConfig?.alwaysAsk))
			for (const tool of asList(prevConfig.alwaysAsk)) {
				if (!nextAsk.has(tool)) {
					changes.push({ kind: "alwaysAsk-removed", server, tool })
				}
			}
		}
	}
	return changes
}

/**
 * A copy of `next` with every loosening undone, except those `keep` accepts (the UI's own intended change).
 * Fields that `next` never had are not invented.
 */
export function revertLoosenings<T extends ServersLike>(
	prev: ServersLike,
	next: T,
	keep: (change: PolicyChange) => boolean = () => false,
): T {
	const result = JSON.parse(JSON.stringify(next)) as T
	for (const change of findLoosenings(prev, next)) {
		if (keep(change)) {
			continue
		}
		const config = result[change.server]
		const before = prev[change.server]
		switch (change.kind) {
			case "autoApprove-added":
				config.autoApprove = asList(config.autoApprove).filter((t) => t !== change.tool)
				break
			case "trust-added":
				if (before?.trustAnnotations === undefined) {
					delete config.trustAnnotations
				} else {
					config.trustAnnotations = before.trustAnnotations
				}
				break
			case "deny-removed":
				config.deny = [...asList(config.deny), change.tool]
				break
			case "alwaysAsk-removed":
				config.alwaysAsk = [...asList(config.alwaysAsk), change.tool]
				break
		}
	}
	return result
}

/** The policy-relevant slice of a settings object, deep-copied, for use as the "last accepted" snapshot. */
export function policySnapshot(servers: ServersLike): ServersLike {
	const snapshot: ServersLike = {}
	for (const [name, config] of Object.entries(servers)) {
		const entry: ServerPolicyFields & Record<string, unknown> = {}
		if (config.autoApprove !== undefined) {
			entry.autoApprove = asList(config.autoApprove)
		}
		if (config.trustAnnotations !== undefined) {
			entry.trustAnnotations = config.trustAnnotations
		}
		if (config.deny !== undefined) {
			entry.deny = asList(config.deny)
		}
		if (config.alwaysAsk !== undefined) {
			entry.alwaysAsk = asList(config.alwaysAsk)
		}
		snapshot[name] = entry
	}
	return snapshot
}

export function describeLoosening(change: PolicyChange): string {
	switch (change.kind) {
		case "autoApprove-added":
			return `${change.server}: auto-run ${change.tool}`
		case "trust-added":
			return `${change.server}: trust its tool annotations`
		case "deny-removed":
			return `${change.server}: stop denying ${change.tool}`
		case "alwaysAsk-removed":
			return `${change.server}: stop always asking for ${change.tool}`
	}
}

/** Rewrite the settings file at `settingsPath` with every loosening (relative to `prev`) undone. Works on the raw JSON so unknown keys survive. */
export async function revertSettingsFile(settingsPath: string, prev: ServersLike): Promise<void> {
	const raw = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
	if (raw?.mcpServers && typeof raw.mcpServers === "object") {
		raw.mcpServers = revertLoosenings(prev, raw.mcpServers as ServersLike)
		await fs.writeFile(settingsPath, JSON.stringify(raw, null, 2))
	}
}

export interface McpPolicyGateDeps {
	/** Ask the human whether to apply loosening edits. Resolves true only on an explicit yes; a dismissed dialog is no. */
	confirm(changes: PolicyChange[]): Promise<boolean>
	/** Remove the loosenings from the file on disk. */
	revertFile(prev: ServersLike): Promise<void>
}

/**
 * Holds the last ACCEPTED policy and decides what to do with new settings: a file edit that did not come from the
 * UI (the watcher) goes through `gateExternal`; a write the UI makes goes through `prepareUiWrite`. McpHub owns one.
 * Kept free of McpHub so it is unit-testable without the controller import graph.
 */
export class McpPolicyGate {
	private accepted: ServersLike | undefined

	constructor(private readonly deps: McpPolicyGateDeps) {}

	/** The settings found at startup are the baseline: the extension cannot know who wrote the file while it was off. */
	setBaseline(servers: ServersLike): void {
		this.accepted = policySnapshot(servers)
	}

	get baselineSet(): boolean {
		return this.accepted !== undefined
	}

	/** Servers to apply for a watcher-detected edit. Tightening applies; loosening needs confirmation, else is reverted. */
	async gateExternal<T extends Record<string, unknown>>(next: T): Promise<T> {
		const nextPolicy = next as unknown as ServersLike
		const prev = this.accepted
		if (!prev) {
			this.accepted = policySnapshot(nextPolicy)
			return next
		}
		const loosenings = findLoosenings(prev, nextPolicy)
		if (loosenings.length === 0 || (await this.deps.confirm(loosenings))) {
			this.accepted = policySnapshot(nextPolicy)
			return next
		}
		await this.deps.revertFile(prev)
		const sanitized = revertLoosenings(prev, nextPolicy) as unknown as T
		this.accepted = policySnapshot(sanitized as unknown as ServersLike)
		return sanitized
	}

	/**
	 * The object a UI-originated change should write. The UI's own intended autoApprove additions are accepted; any
	 * OTHER loosening still present (an agent edit the watcher has not processed yet) is reverted instead of being
	 * laundered into the accepted baseline. Call `accept` with what was actually written.
	 */
	prepareUiWrite<C extends { mcpServers?: Record<string, any> }>(config: C, intended?: { server: string; tools: string[] }): C {
		const prev = this.accepted
		if (!prev || !config.mcpServers) {
			return config
		}
		const keep = (change: PolicyChange) =>
			intended !== undefined &&
			change.kind === "autoApprove-added" &&
			change.server === intended.server &&
			intended.tools.includes(change.tool)
		if (!findLoosenings(prev, config.mcpServers).some((change) => !keep(change))) {
			return config
		}
		console.warn("[McpHub] Reverted an unconfirmed policy-loosening edit while saving a settings change")
		return { ...config, mcpServers: revertLoosenings(prev, config.mcpServers, keep) }
	}

	accept(servers: ServersLike | undefined): void {
		if (servers) {
			this.accepted = policySnapshot(servers)
		}
	}
}
