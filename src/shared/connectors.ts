/**
 * AI-Hydro Connectors — shared types and the built-in connector registry.
 *
 * A "connector" is a configured link from AI-Hydro to an external data source or
 * compute service (Google Earth Engine, USGS NWIS, HydroShare, etc.). Connectors
 * live in their own top-level UI panel, not in the map toolbar or the MCP panel.
 *
 * v1 ships with a static registry. A future v2 may merge with a GitHub-hosted
 * catalog at https://ai-hydro.github.io/Connectors/api/connectors.json.
 *
 * Security contract:
 *   - The webview only ever sees status + metadata, never credentials.
 *   - Tokens/keys live in vscode.SecretStorage under keys
 *     `aihydro.connectors.<connectorId>.<secretName>`.
 *   - Status (connected / disconnected) is cached in global state under
 *     `aihydro.connectors.status`, keyed by connectorId.
 */

export type ConnectorStatus = "connected" | "disconnected" | "error" | "unknown" | "coming-soon" | "built-in"

export type ConnectorAuthType = "oauth" | "api-key" | "service-account" | "none"

export interface ConnectorDefinition {
	id: string
	displayName: string
	description: string
	category: string
	/** Codicon name (without `$()`), or short emoji for the catalog tile. */
	icon: string
	authType: ConnectorAuthType
	tags: string[]
	docsUrl?: string
	comingSoon: boolean
	/**
	 * Pre-filled chat prompt for the "Set up with AI →" button. Omit for coming-soon connectors.
	 * BUILT-IN ONLY: a `setupPrompt` arriving in the remote catalog is always discarded
	 * (see `mergeConnectorCatalog`), because it would be injected into the chat as an agent prompt.
	 */
	setupPrompt?: string
	/** Action buttons. The host only ever executes the allowlisted action ids in `GEE_ACTION_COMMANDS`. */
	actions?: ConnectorAction[]
}

export interface ConnectorAction {
	/** Allowlisted action id (a key of GEE_ACTION_COMMANDS). */
	id: string
	label: string
	/** Built-in command this action maps to; always taken from GEE_ACTION_COMMANDS, never from remote JSON. */
	commandId: string
	primary?: boolean
}

/**
 * Hard-coded allowlist of connector actions: action id -> built-in VS Code command id.
 * The remote catalog may reference these command ids (live schema), but can never add to this table.
 */
export const GEE_ACTION_COMMANDS = {
	connect: "aihydro.gee.connect",
	test: "aihydro.gee.test",
	configure: "aihydro.gee.chooseProject",
	disconnect: "aihydro.gee.disconnect",
} as const

export type GeeActionId = keyof typeof GEE_ACTION_COMMANDS

export function isGeeActionId(id: unknown): id is GeeActionId {
	return typeof id === "string" && Object.hasOwn(GEE_ACTION_COMMANDS, id)
}

export interface ConnectorStatusEntry {
	status: ConnectorStatus
	lastChecked?: string
	error?: string
}

export type ConnectorStatusMap = Record<string, ConnectorStatusEntry>

/** Limits applied to the untrusted remote catalog (bytes on fetch, entries on fetch and on merge). */
export const MAX_REMOTE_CONNECTORS = 64
export const MAX_REMOTE_CATALOG_BYTES = 256 * 1024

export const CONNECTOR_STATUS_STATE_KEY = "aihydro.connectors.status"

export function secretStorageKey(connectorId: string, secretName: string): string {
	return `aihydro.connectors.${connectorId}.${secretName}`
}

// ----------------------------------------------------------------------------
// Built-in connector registry
// ----------------------------------------------------------------------------

const docs = {
	gee: "https://developers.google.com/earth-engine",
	hawqs: "https://hawqs.tamu.edu/",
	nwis: "https://waterdata.usgs.gov/",
	hydroshare: "https://www.hydroshare.org/",
	planetary: "https://planetarycomputer.microsoft.com/",
	opentopo: "https://opentopography.org/",
	earthdata: "https://www.earthdata.nasa.gov/",
}

export const BUILTIN_CONNECTORS: ConnectorDefinition[] = [
	{
		id: "google_earth_engine",
		displayName: "Google Earth Engine",
		description:
			"Cloud-scale geospatial analysis with the GEE Python API. Authenticate once and query rasters, image collections, and feature collections from MCP tools.",
		category: "remote-sensing",
		icon: "globe",
		authType: "oauth",
		tags: ["raster", "satellite", "remote-sensing", "cloud-compute"],
		docsUrl: docs.gee,
		comingSoon: false,
		setupPrompt:
			"Help me set up Google Earth Engine in AI-Hydro. I need to authenticate with my Google account, select a GEE cloud project, and verify the connection. Please walk me through the steps.",
		actions: [
			{ id: "connect", label: "Connect", commandId: GEE_ACTION_COMMANDS.connect, primary: true },
			{ id: "test", label: "Test", commandId: GEE_ACTION_COMMANDS.test },
			{ id: "configure", label: "Configure Project", commandId: GEE_ACTION_COMMANDS.configure },
			{ id: "disconnect", label: "Disconnect", commandId: GEE_ACTION_COMMANDS.disconnect },
		],
	},
	{
		id: "hawqs",
		displayName: "HAWQS",
		description:
			"Hydrologic and Water Quality System. Run SWAT-based simulations in the cloud for any 12-digit HUC in the US.",
		category: "modelling",
		icon: "beaker",
		authType: "api-key",
		tags: ["SWAT", "water-quality", "modelling", "HUC12"],
		docsUrl: docs.hawqs,
		comingSoon: true,
	},
	{
		id: "usgs_nwis",
		displayName: "USGS / NWIS",
		description:
			"USGS water data — real-time and historical streamflow, groundwater, and water-quality observations across the United States. Used anonymously by the AI-Hydro tools; no setup needed.",
		category: "data-access",
		icon: "pulse",
		authType: "none",
		tags: ["streamflow", "groundwater", "USA", "real-time"],
		docsUrl: docs.nwis,
		comingSoon: false,
		builtIn: true,
	},
	{
		id: "hydroshare",
		displayName: "HydroShare",
		description:
			"Open community platform for sharing hydrologic data and models. Pull resources, publish your AI-Hydro outputs back as citable artifacts.",
		category: "data-access",
		icon: "cloud",
		authType: "oauth",
		tags: ["data-sharing", "citation", "FAIR", "CUAHSI"],
		docsUrl: docs.hydroshare,
		comingSoon: true,
	},
	{
		id: "planetary_computer",
		displayName: "Microsoft Planetary Computer",
		description:
			"STAC-indexed environmental data — Landsat, Sentinel, NAIP, DEMs. The AI-Hydro tools read the public STAC catalog anonymously; no setup needed.",
		category: "remote-sensing",
		icon: "milestone",
		authType: "none",
		tags: ["STAC", "Landsat", "Sentinel", "Dask", "raster"],
		docsUrl: docs.planetary,
		comingSoon: false,
		builtIn: true,
	},
	{
		id: "opentopography",
		displayName: "OpenTopography",
		description:
			"High-resolution topographic data — global DEMs (SRTM, ALOS, COP), regional lidar point clouds, and on-demand processing.",
		category: "data-access",
		icon: "graph-line",
		authType: "api-key",
		tags: ["DEM", "lidar", "topography", "terrain"],
		docsUrl: docs.opentopo,
		comingSoon: true,
	},
	{
		id: "nasa_earthdata",
		displayName: "NASA Earthdata",
		description:
			"Unified search and access to NASA's Earth observation archive — MODIS, GPM, SMAP, ICESat-2, and many more datasets via DAAC.",
		category: "data-access",
		icon: "rocket",
		authType: "oauth",
		tags: ["NASA", "MODIS", "GPM", "SMAP", "satellite"],
		docsUrl: docs.earthdata,
		comingSoon: true,
	},
]

export function getConnectorById(id: string): ConnectorDefinition | undefined {
	return BUILTIN_CONNECTORS.find((c) => c.id === id)
}

// ----------------------------------------------------------------------------
// Remote catalog merge (untrusted input)
// ----------------------------------------------------------------------------

function cleanText(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, max) : undefined
}

function cleanHttpsUrl(value: unknown): string | undefined {
	const text = cleanText(value, 500)
	if (!text) {
		return undefined
	}
	try {
		return new URL(text).protocol === "https:" ? text : undefined
	} catch {
		return undefined
	}
}

function cleanActions(builtin: ConnectorAction[], remoteActions: unknown): ConnectorAction[] {
	if (!Array.isArray(remoteActions)) {
		return builtin
	}
	const builtinByCommand = new Map(builtin.map((a) => [a.commandId, a]))
	const out: ConnectorAction[] = []
	const seen = new Set<string>()
	for (const raw of remoteActions) {
		const commandId = raw && typeof raw === "object" ? (raw as { commandId?: unknown }).commandId : undefined
		if (commandId === undefined) {
			continue // label-only entries such as "docs" carry no behaviour
		}
		const known = typeof commandId === "string" ? builtinByCommand.get(commandId) : undefined
		if (!known || seen.has(known.id)) {
			console.warn(`[connectors] ignoring remote action with non-allowlisted command ${JSON.stringify(commandId)}`)
			continue
		}
		seen.add(known.id)
		// Remote may only reorder/select allowlisted actions. Label and command both come from the built-in entry,
		// so remote data cannot relabel (e.g.) Disconnect as "Test".
		out.push(known)
	}
	return out.length > 0 ? out : builtin
}

/**
 * Merge the remote connectors catalog onto the built-in registry.
 *
 * Trust model: the remote JSON is untrusted display data. It may update display text
 * (name, description, tags, category, icon, https docs link) of connectors that already
 * exist built-in, and it may select/reorder actions that map to an allowlisted command (labels stay built-in).
 * It can never supply a `setupPrompt`, change `comingSoon` / `authType`, or introduce a
 * command. Remote ids unknown to the client are shown as display-only "coming soon" cards.
 */
export function mergeConnectorCatalog(remoteCatalog: unknown, builtins: ConnectorDefinition[]): ConnectorDefinition[] {
	if (!Array.isArray(remoteCatalog) || remoteCatalog.length === 0) {
		return builtins
	}
	remoteCatalog = remoteCatalog.slice(0, MAX_REMOTE_CONNECTORS)
	const builtinById = new Map(builtins.map((c) => [c.id, c]))
	const merged: ConnectorDefinition[] = []
	const used = new Set<string>()
	for (const raw of remoteCatalog) {
		if (!raw || typeof raw !== "object") {
			continue
		}
		const r = raw as Record<string, unknown>
		const id = cleanText(r.id, 64)
		if (!id || !/^[a-z0-9_-]+$/i.test(id) || used.has(id)) {
			continue
		}
		used.add(id)
		const base = builtinById.get(id)
		const tags = Array.isArray(r.tags)
			? r.tags
					.map((t) => cleanText(t, 24))
					.filter((t): t is string => Boolean(t))
					.slice(0, 8)
			: undefined
		const icon = typeof r.icon === "string" && /^[a-z0-9-]{1,40}$/.test(r.icon) ? r.icon : undefined
		const display = {
			displayName: cleanText(r.displayName, 80),
			description: cleanText(r.description, 600),
			category: cleanText(r.category, 40),
			docsUrl: cleanHttpsUrl(r.docsUrl),
			icon,
			tags: tags && tags.length > 0 ? tags : undefined,
		}
		if (base) {
			merged.push({
				...base,
				displayName: display.displayName ?? base.displayName,
				description: display.description ?? base.description,
				category: display.category ?? base.category,
				docsUrl: display.docsUrl ?? base.docsUrl,
				icon: display.icon ?? base.icon,
				tags: display.tags ?? base.tags,
				actions: base.actions ? cleanActions(base.actions, r.actions) : undefined,
				// setupPrompt, comingSoon and authType stay exactly as built in.
			})
		} else {
			merged.push({
				id,
				displayName: display.displayName ?? id,
				description: display.description ?? "",
				category: display.category ?? "other",
				icon: display.icon ?? "plug",
				authType: "none",
				tags: display.tags ?? [],
				docsUrl: display.docsUrl,
				comingSoon: true,
			})
		}
	}
	return [...merged, ...builtins.filter((c) => !used.has(c.id))]
}
