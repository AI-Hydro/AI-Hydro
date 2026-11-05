/**
 * ProjectFilesSection: every map file of the open folders, in one collapsed tree below "On the map".
 *
 *   Project files · 12 files, 3 loaded
 *     data/
 *       [icon] basin.geojson   1.2 MB   [check] [Unload] [more]
 *       [icon] gauges.geojson  96 KB            [Load]   [more]
 *
 * A file stays where it is when it is loaded: Load and Unload act in place and a loaded row shows a check. Removing a
 * row from the list hides it on this machine and never touches the file; the removed rows are kept under
 * "Removed from list (N)" with Restore. The panel owns the actions (so Undo and the status line are one); this component
 * owns the tree, the filter and the confirmation before a very large load.
 */

import { formatBytes, formatCount, isLargeLoad, LARGE_LOAD_BYTES, projectFilesHeader } from "@shared/map/projectFiles"
import type { RemovedFileEntry, WorkspaceGeoFile } from "@shared/proto/cline/map"
import React, { useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { type OverflowItem, OverflowMenu } from "./OverflowMenu"
import {
	buildRows,
	type FolderRef,
	FILTER_ABOVE,
	fileIcon,
	fileKey,
	loadedCount,
	type PfRow,
	unloadedMatches,
} from "./projectFilesModel"
import type { ProjectFilesData } from "./WorkspaceFilesSection"

const ROW_HEIGHT = 28

export interface ProjectFilesSectionProps {
	data: ProjectFilesData
	/** Resolved paths of the files on the map. */
	loadedPaths: Set<string>
	open: boolean
	onToggleOpen: () => void
	/** Load a file. Rejects with the reason when it fails; the row then offers Retry. */
	onLoad: (file: WorkspaceGeoFile) => Promise<void>
	onUnload: (file: WorkspaceGeoFile) => Promise<void>
	onOpenFile: (file: WorkspaceGeoFile) => void
	onRemove: (entries: { file?: WorkspaceGeoFile; folder?: FolderRef }[], label: string) => Promise<void>
	onRestore: (entries: RemovedFileEntry[] | "all") => Promise<void>
}

const TOOLTIP_REMOVE =
	"Hides this in the Project files list, on this machine only. The file stays on disk and can be restored from Removed from list."

export const ProjectFilesSection: React.FC<ProjectFilesSectionProps> = ({
	data,
	loadedPaths,
	open,
	onToggleOpen,
	onLoad,
	onUnload,
	onOpenFile,
	onRemove,
	onRestore,
}) => {
	const [filter, setFilter] = useState("")
	const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
	const [removedOpen, setRemovedOpen] = useState(false)
	const [busy, setBusy] = useState<string | null>(null)
	const [failed, setFailed] = useState<Map<string, string>>(new Map())
	const [pendingLarge, setPendingLarge] = useState<WorkspaceGeoFile | null>(null)

	const loaded = useMemo(() => loadedCount(data.files, loadedPaths), [data.files, loadedPaths])
	const rows = useMemo(
		() => buildRows({ files: data.files, removed: data.removed, loadedPaths, filter, open: openFolders, removedOpen }),
		[data.files, data.removed, loadedPaths, filter, openFolders, removedOpen],
	)
	const matches = useMemo(() => unloadedMatches(data.files, filter, loadedPaths), [data.files, filter, loadedPaths])
	const header = projectFilesHeader(data.totalCount, loaded, data.truncated)
	const showFilter = data.files.length > FILTER_ABOVE

	// The set holds folders the user flipped from their starting state (open with 20 files or fewer, closed above).
	const toggleFolder = (key: string) =>
		setOpenFolders((prev) => {
			const next = new Set(prev)
			next.has(key) ? next.delete(key) : next.add(key)
			return next
		})

	const runLoad = async (file: WorkspaceGeoFile, confirmed = false) => {
		if (!confirmed && isLargeLoad(file.sizeBytes)) {
			setPendingLarge(file)
			return
		}
		setPendingLarge(null)
		const key = fileKey(file.workspaceFolder, file.relativePath)
		setBusy(key)
		try {
			await onLoad(file)
			setFailed((prev) => {
				if (!prev.has(key)) return prev
				const next = new Map(prev)
				next.delete(key)
				return next
			})
		} catch (error) {
			setFailed((prev) => new Map(prev).set(key, error instanceof Error ? error.message : `Could not load ${file.name}.`))
		} finally {
			setBusy(null)
		}
	}
	const runUnload = async (file: WorkspaceGeoFile) => {
		const key = fileKey(file.workspaceFolder, file.relativePath)
		setBusy(key)
		try {
			await onUnload(file)
		} finally {
			setBusy(null)
		}
	}

	const fileMenu = (file: WorkspaceGeoFile): OverflowItem[] => [
		{ key: "open", label: "Open file", icon: "go-to-file", onSelect: () => onOpenFile(file) },
		{
			key: "remove",
			label: "Remove from list",
			icon: "close",
			title: TOOLTIP_REMOVE,
			onSelect: () =>
				void onRemove([{ file }], `Removed ${file.name} from this list. The file stays on disk`),
		},
	]
	const folderMenu = (row: Extract<PfRow, { kind: "folder" }>): OverflowItem[] => [
		{
			key: "remove-folder",
			label: "Remove folder from list",
			icon: "close",
			title: TOOLTIP_REMOVE,
			// An open folder itself (multi-root root) is not removed: it is the project.
			disabledReason: row.path === "" ? "An open folder is the project itself" : undefined,
			onSelect: () =>
				void onRemove([{ folder: row.entry }], `Removed the folder ${row.name} from this list. The files stay on disk`),
		},
	]

	const renderRow = (row: PfRow) => {
		const indent = { paddingLeft: 4 + ("depth" in row ? row.depth * 14 : 0) }
		if (row.kind === "folder") {
			return (
				<div
					aria-expanded={row.open}
					aria-level={row.depth + 1}
					className="map-pf-row"
					role="treeitem"
					style={indent}
					tabIndex={-1}>
					<button
						aria-label={`${row.open ? "Collapse" : "Expand"} ${row.name}`}
						className="map-pf-name"
						onClick={() => toggleFolder(row.key)}
						type="button">
						<span aria-hidden="true" className={`codicon codicon-chevron-${row.open ? "down" : "right"}`} />
						<span aria-hidden="true" className="codicon codicon-folder" />
						<span className="map-pf-name__text">{row.name}</span>
						<span className="map-pf-meta">{row.count.toLocaleString("en-US")}</span>
					</button>
					<OverflowMenu items={folderMenu(row)} label={`Actions for folder ${row.name}`} />
				</div>
			)
		}
		if (row.kind === "removed-head") {
			return (
				<div className="map-pf-row map-pf-row--head" role="treeitem" style={indent}>
					<button
						aria-expanded={row.open}
						className="map-pf-name"
						onClick={() => setRemovedOpen((v) => !v)}
						type="button">
						<span aria-hidden="true" className={`codicon codicon-chevron-${row.open ? "down" : "right"}`} />
						<span className="map-pf-name__text">{`Removed from list (${row.count})`}</span>
					</button>
					{row.open && (
						<button className="map-chip" onClick={() => void onRestore("all")} type="button">
							Restore all
						</button>
					)}
				</div>
			)
		}
		if (row.kind === "removed") {
			const e = row.entry
			return (
				<div aria-level={2} className="map-pf-row" role="treeitem" style={{ paddingLeft: 18 }}>
					<span className="map-pf-name map-pf-name--static" title={`${e.folderName ? `${e.folderName} / ` : ""}${e.relativePath}`}>
						<span aria-hidden="true" className={`codicon codicon-${e.kind === "folder" ? "folder" : "json"}`} />
						<span className="map-pf-name__text">{e.relativePath}</span>
					</span>
					<button
						aria-label={`Restore ${e.relativePath}`}
						className="map-chip"
						onClick={() => void onRestore([e])}
						type="button">
						Restore
					</button>
				</div>
			)
		}
		const { file } = row
		const key = fileKey(file.workspaceFolder, file.relativePath)
		const isBusy = busy === key
		const error = failed.get(key)
		const size = formatBytes(file.sizeBytes)
		return (
			<div
				aria-level={row.depth + 1}
				className="map-pf-row"
				data-loaded={row.loaded || undefined}
				onDoubleClick={() => (row.loaded ? undefined : void runLoad(file))}
				role="treeitem"
				style={indent}
				tabIndex={-1}>
				<span
					className="map-pf-name map-pf-name--static"
					title={`${row.multiRoot && file.folderName ? `${file.folderName} / ` : ""}${file.relativePath}${size ? `\n${size}` : ""}`}>
					<span aria-hidden="true" className={`codicon codicon-${fileIcon(file.extension)}`} />
					<span className="map-pf-name__text">{row.depth === 0 && filter ? file.relativePath : file.name}</span>
					{row.multiRoot && filter && file.folderName ? <span className="map-pf-meta">{file.folderName}</span> : null}
				</span>
				{size && <span className="map-pf-meta">{size}</span>}
				{error && (
					<span
						aria-label={`Could not load ${file.name}: ${error}`}
						className="map-layer-flag map-layer-flag--warn"
						role="img"
						title={error}>
						<span aria-hidden="true" className="codicon codicon-warning" />
					</span>
				)}
				{row.loaded && (
					<span aria-label="Loaded" className="map-pf-check" role="img" title="On the map">
						<span aria-hidden="true" className="codicon codicon-check" />
					</span>
				)}
				<button
					aria-label={`${row.loaded ? "Unload" : error ? "Retry loading" : "Load"} ${file.relativePath}`}
					className="map-chip"
					disabled={isBusy}
					onClick={() => void (row.loaded ? runUnload(file) : runLoad(file))}
					title={
						row.loaded
							? "Take it off the map. The file stays on disk, and its style is kept for next time."
							: "Put it on the map"
					}
					type="button">
					{isBusy ? (row.loaded ? "Unloading…" : "Loading…") : row.loaded ? "Unload" : error ? "Retry" : "Load"}
				</button>
				<OverflowMenu items={fileMenu(file)} label={`Actions for ${file.relativePath}`} />
			</div>
		)
	}

	const noFolder = !data.loading && data.folderCount === 0 && data.files.length === 0 && data.removed.length === 0
	const empty = !data.loading && !noFolder && data.files.length === 0 && data.removed.length === 0

	return (
		<section aria-label="Project files" className="map-pf" data-open={open || undefined}>
			<button aria-expanded={open} className="map-layer-group__head map-pf__head" onClick={onToggleOpen} type="button">
				<span aria-hidden="true" className={`codicon codicon-chevron-${open ? "down" : "right"}`} />
				<span className="map-layer-group__title">{noFolder || data.loading ? "Project files" : header}</span>
			</button>
			{open && (
				<div className="map-pf__body">
					{(data.foldersSkipped > 0 || data.symlinksFound > 0) && (
						<p className="map-pf-notes">
							{data.foldersSkipped > 0 && (
								<span title={`Not scanned: ${data.skippedNames.join(", ")} (top level of each folder)`}>
									{`${data.foldersSkipped} folder${data.foldersSkipped === 1 ? "" : "s"} skipped`}
								</span>
							)}
							{data.symlinksFound > 0 && (
								<span
									title={
										data.symlinksSkipped > 0
											? "A symlink that leads outside its folder is not a project file, so it is not listed."
											: "Symlinked files inside the folder are listed."
									}>
									{`${data.symlinksFound} symlink${data.symlinksFound === 1 ? "" : "s"}${data.symlinksSkipped > 0 ? `, ${data.symlinksSkipped} outside the folder and not listed` : ""}`}
								</span>
							)}
						</p>
					)}
					{data.truncated && (
						<p className="map-pf-notes">
							{`Listing stops at ${formatCount(data.files.length, false)} files; there are more. Narrow it with the filter or the exclude settings.`}
						</p>
					)}
					{showFilter && (
						<div className="map-pf-filter">
							<input
								aria-label="Filter project files"
								onChange={(e) => setFilter(e.target.value)}
								placeholder="Filter by name or folder"
								type="search"
								value={filter}
							/>
							{filter.trim() !== "" && (
								<>
									<span className="map-pf-meta" role="status">
										{`${rows.filter((r) => r.kind === "file").length.toLocaleString("en-US")} match${rows.filter((r) => r.kind === "file").length === 1 ? "" : "es"}`}
									</span>
									{matches.length > 0 && (
										<button
											className="map-chip"
											onClick={() =>
												void onRemove(
													matches.map((file) => ({ file })),
													`Removed ${matches.length.toLocaleString("en-US")} files from this list. The files stay on disk`,
												).then(() => setFilter(""))
											}
											title={TOOLTIP_REMOVE}
											type="button">
											{`Remove ${matches.length.toLocaleString("en-US")} match${matches.length === 1 ? "" : "es"}`}
										</button>
									)}
								</>
							)}
						</div>
					)}
					{pendingLarge && (
						<div aria-label="Confirm large load" className="map-pf-confirm" role="alertdialog">
							<span>
								{`${pendingLarge.name} is ${formatBytes(pendingLarge.sizeBytes)}. Files above ${formatBytes(LARGE_LOAD_BYTES)} can leave the window unresponsive for several seconds while they load. Load it anyway?`}
							</span>
							<button className="map-chip map-chip--primary" onClick={() => void runLoad(pendingLarge, true)} type="button">
								Load
							</button>
							<button className="map-chip" onClick={() => setPendingLarge(null)} type="button">
								Cancel
							</button>
						</div>
					)}
					{noFolder && <div className="map-pf-empty">No folder open.</div>}
					{empty && (
						<div className="map-pf-empty">
							<strong>No map files in this folder.</strong>
							<span>GeoJSON, KML, GPX, Shapefile, FlatGeobuf and GeoTIFF files appear here as they are added.</span>
						</div>
					)}
					{rows.length > 0 && (
						<div aria-label="Project files" className="map-pf-tree" role="tree">
							<Virtuoso
								computeItemKey={(i, row) => row?.key ?? i}
								data={rows}
								fixedItemHeight={ROW_HEIGHT}
								itemContent={(_i, row) => (row ? renderRow(row) : null)}
								style={{ height: "100%" }}
							/>
						</div>
					)}
				</div>
			)}
		</section>
	)
}
