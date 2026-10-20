/**
 * Map workspace persistence — localStorage-backed.
 *
 * Stores per-user UI state (basemap, view, layer visibility, panel layout)
 * so the map opens in the same configuration it was last left in.
 *
 * Schema is versioned so we can evolve it without breaking older saves.
 *
 *   v1  no record of whether the basemap was chosen by the user or was just the code default. A default can
 *       never be changed for such profiles, because a saved v1 basemap is indistinguishable from a choice.
 *   v2  adds `basemapExplicit`. The one-time v1 -> v2 migration (`migrateWorkspace`) moves every existing
 *       profile to the muted hydrology default (decision D1); from then on only an explicit user choice is
 *       kept, and "Reset to hydrology default" clears it.
 */

import { DEFAULT_BASEMAP_ID, isKnownBaseMap } from "./basemaps"

import type { MapViewState } from "@deck.gl/core"

const STORAGE_KEY = "aihydro.map.workspace.v1"

/** @deprecated Kept for old localStorage payloads only — the ribbon is fixed-position. */
export type DockSide = "left" | "right" | "floating" | "collapsed"

/** Session ROI until MCP pushes authoritative ROIContract geometry. */
export interface ActiveRoi {
	id?: string
	name?: string
	source?: string
	/** Hectares when known */
	areaHa?: number
}

/** A named saved view bookmark. */
export interface MapBookmark {
	id: string
	name: string
	longitude: number
	latitude: number
	zoom: number
	pitch?: number
	bearing?: number
	createdAt: string // ISO timestamp
}

export const MAP_WORKSPACE_VERSION = 2

export interface MapWorkspace {
	version: typeof MAP_WORKSPACE_VERSION
	basemap?: string
	/** True only when the user picked `basemap` (or loaded a saved scene). Otherwise the default applies. */
	basemapExplicit?: boolean
	viewState?: MapViewState
	visibleLayerIds?: string[]
	layerOpacities?: Record<string, number>
	clusterLayerIds?: string[]
	activeRoi?: ActiveRoi
	layerPanel?: {
		showDetails: boolean
	}
	/** User-facing display names keyed by layer id (does not change server layer name). */
	layerAliases?: Record<string, string>
	ribbonPanel?: {
		width?: number
		height?: number
	}
	/** Named saved view bookmarks. */
	bookmarks?: MapBookmark[]
}

const DEFAULT_WORKSPACE: MapWorkspace = {
	version: MAP_WORKSPACE_VERSION,
	layerPanel: {
		showDetails: false,
	},
}

export const DEFAULT_MAP_VIEW: MapViewState = {
	longitude: -95,
	latitude: 40,
	zoom: 4,
	pitch: 0,
	bearing: 0,
}

function finiteCamera(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/** deck.gl FlyToInterpolator instances expose _propsToCompare; JSON `{}` does not. */
function hasLiveTransitionInterpolator(vs: MapViewState | undefined): boolean {
	const ti = (vs as MapViewState & { transitionInterpolator?: unknown })?.transitionInterpolator
	return !!(ti && typeof ti === "object" && Array.isArray((ti as unknown as { _propsToCompare?: unknown })._propsToCompare))
}

/** FlyToInterpolator and other deck.gl classes do not survive JSON in localStorage. */
export function sanitizePersistedViewState(vs: MapViewState | undefined): MapViewState | undefined {
	if (!vs || typeof vs !== "object" || Array.isArray(vs)) {
		return undefined
	}
	// Keep only the safe scalar camera properties — strip ANY class instances / functions.
	const longitude = typeof (vs as any).longitude === "number" ? (vs as any).longitude : undefined
	const latitude = typeof (vs as any).latitude === "number" ? (vs as any).latitude : undefined
	const zoom = typeof (vs as any).zoom === "number" ? (vs as any).zoom : undefined
	const pitch = typeof (vs as any).pitch === "number" ? (vs as any).pitch : undefined
	const bearing = typeof (vs as any).bearing === "number" ? (vs as any).bearing : undefined

	if (longitude === undefined && latitude === undefined && zoom === undefined) {
		return undefined
	}
	const safe: MapViewState = { longitude: longitude ?? 0, latitude: latitude ?? 0, zoom: zoom ?? 4 }
	if (pitch !== undefined) safe.pitch = pitch
	if (bearing !== undefined) safe.bearing = bearing
	return safe
}

/**
 * Strip poisoned transition state before passing viewState to DeckGL.
 * A deserialized `transitionInterpolator: {}` makes deck.gl iterate undefined
 * `_propsToCompare` → "e is not iterable".
 */
export function sanitizeViewStateForDeck(vs: MapViewState | undefined, fallback: MapViewState = DEFAULT_MAP_VIEW): MapViewState {
	const base = sanitizePersistedViewState(vs) ?? fallback
	const longitude = Math.min(180, Math.max(-180, finiteCamera(base.longitude, fallback.longitude)))
	const latitude = Math.min(85, Math.max(-85, finiteCamera(base.latitude, fallback.latitude)))
	const zoom = Math.min(22, Math.max(0, finiteCamera(base.zoom, fallback.zoom)))
	const result: MapViewState = { longitude, latitude, zoom }
	if (typeof base.pitch === "number" && Number.isFinite(base.pitch)) {
		result.pitch = base.pitch
	}
	if (typeof base.bearing === "number" && Number.isFinite(base.bearing)) {
		result.bearing = base.bearing
	}
	const transitionDuration = (vs as MapViewState & { transitionDuration?: unknown })?.transitionDuration
	if (typeof transitionDuration === "number" && transitionDuration >= 0 && hasLiveTransitionInterpolator(vs)) {
		result.transitionDuration = transitionDuration
		result.transitionInterpolator = (vs as MapViewState).transitionInterpolator
	}
	return result
}

/**
 * Brings a parsed saved workspace to the current schema. v1 profiles are migrated ONCE: the basemap is dropped
 * (it was never recorded as a choice) and `basemapExplicit` starts false. Returns null for unusable payloads.
 */
export function migrateWorkspace(parsed: unknown): { workspace: MapWorkspace; migrated: boolean } | null {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null
	}
	const saved = parsed as Omit<Partial<MapWorkspace>, "version"> & { version?: unknown }
	if (saved.version === 1) {
		const { basemap: _dropped, ...rest } = saved as Record<string, unknown>
		return { workspace: { ...rest, version: MAP_WORKSPACE_VERSION, basemapExplicit: false } as MapWorkspace, migrated: true }
	}
	if (saved.version === MAP_WORKSPACE_VERSION) {
		const explicit = saved.basemapExplicit === true && typeof saved.basemap === "string"
		return {
			workspace: { ...(saved as unknown as MapWorkspace), basemap: explicit ? saved.basemap : undefined, basemapExplicit: explicit },
			migrated: false,
		}
	}
	return null
}

/** The basemap id to open with: the user's explicit, still-available choice, otherwise the hydrology default. */
export function initialBasemap(workspace: Pick<MapWorkspace, "basemap" | "basemapExplicit">): { id: string; explicit: boolean } {
	if (workspace.basemapExplicit && workspace.basemap && isKnownBaseMap(workspace.basemap)) {
		return { id: workspace.basemap, explicit: true }
	}
	return { id: DEFAULT_BASEMAP_ID, explicit: false }
}

export function clearMapWorkspace(): void {
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.removeItem(STORAGE_KEY)
		}
	} catch {
		// ignore
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

function sanitizeBookmarks(value: unknown): MapBookmark[] | undefined {
	if (!Array.isArray(value)) return undefined
	const valid = value.filter(
		(item): item is MapBookmark =>
			isRecord(item) &&
			typeof item.id === "string" &&
			typeof item.name === "string" &&
			Number.isFinite(item.longitude) &&
			Number.isFinite(item.latitude) &&
			Number.isFinite(item.zoom),
	)
	return valid
}

function sanitizeAliases(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) return undefined
	return Object.fromEntries(Object.entries(value).filter(([, alias]) => typeof alias === "string")) as Record<string, string>
}

function sanitizeActiveRoi(value: unknown): ActiveRoi | undefined {
	if (!isRecord(value)) return undefined
	const roi: ActiveRoi = {}
	if (typeof value.id === "string") roi.id = value.id
	if (typeof value.name === "string") roi.name = value.name
	if (typeof value.source === "string") roi.source = value.source
	if (typeof value.areaHa === "number" && Number.isFinite(value.areaHa)) roi.areaHa = value.areaHa
	return roi
}

function sanitizeRibbonPanel(value: unknown): MapWorkspace["ribbonPanel"] | undefined {
	if (!isRecord(value)) return undefined
	const panel: NonNullable<MapWorkspace["ribbonPanel"]> = {}
	if (typeof value.width === "number" && Number.isFinite(value.width)) panel.width = value.width
	if (typeof value.height === "number" && Number.isFinite(value.height)) panel.height = value.height
	return panel
}

export function loadMapWorkspace(): MapWorkspace {
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
		if (!raw) {
			return DEFAULT_WORKSPACE
		}
		const migration = migrateWorkspace(JSON.parse(raw))
		if (!migration) {
			clearMapWorkspace()
			return DEFAULT_WORKSPACE
		}
		const parsed = migration.workspace
		const viewState = sanitizePersistedViewState(parsed.viewState)
		const hadPoisonedViewState =
			parsed.viewState != null &&
			typeof parsed.viewState === "object" &&
			("transitionInterpolator" in parsed.viewState || "transitionDuration" in parsed.viewState)
		const visibleLayerIds =
			Array.isArray(parsed.visibleLayerIds) && parsed.visibleLayerIds.every((v: unknown) => typeof v === "string")
				? (parsed.visibleLayerIds as string[])
				: undefined
		const clusterLayerIds =
			Array.isArray(parsed.clusterLayerIds) && parsed.clusterLayerIds.every((v: unknown) => typeof v === "string")
				? (parsed.clusterLayerIds as string[])
				: undefined
		const layerOpacities =
			parsed.layerOpacities && typeof parsed.layerOpacities === "object" && !Array.isArray(parsed.layerOpacities)
				? (parsed.layerOpacities as Record<string, number>)
				: undefined
		const workspace: MapWorkspace = {
			...DEFAULT_WORKSPACE,
			basemap: typeof parsed.basemap === "string" ? parsed.basemap : DEFAULT_WORKSPACE.basemap,
			basemapExplicit: parsed.basemapExplicit === true,
			viewState,
			visibleLayerIds,
			layerOpacities,
			clusterLayerIds,
			// Carried through so a load/save cycle (and the one-time migration rewrite) never drops them.
			activeRoi: sanitizeActiveRoi(parsed.activeRoi),
			layerAliases: sanitizeAliases(parsed.layerAliases),
			ribbonPanel: sanitizeRibbonPanel(parsed.ribbonPanel),
			bookmarks: sanitizeBookmarks(parsed.bookmarks),
			layerPanel: {
				...DEFAULT_WORKSPACE.layerPanel!,
				...(parsed.layerPanel && typeof parsed.layerPanel === "object" ? parsed.layerPanel : {}),
			},
		}
		// Persist the one-time migration immediately so it can never run twice, and rewrite poisoned camera
		// state so older builds cannot re-crash on the next open.
		if ((migration.migrated || hadPoisonedViewState) && typeof localStorage !== "undefined") {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
			} catch {
				// ignore
			}
		}
		return workspace
	} catch {
		clearMapWorkspace()
		return DEFAULT_WORKSPACE
	}
}

export function saveMapWorkspace(patch: Partial<Omit<MapWorkspace, "version">>): void {
	try {
		if (typeof localStorage === "undefined") {
			return
		}
		const current = loadMapWorkspace()
		const next: MapWorkspace = {
			...current,
			...patch,
			viewState: patch.viewState ? sanitizePersistedViewState(patch.viewState) : current.viewState,
			version: MAP_WORKSPACE_VERSION,
			layerPanel: { ...current.layerPanel!, ...(patch.layerPanel ?? {}) },
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
	} catch {
		// localStorage may be disabled or full — fail silently
	}
}
