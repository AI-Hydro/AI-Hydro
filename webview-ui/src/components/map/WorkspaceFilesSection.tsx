import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapLayer, RemovedFileEntry, WorkspaceGeoFile } from "@shared/proto/cline/map"
import { useCallback, useEffect, useRef, useState } from "react"
import { MapServiceClient } from "../../services/grpc-client"

/** What the host says about the project's map files. */
export interface ProjectFilesData {
	files: WorkspaceGeoFile[]
	removed: RemovedFileEntry[]
	/** Files found; at least this many when `truncated`. */
	totalCount: number
	foldersSkipped: number
	skippedNames: string[]
	symlinksFound: number
	symlinksSkipped: number
	truncated: boolean
	folderCount: number
	/** The first answer has not arrived yet. */
	loading: boolean
}

const EMPTY: ProjectFilesData = {
	files: [],
	removed: [],
	totalCount: 0,
	foldersSkipped: 0,
	skippedNames: [],
	symlinksFound: 0,
	symlinksSkipped: 0,
	truncated: false,
	folderCount: 0,
	loading: true,
}

/** A burst of focus events asks the host once. */
const REFRESH_DEBOUNCE_MS = 400

/**
 * The project's map files, from the host. They are candidates only: opening the map does not register every `*.json` as
 * a layer (that flooded the layer list). The list is read on mount, again after every action that changes it, and when
 * the window regains focus, because files appear while another window or a tool is working.
 */
export function useProjectFiles(): { data: ProjectFilesData; refresh: () => Promise<void> } {
	const [data, setData] = useState<ProjectFilesData>(EMPTY)
	const alive = useRef(true)
	const timer = useRef<number | undefined>(undefined)

	const refresh = useCallback(async () => {
		try {
			const r = await MapServiceClient.listWorkspaceGeoFiles(EmptyRequest.create({}))
			if (!alive.current) return
			setData({
				files: r.files ?? [],
				removed: r.removed ?? [],
				totalCount: r.totalCount ?? r.files?.length ?? 0,
				foldersSkipped: r.foldersSkipped ?? 0,
				skippedNames: r.skippedNames ?? [],
				symlinksFound: r.symlinksFound ?? 0,
				symlinksSkipped: r.symlinksSkipped ?? 0,
				truncated: r.truncated ?? false,
				folderCount: r.folderCount ?? ((r.files ?? []).length > 0 ? 1 : 0),
				loading: false,
			})
		} catch {
			if (alive.current) setData((cur) => ({ ...cur, loading: false }))
		}
	}, [])

	useEffect(() => {
		alive.current = true
		void refresh()
		const onFocus = () => {
			window.clearTimeout(timer.current)
			timer.current = window.setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS)
		}
		window.addEventListener("focus", onFocus)
		return () => {
			alive.current = false
			window.clearTimeout(timer.current)
			window.removeEventListener("focus", onFocus)
		}
	}, [refresh])

	return { data, refresh }
}

/**
 * "N restored from earlier sessions" from the `_hydrated` / `_hydrated_of` metadata the host stamps on restored
 * layers. Layers beyond the restore cap are kept on disk, not loaded; say so (the Layers panel offers to load them).
 * `olderCount` is the host's authoritative count of kept-but-unloaded layers; without it the count is derived.
 */
export function restoredLayersNote(layers: MapLayer[], olderCount?: number): string | null {
	const restored = layers.filter((layer) => layer.metadata?._hydrated === "1")
	if (restored.length === 0 && !olderCount) return null
	const savedTotal = Math.max(0, ...restored.map((layer) => Number.parseInt(layer.metadata?._hydrated_of ?? "", 10) || 0))
	const kept = olderCount ?? Math.max(0, savedTotal - restored.length)
	const keptNote = `${kept} older saved layer${kept === 1 ? " is" : "s are"} kept but not loaded.`
	if (restored.length === 0) return keptNote
	return kept > 0
		? `${restored.length} restored from earlier sessions. ${keptNote}`
		: `${restored.length} restored from earlier sessions.`
}
