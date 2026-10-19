import { EmptyRequest } from "@shared/proto/cline/common"
import { AddWorkspaceGeoFileRequest, type MapLayer, type WorkspaceGeoFile } from "@shared/proto/cline/map"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { MapServiceClient } from "../../services/grpc-client"

/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 8

/**
 * "Workspace files you can add": geo files found in the open workspace. They are candidates only; opening the
 * map no longer registers every `*.json` as a layer (that flooded the layer list and the badge). The user adds
 * a file with one click and it becomes an ordinary visible layer.
 *
 * Files already on the map (matched by the `path` metadata of workspace layers) are not listed again.
 */
export const WorkspaceFilesSection: React.FC<{ layers: MapLayer[]; fg: string; border: string; subtle: string }> = ({
	layers,
	fg,
	border,
	subtle,
}) => {
	const [files, setFiles] = useState<WorkspaceGeoFile[]>([])
	const [totalCount, setTotalCount] = useState(0)
	const [loaded, setLoaded] = useState(false)
	const [showAll, setShowAll] = useState(false)
	const [busyPath, setBusyPath] = useState<string | null>(null)
	const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)

	useEffect(() => {
		let cancelled = false
		MapServiceClient.listWorkspaceGeoFiles(EmptyRequest.create({}))
			.then((response) => {
				if (cancelled) return
				setFiles(response.files ?? [])
				setTotalCount(response.totalCount ?? response.files?.length ?? 0)
				setLoaded(true)
			})
			.catch(() => {
				if (!cancelled) setLoaded(true)
			})
		return () => {
			cancelled = true
		}
	}, [])

	const onMap = useMemo(() => new Set(layers.map((layer) => layer.metadata?.path).filter(Boolean)), [layers])
	const addable = useMemo(() => files.filter((file) => !onMap.has(file.relativePath)), [files, onMap])

	const add = useCallback(async (file: WorkspaceGeoFile) => {
		setBusyPath(file.relativePath)
		setStatus(null)
		try {
			await MapServiceClient.addWorkspaceGeoFile(AddWorkspaceGeoFileRequest.create({ relativePath: file.relativePath }))
			setStatus({ kind: "ok", msg: `Added ${file.name}.` })
		} catch (error) {
			setStatus({ kind: "err", msg: error instanceof Error ? error.message : `Could not add ${file.name}.` })
		} finally {
			setBusyPath(null)
		}
	}, [])

	if (!loaded || (addable.length === 0 && totalCount === 0)) {
		return null
	}

	const shown = showAll ? addable : addable.slice(0, COLLAPSED_ROWS)
	const truncated = totalCount > files.length
	return (
		<section
			aria-label="Workspace files you can add"
			style={{ borderTop: `1px solid ${border}`, padding: "6px 8px", fontSize: 11, color: fg }}>
			<div style={{ fontWeight: 600, marginBottom: 4 }}>Workspace files you can add ({addable.length})</div>
			{addable.length === 0 && <div style={{ opacity: 0.75 }}>All workspace geo files found are already on the map.</div>}
			{shown.map((file) => (
				<div key={file.relativePath} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
					<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={file.relativePath}>
						{file.relativePath}
					</span>
					<button
						aria-label={`Add ${file.relativePath} to the map`}
						disabled={busyPath !== null}
						onClick={() => void add(file)}
						style={{
							padding: "3px 8px",
							fontSize: 11,
							color: fg,
							background: subtle,
							border: `1px solid ${border}`,
							borderRadius: 3,
							cursor: busyPath === null ? "pointer" : "default",
						}}
						type="button">
						{busyPath === file.relativePath ? "Adding…" : "Add"}
					</button>
				</div>
			))}
			{addable.length > COLLAPSED_ROWS && (
				<button
					onClick={() => setShowAll((value) => !value)}
					style={{ marginTop: 4, padding: 0, background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 11 }}
					type="button">
					{showAll ? "Show fewer" : `Show all ${addable.length}`}
				</button>
			)}
			{truncated && <div style={{ opacity: 0.75, marginTop: 4 }}>Showing the first {files.length} of {totalCount} files found.</div>}
			{status && (
				<div role="status" style={{ marginTop: 4, color: status.kind === "err" ? "#dc3545" : undefined }}>
					{status.msg}
				</div>
			)}
		</section>
	)
}

/** "Restored N of M saved layers" from the `_hydrated` / `_hydrated_of` metadata the host stamps on restored layers. */
export function restoredLayersNote(layers: MapLayer[]): string | null {
	const restored = layers.filter((layer) => layer.metadata?._hydrated === "1")
	if (restored.length === 0) return null
	const savedTotal = Math.max(0, ...restored.map((layer) => Number.parseInt(layer.metadata?._hydrated_of ?? "", 10) || 0))
	return savedTotal > restored.length
		? `${restored.length} restored from earlier sessions (${savedTotal} saved; only the most recent ${restored.length} were restored).`
		: `${restored.length} restored from earlier sessions.`
}
