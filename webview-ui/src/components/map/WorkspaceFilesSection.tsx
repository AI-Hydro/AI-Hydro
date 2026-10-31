import { resolvedSourcePath } from "@shared/map/layerIdentity"
import { EmptyRequest } from "@shared/proto/cline/common"
import { AddWorkspaceGeoFileRequest, type MapLayer, type WorkspaceGeoFile } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { MapServiceClient } from "../../services/grpc-client"

/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 8

const workspaceFileKey = (folder: string | undefined, relativePath: string) => `${folder ?? ""}\u0000${relativePath}`

/**
 * Geo files found in the open workspace that are not on the map yet. They are candidates only: opening the map does
 * not register every `*.json` as a layer (that flooded the layer list). They are offered from the Add menu as
 * "From this workspace (N)"; there is no section for them in the panel.
 *
 * A file is "on the map" when a layer has the same resolved source path, however that layer got there (this list,
 * Add file, the Explorer menu, a restore or an agent), so a file already added never shows up here again.
 */
export function useWorkspaceCandidates(layers: MapLayer[]): {
	addable: WorkspaceGeoFile[]
	files: WorkspaceGeoFile[]
	totalCount: number
} {
	const [files, setFiles] = useState<WorkspaceGeoFile[]>([])
	const [totalCount, setTotalCount] = useState(0)

	useEffect(() => {
		let cancelled = false
		MapServiceClient.listWorkspaceGeoFiles(EmptyRequest.create({}))
			.then((response) => {
				if (cancelled) return
				setFiles(response.files ?? [])
				setTotalCount(response.totalCount ?? response.files?.length ?? 0)
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [])

	const onMap = useMemo(() => {
		const resolved = new Set<string>()
		const pathOnly = new Set<string>()
		for (const layer of layers) {
			const key = resolvedSourcePath(layer.metadata)
			if (key) resolved.add(key)
			// Layers saved before the folder was recorded match by relative path alone.
			if (layer.metadata?.path && !layer.metadata.workspace_folder) pathOnly.add(layer.metadata.path)
		}
		return { resolved, pathOnly }
	}, [layers])

	const addable = useMemo(
		() =>
			files.filter(
				(file) =>
					!onMap.resolved.has(
						resolvedSourcePath({ path: file.relativePath, workspace_folder: file.workspaceFolder }) ?? "",
					) && !onMap.pathOnly.has(file.relativePath),
			),
		[files, onMap],
	)
	return { addable, files, totalCount }
}

/** The list opened by "From this workspace (N)". Closes itself when the last file is added. */
export const WorkspaceFilePicker: React.FC<{
	addable: WorkspaceGeoFile[]
	files: WorkspaceGeoFile[]
	totalCount: number
	border: string
	fg: string
	onClose: () => void
	/** A one-line result for the panel's status area, which expires on its own. */
	onStatus: (kind: "ok" | "err", msg: string) => void
}> = ({ addable, files, totalCount, border, fg, onClose, onStatus }) => {
	const [showAll, setShowAll] = useState(false)
	const [busyKey, setBusyKey] = useState<string | null>(null)
	const multiRoot = useMemo(() => new Set(files.map((file) => file.workspaceFolder).filter(Boolean)).size > 1, [files])

	useEffect(() => {
		if (addable.length === 0) onClose()
	}, [addable.length, onClose])

	const add = useCallback(
		async (file: WorkspaceGeoFile) => {
			setBusyKey(workspaceFileKey(file.workspaceFolder, file.relativePath))
			try {
				await MapServiceClient.addWorkspaceGeoFile(
					AddWorkspaceGeoFileRequest.create({ relativePath: file.relativePath, workspaceFolder: file.workspaceFolder }),
				)
				onStatus("ok", `Added ${file.name}.`)
			} catch (error) {
				onStatus("err", error instanceof Error ? error.message : `Could not add ${file.name}.`)
			} finally {
				setBusyKey(null)
			}
		},
		[onStatus],
	)

	const shown = showAll ? addable : addable.slice(0, COLLAPSED_ROWS)
	return (
		<section
			aria-label="From this workspace"
			style={{ borderTop: `1px solid ${border}`, padding: "6px 8px", fontSize: 11, color: fg }}>
			<div className="map-section-head">
				<span className="map-section-label">
					<span aria-hidden="true" className="codicon codicon-folder" />
					{`From this workspace (${addable.length})`}
				</span>
				<button
					aria-label="Close the workspace file list"
					className="map-overflow-trigger"
					onClick={onClose}
					type="button">
					<span aria-hidden="true" className="codicon codicon-close" />
				</button>
			</div>
			{shown.map((file) => (
				<div
					key={workspaceFileKey(file.workspaceFolder, file.relativePath)}
					style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 28 }}>
					<span
						style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
						title={workspaceFileKey(file.workspaceFolder, file.relativePath).replace("\u0000", " / ")}>
						{multiRoot && file.folderName ? `${file.folderName} / ` : ""}
						{file.relativePath}
					</span>
					<button
						aria-label={`Add ${file.relativePath} to the map`}
						className="map-chip"
						disabled={busyKey !== null}
						onClick={() => void add(file)}
						type="button">
						{busyKey === workspaceFileKey(file.workspaceFolder, file.relativePath) ? "Adding…" : "Add"}
					</button>
				</div>
			))}
			{addable.length > COLLAPSED_ROWS && (
				<button className="map-chip" onClick={() => setShowAll((value) => !value)} style={{ marginTop: 4 }} type="button">
					{showAll ? "Show fewer" : `Show all ${addable.length}`}
				</button>
			)}
			{totalCount > files.length && (
				<div style={{ opacity: 0.75, marginTop: 4 }}>
					Showing the first {files.length} of {totalCount} files found.
				</div>
			)}
		</section>
	)
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
