/**
 * The local MERIT archives the host offers (see src/hosts/vscode/meritTiles.ts), and the per-viewer on/off switch.
 * The webview asks once on mount (and on a Retry); the host also pushes a fresh list when an archive's sha256 check
 * finishes or the tiles directory changes. No reply means no archives: the map then draws the streamed tier only.
 */

import { MERIT_MSG, type MeritArchiveOffer, type MeritArchivesMessage } from "@shared/map/meritTileContract"
import { useCallback, useEffect, useState } from "react"
import { type HostTransport, windowHostTransport } from "./hostRangeSource"

export interface MeritArchiveState {
	archives: MeritArchiveOffer[]
	notes: string[]
}

/** What the basemap panel and the export need: the offered archives, why some were not offered, and the switch. */
export interface MeritControl extends MeritArchiveState {
	enabled: boolean
	onToggle: (enabled: boolean) => void
}

/** The credit lines to list in an export: the archives' own attribution, only while the layer is on. */
export function meritExportCredits(control: Pick<MeritControl, "archives" | "enabled"> | undefined): string[] {
	if (!control?.enabled) return []
	return [...new Set(control.archives.map((a) => a.provenance.attribution))]
}

const EMPTY: MeritArchiveState = { archives: [], notes: [] }

/** Parses a host reply, rejecting anything that is not an archive list (page input is not taken on trust). */
export function parseArchivesMessage(data: unknown): MeritArchiveState | undefined {
	const msg = data as Partial<MeritArchivesMessage> | null
	if (!msg || msg.type !== MERIT_MSG.archives || !Array.isArray(msg.archives)) return undefined
	const archives = msg.archives.filter(
		(a): a is MeritArchiveOffer =>
			!!a &&
			typeof a.id === "string" &&
			Array.isArray(a.bounds) &&
			a.bounds.length === 4 &&
			a.bounds.every((n) => typeof n === "number") &&
			typeof a.provenance?.attribution === "string",
	)
	const notes = Array.isArray(msg.notes) ? msg.notes.filter((n): n is string => typeof n === "string") : []
	return { archives, notes }
}

export function useMeritArchives(retry: number, transport: HostTransport = windowHostTransport): MeritArchiveState {
	const [state, setState] = useState<MeritArchiveState>(EMPTY)
	// biome-ignore lint/correctness/useExhaustiveDependencies: a Retry asks the host to look at the directory again
	useEffect(() => {
		const unlisten = transport.listen((data) => {
			const parsed = parseArchivesMessage(data)
			if (parsed) setState(parsed)
		})
		transport.post({ type: MERIT_MSG.archivesRequest })
		return unlisten
	}, [retry, transport])
	return state
}

const ENABLED_KEY = "aihydro.map.meritRivers.enabled"

/** On by default; the choice is a per-viewer convenience kept in the browser (storage can be unavailable). */
export function useMeritEnabled(): [boolean, (enabled: boolean) => void] {
	const [enabled, setEnabled] = useState<boolean>(() => {
		try {
			return window.localStorage.getItem(ENABLED_KEY) !== "0"
		} catch {
			return true
		}
	})
	const set = useCallback((value: boolean) => {
		setEnabled(value)
		try {
			window.localStorage.setItem(ENABLED_KEY, value ? "1" : "0")
		} catch {
			// not persisted
		}
	}, [])
	return [enabled, set]
}
