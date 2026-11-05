/**
 * LayerPanel: the Layers tab of the map tool panel.
 *
 * One compact row per layer (LayerRow.tsx), grouped by where the layer came from and collapsible. Selecting a row opens a
 * drawer under it with opacity, style, attributes and details; everything else is in the row's "more" menu. Drag
 * reorders within a group; Move up and Move down stay in the menu for keyboard users. Removing a layer asks nothing and
 * offers Undo; removing many (Remove all, Remove duplicates) asks first and offers Undo too.
 *
 * Pure decisions (grouping, warnings versus notes, duplicates) live in layerModel.ts.
 * Positioning is the parent's responsibility (see MapToolRibbon).
 */

import { resolvedSourcePath } from "@shared/map/layerIdentity"
import { layerRunId } from "@shared/map/provenanceEnvelope"
import { StringRequest } from "@shared/proto/cline/common"
import type { MapLayer, RemovedFileEntry, WorkspaceGeoFile } from "@shared/proto/cline/map"
import {
	AddMapLayerRequest,
	AddWorkspaceGeoFileRequest,
	FileListChangeRequest,
	RemoveMapLayerRequest,
	SaveRoiToWorkspaceRequest,
	UnloadMapLayerRequest,
} from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { useMapContext } from "../../context/MapContext"
import { FileServiceClient, MapServiceClient } from "../../services/grpc-client"
import { loadAndPushFileEntries } from "./formats"
import { rasterCache } from "./formats/rasterCache"
import GraduatedSymbologyEditor from "./GraduatedSymbologyEditor"
import { LayerRow } from "./LayerRow"
import { deriveLayerIntelligence } from "./layerIntelligence"
import {
	drawOrder,
	duplicateIds,
	duplicatesToRemove,
	groupLayers,
	type LayerOrigin,
	listOrder,
	ORIGIN_LABEL,
	openableRun,
	rowIndicators,
	sharedNote,
} from "./layerModel"
import { AttributeTable, LayerInspector, niceMetadata } from "./layerPanelParts"
import { loadMapWorkspace, saveMapWorkspace } from "./mapWorkspace"
import { type OverflowItem, OverflowMenu } from "./OverflowMenu"
import { resolveFileUri } from "./resolveFileUri"
import { SymbologyEditor } from "./SymbologyEditor"
import { type FolderRef, fileResolved, layerOfFile, layersByFile, notOnMap, WEBVIEW_PARSED } from "./projectFilesModel"
import { ProjectFilesSection } from "./ProjectFilesSection"
import { restoredLayersNote, useProjectFiles } from "./WorkspaceFilesSection"

interface LayerPanelContentProps {
	onZoomToLayer?: (layer: MapLayer) => void
	onVisibilityChange: (layerId: string, visible: boolean) => void
	onOpacityChange?: (layerId: string, opacity: number) => void
	visibleLayerIds: Set<string>
	mapStyle?: string
	layerOrder: string[]
	onReorder: (newOrder: string[]) => void
	layerOpacities?: Record<string, number>
	clusterLayerIds?: Set<string>
	onClusterToggle?: (layerId: string, enabled: boolean) => void
	/** Open and select this layer row. Each new `nonce` selects again. */
	focusLayerRequest?: { layerId: string; nonce: number } | null
	onShowAllLayers?: () => void
	onHideAllLayers?: () => void
}

// ─── helpers ────────────────────────────────────────────────────────────────

const openProvenance = async (path: string) => {
	try {
		await FileServiceClient.openFile(StringRequest.create({ value: path }))
	} catch (err) {
		console.error("[LayerPanel] Failed to open provenance:", err)
	}
}

const openSourceFile = (filePath: string, workspaceFolder?: string) => {
	PLATFORM_CONFIG.postMessage({
		type: "aihydro-open-source-file",
		path: filePath,
		...(workspaceFolder ? { workspaceFolder } : {}),
	})
}

const buildDisplayNames = (layers: MapLayer[], aliasesIn: Record<string, string> | undefined): Map<string, string> => {
	const aliases = aliasesIn ?? {}
	const counts = new Map<string, number>()
	for (const l of layers) {
		const n = aliases[l.id] ?? l.metadata?.display_name ?? (l.name || l.id)
		counts.set(n, (counts.get(n) ?? 0) + 1)
	}
	const out = new Map<string, string>()
	for (const l of layers) {
		if (aliases[l.id]) {
			out.set(l.id, aliases[l.id])
			continue
		}
		const base = l.name || l.id
		if ((counts.get(base) ?? 0) <= 1) {
			out.set(l.id, base)
			continue
		}
		const folder = (l.metadata?.path ?? "").replace(/\\/g, "/").split("/").slice(0, -1).join("/")
		out.set(l.id, folder ? `${base} — ${folder}` : base)
	}
	return out
}

/** Download a layer's content as a file. */
const exportLayer = (layer: MapLayer, displayName: string) => {
	if (layer.layerType === "raster") {
		return // raster export not yet supported
	}
	if (!layer.geojson) {
		return
	}
	const blob = new Blob([layer.geojson], { type: "application/json" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = `${displayName.replace(/[^a-zA-Z0-9_-]/g, "_")}.geojson`
	a.click()
	URL.revokeObjectURL(url)
}

const saveLayerToWorkspace = async (layer: MapLayer, displayName: string): Promise<string> => {
	if (!layer.geojson) {
		throw new Error("Layer has no vector geometry to save.")
	}
	const safeName = displayName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "map_layer"
	const res = await MapServiceClient.saveRoiToWorkspace(
		SaveRoiToWorkspaceRequest.create({
			name: safeName,
			roi: {
				name: displayName,
				source: "map_layer",
				geojson: layer.geojson,
			},
		}),
	)
	return res.workspacePath
}

/** What a selected row's drawer shows besides opacity. */
interface DrawerView {
	style: boolean
	attrs: boolean
	details: boolean
	/** "Save as…": choose a workspace file or a GeoJSON download. */
	saveAs: boolean
}
/** The merged-duplicates note is shown once per webview session. */
let mergeNoteShown = false

const CLOSED_DRAWER: DrawerView = { style: false, attrs: false, details: false, saveAs: false }

/** A removal the user can take back. */
interface UndoEntry {
	label: string
	/** The layer and what the user had set on it, so Undo gives back more than the geometry. */
	layers: { layer: MapLayer; visible: boolean; opacity?: number; clustered: boolean }[]
	order: string[]
	/** Files taken out of the Project files list with it: Undo puts them back. */
	listEntries?: { workspaceFolder: string; relativePath: string; kind: "file" | "folder" }[]
}
const UNDO_MS = 10_000

// ─── component ──────────────────────────────────────────────────────────────

export const LayerPanelContent: React.FC<LayerPanelContentProps> = ({
	onZoomToLayer,
	onVisibilityChange,
	onOpacityChange,
	visibleLayerIds,
	mapStyle = "dark",
	layerOrder,
	onReorder,
	layerOpacities = {},
	clusterLayerIds,
	onClusterToggle,
	focusLayerRequest,
	onShowAllLayers,
	onHideAllLayers,
}) => {
	const { layers, addLayer, removeLayer, clearLayers, restoreState, restoreOlderLayers } = useMapContext()
	const [restoringOlder, setRestoringOlder] = useState(false)
	const [restoreError, setRestoreError] = useState<string | null>(null)
	const persisted = useMemo(() => loadMapWorkspace(), [])
	const [layerAliases, setLayerAliases] = useState<Record<string, string>>(persisted.layerAliases ?? {})
	const [renamingId, setRenamingId] = useState<string | null>(null)
	const [renameDraft, setRenameDraft] = useState("")
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [drawer, setDrawer] = useState<DrawerView>(CLOSED_DRAWER)
	const [symbologyMode, setSymbologyMode] = useState<"basic" | "graduated">("basic")
	const [confirm, setConfirm] = useState<null | { kind: "all" } | { kind: "duplicates"; names: string[] }>(null)
	const [loadStatus, setLoadStatus] = useState<{
		kind: "idle" | "ok" | "err"
		msg: string
		action?: { label: string; run: () => void }
	}>({ kind: "idle", msg: "" })
	const [collapsedGroups, setCollapsedGroups] = useState<Set<LayerOrigin>>(new Set())
	// Back-to-back removals each stay undoable (most recent first); the whole stack expires together.
	const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
	const undo = undoStack[undoStack.length - 1] ?? null
	const stackRef = useRef<UndoEntry[]>([])
	/** Raster values of removed layers: kept until the undo window closes, so Undo gets the values back too. */
	const staleRasters = useRef<Set<string>>(new Set())
	const [drag, setDrag] = useState<{ id: string } | null>(null)
	const [drop, setDrop] = useState<{ id: string; pos: "above" | "below" } | null>(null)
	const undoTimer = useRef<number | undefined>(undefined)

	useEffect(() => {
		saveMapWorkspace({ layerAliases })
	}, [layerAliases])
	useEffect(
		() => () => {
			window.clearTimeout(undoTimer.current)
			for (const id of staleRasters.current) rasterCache.delete(id)
		},
		[],
	)

	const displayNames = useMemo(() => buildDisplayNames(layers, layerAliases), [layers, layerAliases])
	const visibleCount = useMemo(() => layers.filter((layer) => visibleLayerIds.has(layer.id)).length, [layers, visibleLayerIds])
	const restoredNote = useMemo(() => restoredLayersNote(layers, restoreState.olderCount), [layers, restoreState.olderCount])

	// Draw order, shared with MapView (last = on top).
	const drawLayers = useMemo(() => drawOrder(layers, layerOrder), [layers, layerOrder])
	// The list reads like a GIS legend: the top row is on top of the map, so it is the draw order reversed.
	const orderedLayers = useMemo(() => listOrder(drawLayers), [drawLayers])
	const groups = useMemo(() => groupLayers(orderedLayers), [orderedLayers])
	const twins = useMemo(() => duplicateIds(orderedLayers), [orderedLayers])
	const intelligenceOf = useCallback(
		(layer: MapLayer) =>
			deriveLayerIntelligence(layer, { rawRasterValuesAvailable: Boolean(rasterCache.get(layer.id)?.rawPixels) }),
		[],
	)

	const say = useCallback((kind: "ok" | "err" | "idle", msg: string, ms = 3500, action?: { label: string; run: () => void }) => {
		setLoadStatus({ kind, msg, action })
		if (msg) window.setTimeout(() => setLoadStatus((cur) => (cur.msg === msg ? { kind: "idle", msg: "" } : cur)), ms)
	}, [])

	// Project files: every map file of the open folders. A loaded file stays in the tree with a check.
	const project = useProjectFiles()
	const singleRoot = project.data.folderCount <= 1
	const fileIndex = useMemo(() => layersByFile(layers, singleRoot), [layers, singleRoot])
	// Each project file is one row: its layer under On the map, or a row under Not on the map. Never both.
	const notOnMapFiles = useMemo(() => notOnMap(project.data.files, fileIndex), [project.data.files, fileIndex])
	const [projectOpenChoice, setProjectOpenChoice] = useState<boolean | undefined>(persisted.layerPanel?.projectFilesOpen)
	// Closed by default; open on its own only when the map has nothing on it and there are files to load.
	const [reveal, setReveal] = useState<{ files: WorkspaceGeoFile[]; nonce: number } | null>(null)
	/** The layer row a Load just put on the map: marked for a moment and scrolled into view. */
	const [justLoadedId, setJustLoadedId] = useState<string | null>(null)
	const justLoadedTimer = useRef<number | undefined>(undefined)
	useEffect(() => () => window.clearTimeout(justLoadedTimer.current), [])
	const scrolledTo = useRef<string | null>(null)
	useEffect(() => {
		if (!justLoadedId || scrolledTo.current === justLoadedId) return
		const row = document.querySelector(`[data-layer-id="${CSS.escape(justLoadedId)}"]`)
		if (row) {
			scrolledTo.current = justLoadedId
			row.scrollIntoView?.({ block: "nearest" })
			// The row the user acted on moved; keyboard focus follows it to its new place.
			row.querySelector<HTMLButtonElement>("button.map-layer-name")?.focus({ preventScroll: true })
		}
	}, [justLoadedId, layers])
	// Decided once, when the first answer arrives, so removing the last row does not close the section under the user.
	const [autoOpen, setAutoOpen] = useState<boolean | undefined>(undefined)
	useEffect(() => {
		if (autoOpen === undefined && !project.data.loading) setAutoOpen(layers.length === 0 && notOnMapFiles.length > 0)
	}, [autoOpen, project.data.loading, notOnMapFiles.length, layers.length])
	const projectOpen = projectOpenChoice ?? autoOpen ?? false
	// A layer arrives or leaves (a GeoTIFF the panel parsed, an agent's push): ask the host again, so its real-path match is current.
	const layerIdsKey = layers.map((l) => l.id).join("\u0000")
	const refreshProject = project.refresh
	const firstLayerKey = useRef(layerIdsKey)
	useEffect(() => {
		if (firstLayerKey.current === layerIdsKey) return
		firstLayerKey.current = layerIdsKey
		const t = window.setTimeout(() => void refreshProject(), 300)
		return () => window.clearTimeout(t)
	}, [layerIdsKey, refreshProject])
	const toggleProjectOpen = () => {
		const next = !projectOpen
		setProjectOpenChoice(next)
		saveMapWorkspace({ layerPanel: { showDetails: persisted.layerPanel?.showDetails ?? false, projectFilesOpen: next } })
	}

	// "N layers were the same file": said once per session, then it expires like any status line.
	useEffect(() => {
		if (restoreState.mergedCount > 0 && !mergeNoteShown) {
			mergeNoteShown = true
			say(
				"ok",
				`${restoreState.mergedCount} layer${restoreState.mergedCount === 1 ? " was" : "s were"} the same file as another and ${restoreState.mergedCount === 1 ? "is" : "are"} now one.`,
				10_000,
			)
		}
	}, [restoreState.mergedCount, say])

	const restoreOlder = async () => {
		setRestoringOlder(true)
		setRestoreError(null)
		try {
			await restoreOlderLayers()
		} catch (error) {
			setRestoreError(error instanceof Error ? error.message : "Could not restore older layers.")
		} finally {
			setRestoringOlder(false)
		}
	}

	/** Replay opens in its own panel; the host checks the ids before it opens anything. */
	const openRun = (layer: MapLayer) => {
		const run = openableRun(layer)
		if (run) {
			PLATFORM_CONFIG.postMessage({ type: "aihydro-map-open-run", study_id: run.studyId, run_id: run.runId })
		}
	}

	const select = (id: string | null, view: Partial<DrawerView> = {}) => {
		setSelectedId(id)
		setDrawer({ ...CLOSED_DRAWER, ...view })
	}

	// A "Show on map" from the chat: open that row's drawer and scroll it into view.
	useEffect(() => {
		if (!focusLayerRequest) {
			return
		}
		select(focusLayerRequest.layerId, { details: true })
		window.setTimeout(() => {
			document
				.querySelector(`[data-layer-id="${CSS.escape(focusLayerRequest.layerId)}"]`)
				?.scrollIntoView({ block: "nearest" })
		}, 0)
	}, [focusLayerRequest?.nonce])

	const commitRename = async (layer: MapLayer) => {
		const trimmed = renameDraft.trim()
		const layerId = layer.id
		setRenamingId(null)
		setRenameDraft("")
		const baseName = layer.name || layer.id
		if (!trimmed || trimmed === baseName) {
			setLayerAliases((prev) => {
				const next = { ...prev }
				delete next[layerId]
				return next
			})
			return
		}
		try {
			const metadata = { ...(layer.metadata ?? {}), display_name: trimmed }
			await MapServiceClient.addMapLayer(
				AddMapLayerRequest.create({
					layer: { ...layer, name: trimmed, metadata },
					replaceExisting: true,
				}),
			)
			setLayerAliases((prev) => {
				const next = { ...prev }
				delete next[layerId]
				return next
			})
		} catch (err) {
			console.error("[LayerPanel] Failed to save layer name:", err)
			setLayerAliases((prev) => ({ ...prev, [layerId]: trimmed }))
		}
	}

	const handleSaveLayerToWorkspace = async (layer: MapLayer, displayName: string) => {
		say("idle", `Saving ${displayName}…`, 15_000)
		try {
			const workspacePath = await saveLayerToWorkspace(layer, displayName)
			say("ok", `Saved ${workspacePath}`)
		} catch (err) {
			say("err", err instanceof Error ? err.message : "Save failed", 6000)
		}
	}

	const handleReloadSource = async (layer: MapLayer, displayName: string) => {
		const sourcePath = layer.metadata?.source_path || layer.metadata?.path || layer.metadata?.raster_source_path
		if (!sourcePath) {
			say("err", "No source file path recorded for this layer.", 5000)
			return
		}
		say("idle", `Reloading ${displayName}…`, 15_000)
		try {
			const resolved = await resolveFileUri(sourcePath, {
				workspaceFolder: layer.metadata?.workspace_folder,
				kind: "project",
			})
			// One file has one path: the absolute one the host found it at, whatever spelling the layer stored.
			const absolutePath = resolved.path ?? sourcePath
			const response = await fetch(resolved.uri)
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`)
			}
			const blob = await response.blob()
			const file = new File([blob], resolved.name)
			const result = await loadAndPushFileEntries([
				{
					file,
					source: {
						path: absolutePath,
						uri: layer.metadata?.source_uri,
						displayPath: layer.metadata?.source_display_path ?? sourcePath,
						format: layer.metadata?.source_format ?? layer.metadata?.format,
					},
				},
			])
			if (result.loaded > 0) {
				// The host says what happened (the file changed, or it is unchanged and already on the map).
				say("ok", `Reload finished for ${displayName}.`, 5000)
			} else {
				say("err", result.errors[0] ?? "Reload failed.", 6000)
			}
		} catch (err) {
			say("err", err instanceof Error ? err.message : "Reload failed.", 6000)
		}
	}

	// ── removal, with undo ────────────────────────────────────────────────

	/** The window closes: nothing can be undone any more, so the raster values of removed layers can go. */
	const expireUndo = useCallback(() => {
		for (const id of staleRasters.current) rasterCache.delete(id)
		staleRasters.current.clear()
		stackRef.current = []
		setUndoStack([])
	}, [])
	const armUndoTimer = useCallback(() => {
		window.clearTimeout(undoTimer.current)
		undoTimer.current = window.setTimeout(expireUndo, UNDO_MS)
	}, [expireUndo])
	const pushUndo = useCallback(
		(entry: UndoEntry) => {
			stackRef.current = [...stackRef.current.slice(-4), entry]
			setUndoStack(stackRef.current)
			armUndoTimer()
		},
		[armUndoTimer],
	)
	const capture = (layer: MapLayer) => ({
		layer,
		visible: visibleLayerIds.has(layer.id),
		opacity: layerOpacities[layer.id],
		clustered: !!clusterLayerIds?.has(layer.id),
	})

	/**
	 * Remove layers. The host is asked first and the panel changes only for what it accepted, so the two never disagree:
	 * a layer the host refused is still on the map and still in the list, and the message says so.
	 */
	const removeLayers = async (
		targets: MapLayer[],
		label: string,
		opts: { unload?: boolean; listEntries?: UndoEntry["listEntries"] } = {},
	) => {
		if (targets.length === 0) return
		const previousOrder = drawLayers.map((l) => l.id)
		const captured = targets.map(capture)
		const removed: MapLayer[] = []
		let failed = 0
		await Promise.all(
			targets.map(async (layer) => {
				try {
					if (opts.unload) {
						// Unload keeps the layer's name, style, opacity and place in a sidecar file; the file on disk is not touched.
						const opacity = layerOpacities[layer.id]
						await MapServiceClient.unloadMapLayer(
							UnloadMapLayerRequest.create({
								layerId: layer.id,
								hasOpacity: opacity !== undefined,
								opacity: opacity ?? 0,
								hidden: !visibleLayerIds.has(layer.id),
								positionFromTop: displayIds.indexOf(layer.id),
							}),
						)
					} else {
						await MapServiceClient.removeMapLayer(RemoveMapLayerRequest.create({ layerId: layer.id }))
					}
					removed.push(layer)
				} catch (err) {
					console.error("Failed to remove layer:", err)
					failed++
				}
			}),
		)
		if (failed > 0) say("err", `Could not ${opts.unload ? "unload" : "remove"} ${failed === 1 ? "the layer" : `${failed} layers`}.`, 6000)
		if (removed.length === 0) return
		const gone = new Set(removed.map((l) => l.id))
		for (const layer of removed) {
			removeLayer(layer.id)
			staleRasters.current.add(layer.id)
			onVisibilityChange(layer.id, false)
		}
		onReorder(previousOrder.filter((id) => !gone.has(id)))
		if (selectedId && gone.has(selectedId)) select(null)
		if (renamingId && gone.has(renamingId)) setRenamingId(null)
		let listEntries: UndoEntry["listEntries"]
		if (opts.listEntries && opts.listEntries.length > 0) {
			try {
				await MapServiceClient.removeFromFileList(FileListChangeRequest.create({ entries: opts.listEntries }))
				listEntries = opts.listEntries
			} catch (err) {
				console.error("Failed to remove from the list:", err)
				say("err", "Unloaded, but could not remove it from the list.", 6000)
			}
		}
		pushUndo({ label, layers: captured.filter((c) => gone.has(c.layer.id)), order: previousOrder, listEntries })
		if (opts.unload || listEntries) void project.refresh()
	}

	/** Undo the latest removal. The host is asked first; only layers it took back reappear in the panel. */
	const handleUndo = async () => {
		const entry = stackRef.current[stackRef.current.length - 1]
		if (!entry) return
		stackRef.current = stackRef.current.slice(0, -1)
		setUndoStack(stackRef.current)
		if (stackRef.current.length > 0) armUndoTimer()
		else window.clearTimeout(undoTimer.current)
		if (entry.listEntries && entry.listEntries.length > 0) {
			try {
				await MapServiceClient.restoreToFileList(FileListChangeRequest.create({ entries: entry.listEntries }))
			} catch (err) {
				console.error("Failed to restore the list:", err)
			}
			void project.refresh()
		}
		const failed: string[] = []
		const back = new Set<string>()
		for (const c of entry.layers) {
			try {
				await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer: c.layer, replaceExisting: true }))
			} catch (err) {
				console.error("Failed to restore layer:", err)
				failed.push(c.layer.name || c.layer.id)
				continue
			}
			back.add(c.layer.id)
			staleRasters.current.delete(c.layer.id)
			addLayer(c.layer)
			onVisibilityChange(c.layer.id, c.visible)
			if (c.opacity !== undefined) onOpacityChange?.(c.layer.id, c.opacity)
			if (c.clustered) onClusterToggle?.(c.layer.id, true)
		}
		if (entry.layers.length > 0) {
			const present = new Set([...orderIds, ...back])
			onReorder([...entry.order.filter((id) => present.has(id)), ...orderIds.filter((id) => !entry.order.includes(id))])
		}
		say(failed.length ? "err" : "ok", failed.length ? `Could not restore ${failed.join(", ")}.` : "Restored.", 4000)
	}

	const handleClearAll = async () => {
		setConfirm(null)
		const previous = [...layers]
		const previousOrder = drawLayers.map((l) => l.id)
		const captured = previous.map(capture)
		try {
			await MapServiceClient.clearMapLayers({})
		} catch (err) {
			console.error("Failed to clear layers:", err)
			say("err", err instanceof Error ? err.message : "Failed to clear layers.", 6000)
			return
		}
		clearLayers()
		for (const layer of previous) staleRasters.current.add(layer.id)
		onReorder([])
		onHideAllLayers?.()
		select(null)
		setRenamingId(null)
		pushUndo({ label: `Removed ${previous.length} layers`, layers: captured, order: previousOrder })
	}

	const handleRemoveDuplicates = async () => {
		const drop = duplicatesToRemove(orderedLayers, (id) => visibleLayerIds.has(id))
		setConfirm(null)
		await removeLayers(drop, `Removed ${drop.length} duplicate${drop.length === 1 ? "" : "s"}`)
	}

	// ── project files: load, unload, remove from list ───────────────────────

	const layersRef = useRef(layers)
	layersRef.current = layers
	/** A layer to fit the camera to as soon as it reaches the map (a load onto an empty map). */
	const fitWhenArrives = useRef<string | null>(null)
	useEffect(() => {
		const id = fitWhenArrives.current
		if (!id) return
		const layer = layers.find((l) => l.id === id)
		if (layer) {
			fitWhenArrives.current = null
			onZoomToLayer?.(layer)
		}
	}, [layers, onZoomToLayer])
	const zoomToLoaded = (id: string) => {
		const layer = layersRef.current.find((l) => l.id === id)
		if (layer) onZoomToLayer?.(layer)
	}

	/** Files in the list, by resolved path; and the resolved paths of files removed from the list. */
	const fileByResolved = useMemo(() => {
		const map = new Map<string, WorkspaceGeoFile>()
		for (const file of project.data.files) map.set(fileResolved(file), file)
		return map
	}, [project.data.files])
	/** The project file each layer on the map was loaded from (by the host's real-path match, else by path). */
	const fileOfLayerId = useMemo(() => {
		const map = new Map<string, WorkspaceGeoFile>()
		for (const file of project.data.files) {
			const layer = layerOfFile(file, fileIndex)
			if (layer) map.set(layer.id, file)
		}
		return map
	}, [project.data.files, fileIndex])
	const removedResolved = useMemo(() => {
		const set = new Set<string>()
		for (const e of project.data.removed) {
			if (e.kind === "file" && e.workspaceFolder) {
				set.add(resolvedSourcePath({ path: e.relativePath, workspace_folder: e.workspaceFolder }) ?? "")
			}
		}
		return set
	}, [project.data.removed])

	/** For a project file's row on the map: where the file is, shown on hover so the move is traceable. */
	const sourceHintOf = (layerId: string): string | undefined => {
		const file = fileOfLayerId.get(layerId)
		return file ? `${project.data.folderCount > 1 && file.folderName ? `${file.folderName} / ` : ""}${file.relativePath}` : undefined
	}

	/** A Load put this layer on the map: mark its row, say where it went, offer Zoom to, and fit the camera on an empty map. */
	const finishLoad = (file: WorkspaceGeoFile, id: string, wasEmpty: boolean) => {
		if (wasEmpty) fitWhenArrives.current = id
		window.clearTimeout(justLoadedTimer.current)
		scrolledTo.current = null
		setJustLoadedId(id)
		justLoadedTimer.current = window.setTimeout(() => setJustLoadedId(null), 3500)
		say("ok", `Loaded ${file.name}. It moved up to On the map.`, 10_000, { label: "Zoom to", run: () => zoomToLoaded(id) })
		void project.refresh()
	}

	/** GeoTIFF and KMZ are parsed by the map panel, so their layer arrives later with an id nobody knew: wait for it. */
	const pendingParsed = useRef<{ file: WorkspaceGeoFile; known: Set<string>; wasEmpty: boolean; timer: number } | null>(null)
	useEffect(() => {
		const pending = pendingParsed.current
		if (!pending) return
		const layer = layers.find((l) => !pending.known.has(l.id) && layerOfFile(pending.file, layersByFile([l], singleRoot)))
		if (!layer) return
		window.clearTimeout(pending.timer)
		pendingParsed.current = null
		finishLoad(pending.file, layer.id, pending.wasEmpty)
	})

	const loadProjectFile = async (file: WorkspaceGeoFile) => {
		if (WEBVIEW_PARSED.has(file.extension.toLowerCase())) {
			const wasEmpty = layersRef.current.length === 0
			if (pendingParsed.current) window.clearTimeout(pendingParsed.current.timer)
			pendingParsed.current = {
				file,
				known: new Set(layersRef.current.map((l) => l.id)),
				wasEmpty,
				timer: window.setTimeout(() => {
					pendingParsed.current = null
				}, 30_000),
			}
			PLATFORM_CONFIG.postMessage({
				type: "aihydro-map-load-project-file",
				relativePath: file.relativePath,
				workspaceFolder: file.workspaceFolder,
			})
			say("idle", `Loading ${file.name}…`, 15_000)
			return
		}
		const wasEmpty = layersRef.current.length === 0
		say("idle", `Loading ${file.name}…`, 15_000)
		let res: Awaited<ReturnType<typeof MapServiceClient.addWorkspaceGeoFile>>
		try {
			res = await MapServiceClient.addWorkspaceGeoFile(
				AddWorkspaceGeoFileRequest.create({ relativePath: file.relativePath, workspaceFolder: file.workspaceFolder }),
			)
		} catch (error) {
			say("err", error instanceof Error ? error.message : `Could not load ${file.name}.`, 8000)
			throw error
		}
		const id = res.layerId
		if (res.settingsRestored) {
			// Back as it was: opacity, hidden or shown, and its place in the list.
			if (res.hasOpacity) onOpacityChange?.(id, res.opacity)
			if (res.hidden) onVisibilityChange(id, false)
			if (res.positionFromTop >= 0) {
				const display = displayIds.filter((x) => x !== id)
				display.splice(Math.min(res.positionFromTop, display.length), 0, id)
				onReorder([...display].reverse())
			}
		}
		finishLoad(file, id, wasEmpty)
	}

	/** Unload layers (and, with `alsoRemove`, take their files out of the list). The files stay on disk. */
	const unloadLayers = async (targets: MapLayer[], name: string, alsoRemove = false) => {
		const linked = targets.map((l) => layerRunId(l.metadata)?.split(".")[0]).find(Boolean)
		const base = targets.length > 1 ? `Unloaded ${targets.length} files` : `Unloaded ${name}`
		const label = alsoRemove
			? `${base} and removed it from this list. The file stays on disk`
			: linked
				? `${base}. It is now under Not on the map. Its link to run ${linked} is not kept; Undo restores it`
				: `${base}. It is now under Not on the map. The file stays on disk`
		const listEntries: UndoEntry["listEntries"] = alsoRemove
			? targets.flatMap((l): NonNullable<UndoEntry["listEntries"]> => {
					const file = fileOfLayerId.get(l.id) ?? fileByResolved.get(resolvedSourcePath(l.metadata) ?? "")
					return file ? [{ workspaceFolder: file.workspaceFolder, relativePath: file.relativePath, kind: "file" as const }] : []
				})
			: undefined
		const moved = alsoRemove ? [] : targets.flatMap((l) => fileOfLayerId.get(l.id) ?? [])
		await removeLayers(targets, label, { unload: true, listEntries })
		// The row now lives under Not on the map: show it there for a moment, so the move can be followed.
		if (moved.length > 0) {
			setProjectOpenChoice((cur) => cur ?? true)
			setReveal({ files: moved, nonce: Date.now() })
		}
	}

	const removeFromList = async (entries: { file?: WorkspaceGeoFile; folder?: FolderRef }[], label: string) => {
		const list: NonNullable<UndoEntry["listEntries"]> = entries.flatMap((e): NonNullable<UndoEntry["listEntries"]> =>
			e.file
				? [{ workspaceFolder: e.file.workspaceFolder, relativePath: e.file.relativePath, kind: "file" as const }]
				: e.folder && e.folder.relativePath
					? [{ workspaceFolder: e.folder.workspaceFolder, relativePath: e.folder.relativePath, kind: "folder" as const }]
					: [],
		)
		if (list.length === 0) return
		try {
			await MapServiceClient.removeFromFileList(FileListChangeRequest.create({ entries: list }))
		} catch (error) {
			say("err", error instanceof Error ? error.message : "Could not remove from the list.", 6000)
			return
		}
		pushUndo({ label, layers: [], order: [], listEntries: list })
		await project.refresh()
	}

	const restoreToList = async (entries: RemovedFileEntry[] | "all") => {
		try {
			await MapServiceClient.restoreToFileList(
				FileListChangeRequest.create(
					entries === "all"
						? { all: true, entries: [] }
						: {
								entries: entries.map((e) => ({
									workspaceFolder: e.workspaceFolder,
									relativePath: e.relativePath,
									kind: e.kind,
								})),
							},
				),
			)
		} catch (error) {
			say("err", error instanceof Error ? error.message : "Could not restore.", 6000)
			return
		}
		say("ok", entries === "all" ? "Restored all removed files to the list." : "Restored to the list.", 4000)
		await project.refresh()
	}

	// ── order ─────────────────────────────────────────────────────────────

	/** Draw order, as persisted: the last id is drawn last, so it is on top of the map. */
	const orderIds = drawLayers.map((l) => l.id)
	/** The list as shown: the top row is the layer on top of the map. */
	const displayIds = orderedLayers.map((l) => l.id)
	const reorderFromDisplay = (display: string[]) => onReorder([...display].reverse())
	/** -1 moves the layer up the list, toward the top of the map; +1 moves it down. */
	const moveLayer = (layer: MapLayer, dir: -1 | 1) => {
		const i = displayIds.indexOf(layer.id)
		const j = i + dir
		if (i < 0 || j < 0 || j >= displayIds.length) return
		const next = [...displayIds]
		;[next[i], next[j]] = [next[j], next[i]]
		reorderFromDisplay(next)
	}

	const finishDrag = () => {
		setDrag(null)
		setDrop(null)
	}
	const onRowDragOver = (e: React.DragEvent, layer: MapLayer) => {
		if (!drag || drag.id === layer.id) return
		e.preventDefault()
		e.dataTransfer.dropEffect = "move"
		const rect = e.currentTarget.getBoundingClientRect()
		const pos = e.clientY < rect.top + rect.height / 2 ? "above" : "below"
		setDrop((cur) => (cur?.id === layer.id && cur.pos === pos ? cur : { id: layer.id, pos }))
	}
	const onRowDrop = (e: React.DragEvent, layer: MapLayer) => {
		e.preventDefault()
		if (!drag || !drop || drag.id === layer.id) return finishDrag()
		const next = displayIds.filter((id) => id !== drag.id)
		const at = next.indexOf(layer.id)
		next.splice(drop.pos === "above" ? at : at + 1, 0, drag.id)
		reorderFromDisplay(next)
		finishDrag()
	}

	// ── file picker ───────────────────────────────────────────────────────
	// The host's own picker, so the file arrives with its absolute path (a webview file input cannot report one). The
	// map says "Loading…" and "Loaded …" itself when the file reaches it.
	const onPickFiles = () => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-add-file-command" })

	// ── menus ─────────────────────────────────────────────────────────────

	const menuFor = (layer: MapLayer, displayName: string): OverflowItem[] => {
		const isRaster = layer.layerType === "raster"
		const sourcePath = layer.metadata?.source_path || layer.metadata?.path || layer.metadata?.raster_source_path
		const openable = openableRun(layer)
		const rank = displayIds.indexOf(layer.id)
		// A file in the Project files tree (listed, or removed from the list) can be unloaded and loaded again from there.
		// A layer with no such row (an inline layer, a file outside the project) can only be removed.
		const resolved = resolvedSourcePath(layer.metadata) ?? ""
		const listed = fileOfLayerId.has(layer.id) || (resolved ? fileByResolved.has(resolved) : false)
		const unloadable = listed || (resolved !== "" && removedResolved.has(resolved))
		const items: (OverflowItem | false)[] = [
			{ key: "zoom", label: "Zoom to layer", icon: "zoom-in", onSelect: () => onZoomToLayer?.(layer) },
			{
				key: "rename",
				label: "Rename on map",
				icon: "edit",
				title: "Sets the name shown on the map. The file is not renamed.",
				onSelect: () => {
					setRenamingId(layer.id)
					setRenameDraft(displayName)
				},
			},
			{ key: "d1", divider: true },
			!isRaster &&
				layer.metadata?.source !== "workspace" && {
					key: "save-as",
					label: "Save as…",
					icon: "save",
					onSelect: () => select(layer.id, { saveAs: true }),
				},
			!!sourcePath && {
				key: "open-source",
				label: "Open file",
				icon: "go-to-file",
				onSelect: () => openSourceFile(sourcePath, layer.metadata?.workspace_folder),
			},
			!!sourcePath && {
				key: "reload",
				label: "Reload source",
				icon: "refresh",
				onSelect: () => void handleReloadSource(layer, displayName),
			},
			!!openable && {
				key: "open-run",
				label: "Open run",
				icon: "history",
				onSelect: () => openRun(layer),
			},
			{ key: "d4", divider: true },
			{
				key: "up",
				label: "Move up",
				icon: "arrow-up",
				disabledReason: rank <= 0 ? "Already on top of the map" : undefined,
				onSelect: () => moveLayer(layer, -1),
			},
			{
				key: "down",
				label: "Move down",
				icon: "arrow-down",
				disabledReason: rank >= displayIds.length - 1 ? "Already at the bottom of the map" : undefined,
				onSelect: () => moveLayer(layer, 1),
			},
			{ key: "d5", divider: true },
			unloadable
				? {
						key: "unload",
						label: "Unload",
						icon: "close",
						title: "Takes it off the map. The file stays on disk, and its style is kept for next time.",
						onSelect: () => void unloadLayers([layer], displayName),
					}
				: {
						key: "remove",
						label: "Remove layer",
						icon: "trash",
						danger: true,
						onSelect: () => void removeLayers([layer], `Removed “${displayName}”`),
					},
			listed && {
				key: "unload-remove",
				label: "Unload and remove from list",
				icon: "trash",
				title: "Takes it off the map and hides it in Project files, on this machine. The file stays on disk.",
				onSelect: () => void unloadLayers([layer], displayName, true),
			},
		]
		return items.filter(Boolean) as OverflowItem[]
	}

	const addItems: OverflowItem[] = [
		{ key: "file", label: "Add file…", icon: "file-add", onSelect: onPickFiles },
		{
			key: "url",
			label: "Add from URL…",
			icon: "link",
			onSelect: () => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-add-url-command" }),
		},
	]
	const panelItems: OverflowItem[] = [
		{
			key: "save-scene",
			label: "Save scene…",
			icon: "save-all",
			onSelect: () => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-save-scene-command" }),
		},
		{
			key: "open-scene",
			label: "Open scene…",
			icon: "folder-opened",
			onSelect: () => PLATFORM_CONFIG.postMessage({ type: "aihydro-map-open-scene-command" }),
		},
		{ key: "d1", divider: true },
		{
			key: "show-all",
			label: "Show all layers",
			icon: "eye",
			disabledReason: layers.length === 0 ? "No layers" : undefined,
			onSelect: () => onShowAllLayers?.(),
		},
		{
			key: "hide-all",
			label: "Hide all layers",
			icon: "eye-closed",
			disabledReason: layers.length === 0 ? "No layers" : undefined,
			onSelect: () => onHideAllLayers?.(),
		},
		{ key: "d2", divider: true },
		{
			key: "remove-all",
			label: "Remove all layers…",
			icon: "trash",
			danger: true,
			disabledReason: layers.length === 0 ? "No layers" : undefined,
			onSelect: () => setConfirm({ kind: "all" }),
		},
	]

	// ── drawer under the selected row ─────────────────────────────────────

	const renderDrawer = (layer: MapLayer, displayName: string) => {
		const isRaster = layer.layerType === "raster"
		const hasGeojson = !!layer.geojson && !isRaster
		const visible = visibleLayerIds.has(layer.id)
		const intelligence = intelligenceOf(layer)
		const niceMeta = niceMetadata(layer)
		const opacity = layerOpacities[layer.id] ?? (isRaster ? Number.parseFloat(layer.metadata?.raster_opacity ?? "0.75") : 1)
		const fg = "var(--vscode-foreground)"
		const border = "var(--vscode-editorWidget-border, rgba(128,128,128,0.35))"
		return (
			<div aria-label={`Settings for ${displayName}`} className="map-layer-drawer" role="group">
				<label className="map-layer-opacity" htmlFor={`map-layer-opacity-${layer.id}`}>
					<span>Opacity</span>
					<input
						disabled={!visible}
						id={`map-layer-opacity-${layer.id}`}
						max={1}
						min={0}
						onChange={(e) => onOpacityChange?.(layer.id, Number.parseFloat(e.target.value))}
						step={0.05}
						type="range"
						value={opacity}
					/>
					<output>{Math.round(opacity * 100)}%</output>
				</label>
				{!visible && <div className="map-layer-hint">Hidden. Show the layer to change its opacity.</div>}
				<div className="map-layer-drawer__actions">
					<button
						aria-pressed={drawer.style}
						className="map-chip"
						onClick={() => setDrawer((d) => ({ ...d, style: !d.style }))}
						type="button">
						<span aria-hidden="true" className="codicon codicon-symbol-color" />
						Style
					</button>
					{hasGeojson && (
						<button
							aria-pressed={drawer.attrs}
							className="map-chip"
							onClick={() => setDrawer((d) => ({ ...d, attrs: !d.attrs }))}
							type="button">
							<span aria-hidden="true" className="codicon codicon-table" />
							Attributes
						</button>
					)}
					<button
						aria-pressed={drawer.details}
						className="map-chip"
						onClick={() => setDrawer((d) => ({ ...d, details: !d.details }))}
						type="button">
						<span aria-hidden="true" className="codicon codicon-info" />
						Details
					</button>
				</div>
				{drawer.saveAs && !isRaster && (
					<div aria-label="Save as" className="map-layer-drawer__actions" role="group">
						<button
							className="map-chip"
							onClick={() => {
								void handleSaveLayerToWorkspace(layer, displayName)
								setDrawer((d) => ({ ...d, saveAs: false }))
							}}
							type="button">
							<span aria-hidden="true" className="codicon codicon-save" />
							Workspace file
						</button>
						{hasGeojson && (
							<button
								className="map-chip"
								onClick={() => {
									exportLayer(layer, displayName)
									setDrawer((d) => ({ ...d, saveAs: false }))
								}}
								type="button">
								<span aria-hidden="true" className="codicon codicon-export" />
								GeoJSON download
							</button>
						)}
					</div>
				)}
				{drawer.style && (
					<>
						{hasGeojson && layer.layerType === "point" && (
							<label className="map-layer-opacity">
								<input
									checked={!!clusterLayerIds?.has(layer.id)}
									onChange={(e) => onClusterToggle?.(layer.id, e.target.checked)}
									type="checkbox"
								/>
								<span>Cluster points</span>
							</label>
						)}
						{!isRaster && (
							<div aria-label="Style type" className="map-layer-segment" role="group">
								<button
									aria-pressed={symbologyMode === "basic"}
									onClick={() => setSymbologyMode("basic")}
									type="button">
									Basic
								</button>
								<button
									aria-pressed={symbologyMode === "graduated"}
									onClick={() => setSymbologyMode("graduated")}
									type="button">
									By attribute
								</button>
							</div>
						)}
						{symbologyMode === "basic" || isRaster ? (
							<SymbologyEditor
								layer={layer}
								mapStyle={mapStyle}
								onClose={() => setDrawer((d) => ({ ...d, style: false }))}
							/>
						) : (
							<GraduatedSymbologyEditor
								layer={layer}
								mapStyle={mapStyle}
								onClose={() => setDrawer((d) => ({ ...d, style: false }))}
							/>
						)}
					</>
				)}
				{drawer.attrs && hasGeojson && <AttributeTable border={border} fg={fg} layer={layer} />}
				{drawer.details && (
					<LayerInspector
						border={border}
						fg={fg}
						intelligence={intelligence}
						layer={layer}
						niceMeta={niceMeta}
						onCopied={(what) => say("ok", `Copied ${what}.`, 2500)}
						onOpenProvenance={
							layer.metadata?.provenance_path
								? () => void openProvenance(layer.metadata?.provenance_path as string)
								: undefined
						}
						onOpenRun={openableRun(layer) ? () => openRun(layer) : undefined}
						warnings={rowIndicators(layer, intelligence).warnings}
					/>
				)}
			</div>
		)
	}

	// ── render ────────────────────────────────────────────────────────────

	return (
		<div className="map-layers">
			<div className="map-layers__toolbar">
				<OverflowMenu icon="add" items={addItems} label="Add layer" text="Add" />
				<span className="map-layers__summary" title={restoredNote ?? undefined}>
					{layers.length === 0
						? "No layers"
						: `${layers.length} layer${layers.length === 1 ? "" : "s"} · ${visibleCount} visible`}
				</span>
				<OverflowMenu items={panelItems} label="Layers panel actions" />
			</div>

			<div aria-live="polite" role="status">
				{loadStatus.msg && (
					<div className={`map-layers__status${loadStatus.kind === "err" ? " map-layers__status--err" : ""}`}>
						{loadStatus.msg}
						{loadStatus.action && (
							<button className="map-layers__link" onClick={loadStatus.action.run} type="button">
								{loadStatus.action.label}
							</button>
						)}
					</div>
				)}
			</div>

			<div className="map-layers__list" data-with-project={project.data.folderCount > 0 || undefined}>
				<h3 className="map-layers__section">On the map</h3>
				{orderedLayers.length === 0 ? (
					<div className="map-layers__empty">
						<span aria-hidden="true" className="codicon codicon-layers" />
						<strong>No layers yet</strong>
						<span>
							Use <em>Add</em> above, ask the assistant to run a tool, or right-click a file in the Explorer and
							choose Add to AI-Hydro Map.
						</span>
						<span className="map-layer-hint">GeoJSON, KML, KMZ, GPX, Shapefile (.zip), GeoTIFF, CSV</span>
					</div>
				) : (
					groups.map((group) => {
						const label = ORIGIN_LABEL[group.origin]
						const collapsed = collapsedGroups.has(group.origin)
						const indicators = group.layers.map((l) => rowIndicators(l, intelligenceOf(l)))
						const groupNote = sharedNote(indicators)
						const warnCount = indicators.filter((i) => i.warnings.length > 0).length
						const groupTwins = group.layers.filter((l) => twins.has(l.id)).length
						return (
							<section aria-label={label.title} className="map-layer-group" key={group.origin}>
								<button
									aria-expanded={!collapsed}
									className="map-layer-group__head"
									onClick={() =>
										setCollapsedGroups((prev) => {
											const next = new Set(prev)
											next.has(group.origin) ? next.delete(group.origin) : next.add(group.origin)
											return next
										})
									}
									title={`${label.hint}. Groups are by origin; the map stacks all layers in one order, and the list shows it from the top of the map down.`}
									type="button">
									<span
										aria-hidden="true"
										className={`codicon codicon-chevron-${collapsed ? "right" : "down"}`}
									/>
									<span className="map-layer-group__title">{label.title}</span>
									{collapsed && warnCount > 0 && (
										<span
											aria-label={`${warnCount} layer${warnCount === 1 ? "" : "s"} with warnings`}
											className="map-layer-group__warn"
											role="img"
											title={`${warnCount} layer${warnCount === 1 ? "" : "s"} in this group ${warnCount === 1 ? "has" : "have"} warnings`}>
											<span aria-hidden="true" className="codicon codicon-warning" />
											{warnCount}
										</span>
									)}
									<span className="map-layer-group__count">{group.layers.length}</span>
								</button>
								{!collapsed && (
									<>
										{groupNote && (
											<p className="map-layer-group__note">
												<span aria-hidden="true" className="codicon codicon-info" />
												{groupNote}
											</p>
										)}
										{groupTwins > 0 && (
											<p className="map-layer-group__note map-layer-group__note--action">
												<span aria-hidden="true" className="codicon codicon-files" />
												<span>
													{groupTwins} layers are the same tool run and source drawn more than once.
												</span>
												<button
													className="map-chip"
													onClick={() =>
														setConfirm({
															kind: "duplicates",
															names: duplicatesToRemove(orderedLayers, (id) =>
																visibleLayerIds.has(id),
															).map((l) => displayNames.get(l.id) ?? l.name ?? l.id),
														})
													}
													type="button">
													Remove duplicates
												</button>
											</p>
										)}
										<ul className="map-layer-list">
											{group.layers.map((layer, i) => {
												const displayName = displayNames.get(layer.id) ?? layer.name ?? layer.id
												const selected = selectedId === layer.id
												return (
													<LayerRow
														displayName={displayName}
														dragging={drag?.id === layer.id}
														dropTarget={drop?.id === layer.id ? drop.pos : null}
														duplicate={twins.has(layer.id)}
														justMoved={justLoadedId === layer.id}
														key={layer.id}
														layer={layer}
														sourceHint={sourceHintOf(layer.id)}
														menuItems={menuFor(layer, displayName)}
														note={groupNote ? undefined : indicators[i].note}
														onDragEnd={finishDrag}
														onDragOver={(e) => onRowDragOver(e, layer)}
														onDragStart={(e) => {
															e.dataTransfer.effectAllowed = "move"
															e.dataTransfer.setData("text/plain", layer.id)
															setDrag({ id: layer.id })
														}}
														onDrop={(e) => onRowDrop(e, layer)}
														onRenameCancel={() => {
															setRenamingId(null)
															setRenameDraft("")
														}}
														onRenameCommit={() => void commitRename(layer)}
														onRenameDraft={setRenameDraft}
														onSelect={() => select(selected ? null : layer.id)}
														onShowDetails={() => select(layer.id, { details: true })}
														onStartRename={() => {
															setRenamingId(layer.id)
															setRenameDraft(displayName)
														}}
														onToggleVisible={() =>
															onVisibilityChange(layer.id, !visibleLayerIds.has(layer.id))
														}
														renameDraft={renameDraft}
														renaming={renamingId === layer.id}
														selected={selected}
														visible={visibleLayerIds.has(layer.id)}
														warnings={indicators[i].warnings}>
														{selected && renderDrawer(layer, displayName)}
													</LayerRow>
												)
											})}
										</ul>
									</>
								)}
							</section>
						)
					})
				)}
			</div>

			<ProjectFilesSection
				data={project.data}
				files={notOnMapFiles}
				onLoad={loadProjectFile}
				onOpenFile={(file) => openSourceFile(file.relativePath, file.workspaceFolder)}
				onRemove={removeFromList}
				onRestore={restoreToList}
				onToggleOpen={toggleProjectOpen}
				open={projectOpen}
				reveal={reveal}
			/>

			{undo && (
				<div className="map-layers__undo" role="status">
					<span>{undo.label}.</span>
					<button className="map-chip" onClick={() => void handleUndo()} type="button">
						Undo
					</button>
				</div>
			)}

			{restoreState.olderCount > 0 && (
				<div className="map-layers__foot">
					<span>
						{restoreState.olderCount} older saved layer{restoreState.olderCount === 1 ? " is" : "s are"} kept but not
						loaded.
					</span>
					<button className="map-chip" disabled={restoringOlder} onClick={() => void restoreOlder()} type="button">
						{restoringOlder ? "Restoring…" : "Restore"}
					</button>
					{restoreError && (
						<div className="map-layers__status map-layers__status--err" role="alert">
							{restoreError}
						</div>
					)}
				</div>
			)}

			{confirm && (
				<div aria-label="Confirm removal" className="map-layers__confirm" role="alertdialog">
					<span>
						{confirm.kind === "all"
							? `Remove all ${layers.length} layers from the map?`
							: `Remove ${confirm.names.length} duplicate layer${confirm.names.length === 1 ? "" : "s"}? One copy of each stays: ${confirm.names.join(", ")}.`}
					</span>
					<button
						className="map-chip map-chip--danger"
						onClick={() => void (confirm.kind === "all" ? handleClearAll() : handleRemoveDuplicates())}
						type="button">
						Remove
					</button>
					<button className="map-chip" onClick={() => setConfirm(null)} type="button">
						Cancel
					</button>
				</div>
			)}
		</div>
	)
}

export default LayerPanelContent
