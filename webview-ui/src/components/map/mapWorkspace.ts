/**
 * Map workspace persistence — localStorage-backed.
 *
 * Stores per-user UI state (basemap, view, layer visibility, panel layout)
 * so the map opens in the same configuration it was last left in.
 *
 * Schema is versioned so we can evolve it without breaking older saves.
 */

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

export interface MapWorkspace {
	version: 1
	basemap?: string
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
	version: 1,
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
	return !!(ti && typeof ti === "object" && Array.isArray((ti as { _propsToCompare?: unknown })._propsToCompare))
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

export function clearMapWorkspace(): void {
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.removeItem(STORAGE_KEY)
		}
	} catch {
		// ignore
	}
}

export function loadMapWorkspace(): MapWorkspace {
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
		if (!raw) {
			return DEFAULT_WORKSPACE
		}
		const parsed = JSON.parse(raw) as MapWorkspace
		if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
			clearMapWorkspace()
			return DEFAULT_WORKSPACE
		}
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
			viewState,
			visibleLayerIds,
			layerOpacities,
			clusterLayerIds,
			layerPanel: {
				...DEFAULT_WORKSPACE.layerPanel!,
				...(parsed.layerPanel && typeof parsed.layerPanel === "object" ? parsed.layerPanel : {}),
			},
		}
		// Rewrite poisoned camera state so older builds cannot re-crash on the next open.
		if (hadPoisonedViewState && typeof localStorage !== "undefined") {
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
			version: 1,
			layerPanel: { ...current.layerPanel!, ...(patch.layerPanel ?? {}) },
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
	} catch {
		// localStorage may be disabled or full — fail silently
	}
}
