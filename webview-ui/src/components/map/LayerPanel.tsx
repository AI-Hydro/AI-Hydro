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

import { layerRunId, layerTool } from "@shared/map/provenanceEnvelope"
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
	duplicateIds,
	duplicatesToRemove,
	groupLayers,
	type LayerOrigin,
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

const copyText = (text: string) => void navigator.clipboard?.writeText(text)

/** What a selected row's drawer shows besides opacity. */
interface DrawerView {
	style: boolean
	attrs: boolean
	details: boolean
}
const CLOSED_DRAWER: DrawerView = { style: false, attrs: false, details: false }

/** A removal the user can take back. */
interface UndoEntry {
	label: string
	layers: { layer: MapLayer; visible: boolean }[]
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
	const [confirm, setConfirm] = useState<null | { kind: "all" } | { kind: "duplicates"; count: number }>(null)
	const [loadStatus, setLoadStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" })
	const [collapsedGroups, setCollapsedGroups] = useState<Set<LayerOrigin>>(new Set())
	const [undo, setUndo] = useState<UndoEntry | null>(null)
	const [drag, setDrag] = useState<{ id: string; origin: LayerOrigin } | null>(null)
	const [drop, setDrop] = useState<{ id: string; pos: "above" | "below" } | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const undoTimer = useRef<number | undefined>(undefined)

	useEffect(() => {
		saveMapWorkspace({ layerAliases })
	}, [layerAliases])
	useEffect(() => () => window.clearTimeout(undoTimer.current), [])

	const displayNames = useMemo(() => buildDisplayNames(layers, layerAliases), [layers, layerAliases])
	const visibleCount = useMemo(() => layers.filter((layer) => visibleLayerIds.has(layer.id)).length, [layers, visibleLayerIds])
	const restoredNote = useMemo(() => restoredLayersNote(layers, restoreState.olderCount), [layers, restoreState.olderCount])

	// Sorted layer list respects the custom order maintained in MapView
	const orderedLayers = useMemo(() => {
		if (layerOrder.length === 0) {
			return layers
		}
		const byId = new Map(layers.map((l) => [l.id, l]))
		const sorted = layerOrder.map((id) => byId.get(id)).filter(Boolean) as MapLayer[]
		// Append any layers not yet in the order list
		const inOrder = new Set(layerOrder)
		for (const l of layers) {
			if (!inOrder.has(l.id)) {
				sorted.push(l)
			}
		}
		return sorted
	}, [layers, layerOrder])

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

	const offerUndo = useCallback((entry: UndoEntry) => {
		window.clearTimeout(undoTimer.current)
		setUndo(entry)
		undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS)
	}, [])

	/** Remove layers from the map and the host. A failed host call puts that layer back and says so. */
	const removeLayers = async (targets: MapLayer[], label: string) => {
		if (targets.length === 0) return
		const previousOrder = orderedLayers.map((l) => l.id)
		const entry: UndoEntry = {
			label,
			layers: targets.map((layer) => ({ layer, visible: visibleLayerIds.has(layer.id) })),
			order: previousOrder,
		}
		const gone = new Set(targets.map((l) => l.id))
		for (const layer of targets) {
			removeLayer(layer.id)
			rasterCache.delete(layer.id)
			onVisibilityChange(layer.id, false)
		}
		onReorder(previousOrder.filter((id) => !gone.has(id)))
		if (selectedId && gone.has(selectedId)) select(null)
		if (renamingId && gone.has(renamingId)) setRenamingId(null)
		const failed: MapLayer[] = []
		await Promise.all(
			targets.map(async (layer) => {
				try {
					await MapServiceClient.removeMapLayer(RemoveMapLayerRequest.create({ layerId: layer.id }))
				} catch (err) {
					console.error("Failed to remove layer:", err)
					failed.push(layer)
				}
			}),
		)
		for (const layer of failed) addLayer(layer)
		if (failed.length > 0) {
			say("err", `Could not remove ${failed.length === 1 ? "the layer" : `${failed.length} layers`}.`, 6000)
			entry.layers = entry.layers.filter((e) => !failed.includes(e.layer))
		}
		if (entry.layers.length > 0) offerUndo(entry)
	}

	const handleUndo = async () => {
		const entry = undo
		if (!entry) return
		window.clearTimeout(undoTimer.current)
		setUndo(null)
		const failed: string[] = []
		for (const { layer, visible } of entry.layers) {
			addLayer(layer)
			try {
				await MapServiceClient.addMapLayer(AddMapLayerRequest.create({ layer, replaceExisting: true }))
				onVisibilityChange(layer.id, visible)
			} catch (err) {
				console.error("Failed to restore layer:", err)
				failed.push(layer.name || layer.id)
			}
		}
		onReorder(entry.order)
		say(failed.length ? "err" : "ok", failed.length ? `Could not restore ${failed.join(", ")}.` : "Restored.", 4000)
	}

	const handleClearAll = async () => {
		setConfirm(null)
		const previous = [...layers]
		clearLayers()
		for (const layer of previous) {
			rasterCache.delete(layer.id)
		}
		const previousOrder = orderedLayers.map((l) => l.id)
		const visibleBefore = new Set(visibleLayerIds)
		onReorder([])
		onHideAllLayers?.()
		select(null)
		setRenamingId(null)
		try {
			await MapServiceClient.clearMapLayers({})
			offerUndo({
				label: `Removed ${previous.length} layers`,
				layers: previous.map((layer) => ({ layer, visible: visibleBefore.has(layer.id) })),
				order: previousOrder,
			})
		} catch (err) {
			console.error("Failed to clear layers:", err)
			previous.forEach(addLayer)
			say("err", err instanceof Error ? err.message : "Failed to clear layers.", 6000)
		}
	}

	const handleRemoveDuplicates = async () => {
		const drop = duplicatesToRemove(orderedLayers, (id) => visibleLayerIds.has(id))
		setConfirm(null)
		await removeLayers(drop, `Removed ${drop.length} duplicate${drop.length === 1 ? "" : "s"}`)
	}

	// ── order ─────────────────────────────────────────────────────────────

	const orderIds = orderedLayers.map((l) => l.id)
	const moveWithinGroup = (layer: MapLayer, dir: -1 | 1) => {
		const group = groups.find((g) => g.layers.some((l) => l.id === layer.id))
		if (!group) return
		const ids = group.layers.map((l) => l.id)
		const neighbour = ids[ids.indexOf(layer.id) + dir]
		if (!neighbour) return
		const next = [...orderIds]
		const a = next.indexOf(layer.id)
		const b = next.indexOf(neighbour)
		;[next[a], next[b]] = [next[b], next[a]]
		onReorder(next)
	}

	const finishDrag = () => {
		setDrag(null)
		setDrop(null)
	}
	const onRowDragOver = (e: React.DragEvent, layer: MapLayer, origin: LayerOrigin) => {
		if (!drag || drag.origin !== origin || drag.id === layer.id) return
		e.preventDefault()
		e.dataTransfer.dropEffect = "move"
		const rect = e.currentTarget.getBoundingClientRect()
		const pos = e.clientY < rect.top + rect.height / 2 ? "above" : "below"
		setDrop((cur) => (cur?.id === layer.id && cur.pos === pos ? cur : { id: layer.id, pos }))
	}
	const onRowDrop = (e: React.DragEvent, layer: MapLayer) => {
		e.preventDefault()
		if (!drag || !drop || drag.id === layer.id) return finishDrag()
		const next = orderIds.filter((id) => id !== drag.id)
		const at = next.indexOf(layer.id)
		next.splice(drop.pos === "above" ? at : at + 1, 0, drag.id)
		onReorder(next)
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

	const menuFor = (layer: MapLayer, displayName: string, group: MapLayer[]): OverflowItem[] => {
		const isRaster = layer.layerType === "raster"
		const hasGeojson = !!layer.geojson && !isRaster
		const sourcePath = layer.metadata?.source_path || layer.metadata?.path || layer.metadata?.raster_source_path
		const provenancePath = layer.metadata?.provenance_path
		const tool = layerTool(layer.metadata)
		const run = layerRunId(layer.metadata)
		const at = group.findIndex((l) => l.id === layer.id)
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
			{ key: "style", label: "Style…", icon: "symbol-color", onSelect: () => select(layer.id, { style: true }) },
			{
				key: "opacity",
				label: "Opacity",
				icon: "color-mode",
				onSelect: () => {
					select(layer.id)
					window.setTimeout(() => document.getElementById(`map-layer-opacity-${layer.id}`)?.focus(), 0)
				},
			},
			hasGeojson && {
				key: "attrs",
				label: "Attribute table",
				icon: "table",
				onSelect: () => select(layer.id, { attrs: true }),
			},
			!isRaster &&
				hasGeojson &&
				layer.layerType === "point" && {
					key: "cluster",
					label: "Cluster points",
					checked: !!clusterLayerIds?.has(layer.id),
					onSelect: () => onClusterToggle?.(layer.id, !clusterLayerIds?.has(layer.id)),
				},
			{
				key: "details",
				label: "Details and provenance",
				icon: "info",
				onSelect: () => select(layer.id, { details: true }),
			},
			{ key: "d2", divider: true },
			!isRaster &&
				layer.metadata?.source !== "workspace" && {
					key: "save",
					label: "Save to workspace",
					icon: "save",
					onSelect: () => void handleSaveLayerToWorkspace(layer, displayName),
				},
			!isRaster &&
				layer.metadata?.source !== "workspace" &&
				hasGeojson && {
					key: "export",
					label: "Export as GeoJSON",
					icon: "export",
					onSelect: () => exportLayer(layer, displayName),
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
			(!!tool || !!run) && { key: "d3", divider: true },
			!!tool && {
				key: "copy-tool",
				label: "Copy tool name",
				icon: "copy",
				onSelect: () => {
					copyText(tool)
					say("ok", "Copied tool name.", 2500)
				},
			},
			!!run && {
				key: "copy-run",
				label: "Copy run ID",
				icon: "copy",
				onSelect: () => {
					copyText(run)
					say("ok", "Copied run ID.", 2500)
				},
			},
			{ key: "d4", divider: true },
			{
				key: "up",
				label: "Move up",
				icon: "arrow-up",
				disabledReason: at <= 0 ? "Already first in this group" : undefined,
				onSelect: () => moveWithinGroup(layer, -1),
			},
			{
				key: "down",
				label: "Move down",
				icon: "arrow-down",
				disabledReason: at >= group.length - 1 ? "Already last in this group" : undefined,
				onSelect: () => moveWithinGroup(layer, 1),
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
				{drawer.style && (
					<>
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
					/>
				)}
			</div>
		)
	}

	// ── render ────────────────────────────────────────────────────────────

	const allVisible = layers.length > 0 && visibleCount === layers.length

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
				{layers.length > 0 && (
					<button
						aria-label={allVisible ? "Hide all layers" : "Show all layers"}
						className="map-overflow-trigger"
						onClick={() => (allVisible ? onHideAllLayers?.() : onShowAllLayers?.())}
						title={allVisible ? "Hide all layers" : "Show all layers"}
						type="button">
						<span aria-hidden="true" className={`codicon codicon-${allVisible ? "eye" : "eye-closed"}`} />
					</button>
				)}
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
									title={label.hint}
									type="button">
									<span
										aria-hidden="true"
										className={`codicon codicon-chevron-${collapsed ? "right" : "down"}`}
									/>
									<span className="map-layer-group__title">{label.title}</span>
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
															count: duplicatesToRemove(orderedLayers, (id) =>
																visibleLayerIds.has(id),
															).length,
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
														menuItems={menuFor(layer, displayName, group.layers)}
														note={groupNote ? undefined : indicators[i].note}
														onDragEnd={finishDrag}
														onDragOver={(e) => onRowDragOver(e, layer, group.origin)}
														onDragStart={(e) => {
															e.dataTransfer.effectAllowed = "move"
															e.dataTransfer.setData("text/plain", layer.id)
															setDrag({ id: layer.id, origin: group.origin })
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
							: `Remove ${confirm.count} duplicate layer${confirm.count === 1 ? "" : "s"}? One copy of each stays.`}
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
