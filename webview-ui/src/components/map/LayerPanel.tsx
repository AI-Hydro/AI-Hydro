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

import { StringRequest } from "@shared/proto/cline/common"
import type { MapLayer } from "@shared/proto/cline/map"
import { AddMapLayerRequest, RemoveMapLayerRequest, SaveRoiToWorkspaceRequest } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { useMapContext } from "../../context/MapContext"
import { FileServiceClient, MapServiceClient } from "../../services/grpc-client"
import { ACCEPTED_EXTENSIONS, loadAndPushFileEntries, loadAndPushFiles } from "./formats"
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
	rowIndicators,
	sharedNote,
} from "./layerModel"
import { AttributeTable, LayerInspector, niceMetadata } from "./layerPanelParts"
import { loadMapWorkspace, saveMapWorkspace } from "./mapWorkspace"
import { type OverflowItem, OverflowMenu } from "./OverflowMenu"
import { SymbologyEditor } from "./SymbologyEditor"
import { restoredLayersNote, WorkspaceFilesSection } from "./WorkspaceFilesSection"

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

const openSourceFile = (filePath: string) => {
	PLATFORM_CONFIG.postMessage({ type: "aihydro-open-source-file", path: filePath })
}

function newUiRequestId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function resolveSourceFileUri(filePath: string): Promise<{ uri: string; name: string }> {
	const requestId = newUiRequestId("source")
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			reject(new Error("Timed out resolving source file"))
		}, 30_000)
		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-resolve-file-uri-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			if (data.ok && typeof data.uri === "string") {
				resolve({ uri: data.uri, name: data.name ?? filePath.split("/").pop() ?? "layer" })
			} else {
				reject(new Error(data.error ?? "Could not resolve source file"))
			}
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-resolve-file-uri", requestId, path: filePath })
	})
}

const buildDisplayNames = (layers: MapLayer[], aliases: Record<string, string>): Map<string, string> => {
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
const CLOSED_DRAWER: DrawerView = { style: false, attrs: false, details: false, saveAs: false }

/** A removal the user can take back. */
interface UndoEntry {
	label: string
	/** The layer and what the user had set on it, so Undo gives back more than the geometry. */
	layers: { layer: MapLayer; visible: boolean; opacity?: number; clustered: boolean }[]
	order: string[]
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
	const [loadStatus, setLoadStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" })
	const [collapsedGroups, setCollapsedGroups] = useState<Set<LayerOrigin>>(new Set())
	// Back-to-back removals each stay undoable (most recent first); the whole stack expires together.
	const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
	const undo = undoStack[undoStack.length - 1] ?? null
	const stackRef = useRef<UndoEntry[]>([])
	/** Raster values of removed layers: kept until the undo window closes, so Undo gets the values back too. */
	const staleRasters = useRef<Set<string>>(new Set())
	const [drag, setDrag] = useState<{ id: string } | null>(null)
	const [drop, setDrop] = useState<{ id: string; pos: "above" | "below" } | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
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

	const say = useCallback((kind: "ok" | "err" | "idle", msg: string, ms = 3500) => {
		setLoadStatus({ kind, msg })
		if (msg) window.setTimeout(() => setLoadStatus((cur) => (cur.msg === msg ? { kind: "idle", msg: "" } : cur)), ms)
	}, [])

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

	const select = (id: string | null, view: Partial<DrawerView> = {}) => {
		setSelectedId(id)
		setDrawer({ ...CLOSED_DRAWER, ...view })
	}

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
			const resolved = await resolveSourceFileUri(sourcePath)
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
						path: sourcePath,
						uri: layer.metadata?.source_uri,
						displayPath: layer.metadata?.source_display_path ?? sourcePath,
						format: layer.metadata?.source_format ?? layer.metadata?.format,
					},
				},
			])
			if (result.loaded > 0) {
				say("ok", `Reloaded ${displayName}.`, 5000)
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
	const removeLayers = async (targets: MapLayer[], label: string) => {
		if (targets.length === 0) return
		const previousOrder = drawLayers.map((l) => l.id)
		const captured = targets.map(capture)
		const removed: MapLayer[] = []
		let failed = 0
		await Promise.all(
			targets.map(async (layer) => {
				try {
					await MapServiceClient.removeMapLayer(RemoveMapLayerRequest.create({ layerId: layer.id }))
					removed.push(layer)
				} catch (err) {
					console.error("Failed to remove layer:", err)
					failed++
				}
			}),
		)
		if (failed > 0) say("err", `Could not remove ${failed === 1 ? "the layer" : `${failed} layers`}.`, 6000)
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
		pushUndo({ label, layers: captured.filter((c) => gone.has(c.layer.id)), order: previousOrder })
	}

	/** Undo the latest removal. The host is asked first; only layers it took back reappear in the panel. */
	const handleUndo = async () => {
		const entry = stackRef.current[stackRef.current.length - 1]
		if (!entry) return
		stackRef.current = stackRef.current.slice(0, -1)
		setUndoStack(stackRef.current)
		if (stackRef.current.length > 0) armUndoTimer()
		else window.clearTimeout(undoTimer.current)
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
		const present = new Set([...orderIds, ...back])
		onReorder([...entry.order.filter((id) => present.has(id)), ...orderIds.filter((id) => !entry.order.includes(id))])
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
	const onPickFiles = () => fileInputRef.current?.click()

	const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files || files.length === 0) {
			return
		}
		say("idle", "Loading…", 15_000)
		const result = await loadAndPushFiles(files)
		if (result.loaded > 0 && result.errors.length === 0) {
			say("ok", `Loaded ${result.loaded} layer${result.loaded > 1 ? "s" : ""}.`, 5000)
		} else if (result.loaded > 0) {
			say("ok", `Loaded ${result.loaded}, ${result.errors.length} error${result.errors.length > 1 ? "s" : ""}.`, 5000)
		} else {
			say("err", result.errors[0] ?? "No files loaded.", 6000)
		}
		if (fileInputRef.current) {
			fileInputRef.current.value = ""
		}
	}

	// ── menus ─────────────────────────────────────────────────────────────

	const menuFor = (layer: MapLayer, displayName: string): OverflowItem[] => {
		const isRaster = layer.layerType === "raster"
		const sourcePath = layer.metadata?.source_path || layer.metadata?.path || layer.metadata?.raster_source_path
		const provenancePath = layer.metadata?.provenance_path
		const rank = displayIds.indexOf(layer.id)
		const items: (OverflowItem | false)[] = [
			{ key: "zoom", label: "Zoom to layer", icon: "zoom-in", onSelect: () => onZoomToLayer?.(layer) },
			{
				key: "rename",
				label: "Rename",
				icon: "edit",
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
				label: "Open source file",
				icon: "go-to-file",
				onSelect: () => openSourceFile(sourcePath),
			},
			!!sourcePath && {
				key: "reload",
				label: "Reload source",
				icon: "refresh",
				onSelect: () => void handleReloadSource(layer, displayName),
			},
			!!provenancePath && {
				key: "provenance",
				label: "Open provenance record",
				icon: "file-code",
				onSelect: () => void openProvenance(provenancePath),
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
			{
				key: "remove",
				label: "Remove layer",
				icon: "trash",
				danger: true,
				onSelect: () => void removeLayers([layer], `Removed “${displayName}”`),
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
						warnings={rowIndicators(layer, intelligence).warnings}
					/>
				)}
			</div>
		)
	}

	// ── render ────────────────────────────────────────────────────────────

	return (
		<div className="map-layers">
			<input
				accept={ACCEPTED_EXTENSIONS}
				multiple
				onChange={onFilesPicked}
				ref={fileInputRef}
				style={{ display: "none" }}
				type="file"
			/>

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
					</div>
				)}
			</div>

			<div className="map-layers__list">
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
														key={layer.id}
														layer={layer}
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

			<WorkspaceFilesSection
				border="var(--vscode-editorWidget-border, rgba(128,128,128,0.35))"
				fg="var(--vscode-foreground)"
				layers={layers}
				subtle="color-mix(in srgb, var(--vscode-foreground) 6%, transparent)"
			/>

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
