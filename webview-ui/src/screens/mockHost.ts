/**
 * Stand-in for the extension host's gRPC surface, used by the screen harness.
 * Every method resolves to an empty message unless the active screen supplies data,
 * so panels render their real "not reported" / empty branches rather than crashing.
 */

import { emptyToolsEnvStatus, formatToolsDiagnostics } from "@shared/aihydro/toolsEnv"
import type { ExtensionState } from "@shared/ExtensionMessage"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { getActiveScreen } from "./active"
import { buildBaseState } from "./fixtures/state"

type PfEntry = { relativePath: string; workspaceFolder: string; folderName: string; kind: "file" | "folder" }
/** The removed list of the current screen, kept while the screen is shown (the real host keeps it in global state). */
let pfRemoved: { screenId: string; entries: PfEntry[] } | undefined

function removedFor(screen: ReturnType<typeof getActiveScreen>): PfEntry[] {
	if (!pfRemoved || pfRemoved.screenId !== screen?.id) pfRemoved = { screenId: screen?.id ?? "", entries: [...(screen?.projectFiles?.removed ?? [])] }
	return pfRemoved.entries
}

function projectFilesAnswer(screen: ReturnType<typeof getActiveScreen>) {
	const pf = screen?.projectFiles
	const removed = removedFor(screen)
	const hidden = (f: { relativePath: string; workspaceFolder: string }) =>
		removed.some(
			(e) =>
				e.workspaceFolder === f.workspaceFolder &&
				(e.kind === "file" ? e.relativePath === f.relativePath : f.relativePath.startsWith(`${e.relativePath}/`)),
		)
	// After a Load the fixture map reports the screen's `layersAfterLoad`; a file with a layer there is on the map.
	const loaded = typeof window !== "undefined" && screen && (window as { __screensLoaded?: string }).__screensLoaded === screen.id
	const layerOf = (f: { relativePath: string; workspaceFolder: string }) =>
		loaded ? (screen?.layersAfterLoad ?? []).find((l) => l.metadata?.source_path === `${f.workspaceFolder}/${f.relativePath}`)?.id ?? "" : ""
	const files = (pf?.files ?? []).filter((f) => !hidden(f)).map((f) => ({ ...f, loadedLayerId: layerOf(f) }))
	return {
		files,
		totalCount: files.length,
		foldersSkipped: pf?.foldersSkipped ?? 0,
		skippedNames: pf?.skippedNames ?? [],
		symlinksFound: pf?.symlinksFound ?? 0,
		symlinksSkipped: pf?.symlinksSkipped ?? 0,
		truncated: pf?.truncated ?? false,
		folderCount: pf?.folderCount ?? (pf ? 1 : 0),
		removed: removed.map((e) => ({ ...e, name: e.relativePath.split("/").pop() ?? e.relativePath, removedAt: 0 })),
	}
}

function changeProjectFileList(screen: ReturnType<typeof getActiveScreen>, remove: boolean, request: unknown): number {
	const req = request as { entries?: { workspaceFolder: string; relativePath: string; kind?: string }[]; all?: boolean }
	const list = removedFor(screen)
	if (!remove && req.all) {
		const n = list.length
		list.length = 0
		return n
	}
	let changed = 0
	for (const e of req.entries ?? []) {
		const kind = e.kind === "folder" ? "folder" : "file"
		const i = list.findIndex((x) => x.workspaceFolder === e.workspaceFolder && x.relativePath === e.relativePath && x.kind === kind)
		if (remove && i < 0) {
			const folderName = screen?.projectFiles?.files.find((f) => f.workspaceFolder === e.workspaceFolder)?.folderName ?? ""
			list.push({ relativePath: e.relativePath, workspaceFolder: e.workspaceFolder, folderName, kind })
			changed++
		} else if (!remove && i >= 0) {
			list.splice(i, 1)
			changed++
		}
	}
	return changed
}

type Handlers = { onResponse?: (value: any) => void; onError?: (e: unknown) => void; onComplete?: () => void }

export function hostCall(service: string, method: string, request: unknown): Promise<unknown> {
	const screen = getActiveScreen()
	if (service === "LedgerServiceClient" && method === "getLedgerState") {
		if (screen?.ledger?.error) return Promise.reject(new Error(screen.ledger.error))
		return Promise.resolve({ sessionId: screen?.ledger?.sessionId ?? "", claims: screen?.ledger?.claims ?? [] })
	}
	if (service === "TaskServiceClient" && method === "getTaskHistory") {
		return Promise.resolve({
			tasks: buildState(screen?.state).taskHistory,
			totalCount: buildState(screen?.state).taskHistory.length,
		})
	}
	if (service === "HtmlPreviewServiceClient" && (method === "getHtmlPreviewState" || method === "getHtmlPreviewStateSince")) {
		const items = screen?.htmlPreviews ?? []
		return Promise.resolve({ items, itemCount: items.length })
	}
	if (
		service === "HtmlPreviewServiceClient" &&
		(method === "refreshModulesMarketplace" || method === "refreshCoursesMarketplace")
	) {
		if (screen?.marketplace?.error) return Promise.reject(new Error(screen.marketplace.error))
		const items = (method === "refreshModulesMarketplace" ? screen?.marketplace?.modules : screen?.marketplace?.courses) ?? []
		return Promise.resolve({ items })
	}
	if (service === "HtmlPreviewServiceClient" && method === "listPythonEnvironments") {
		return Promise.resolve({ environments: [], defaultProfileId: "" })
	}
	if (service === "HtmlPreviewServiceClient" && method === "getArtifactKernelInfo") {
		// Not running: the panel shows its real "no kernel" state; workspace trust is granted in the fixture host.
		return Promise.resolve({
			artifactId: "",
			interpreterPath: "",
			state: 0,
			cwd: "",
			lastError: "",
			profileId: "",
			label: "",
			pythonVersion: "",
			packagesProbe: "",
			kernelDirty: false,
			executionCount: 0,
			workspaceTrusted: false,
		})
	}
	if (service === "MapServiceClient" && method === "prepareMapExport") {
		return Promise.resolve({ accepted: true, basePath: "/fixture-no-disk-write" })
	}
	if (service === "MapServiceClient" && method === "saveMapExport") {
		const count = screen?.exportOutputs ?? 0
		const outputs = Array.from({ length: count }, (_, i) => ({
			format: i === 0 ? "png" : "provenance",
			uri: `file:///fixture/export-${i}`,
			filename: `fixture-export-${i}`,
			sha256: "0".repeat(64),
			sizeBytes: 1024,
		}))
		return Promise.resolve({ ok: true, outputs, message: "" })
	}
	if (service === "MapServiceClient" && method === "listWorkspaceGeoFiles") {
		return Promise.resolve(projectFilesAnswer(screen))
	}
	if (service === "MapServiceClient" && (method === "removeFromFileList" || method === "restoreToFileList")) {
		return Promise.resolve({ changed: changeProjectFileList(screen, method === "removeFromFileList", request) })
	}
	if (service === "MapServiceClient" && method === "addWorkspaceGeoFile") {
		const req = request as { relativePath?: string; workspaceFolder?: string }
		if (screen && typeof window !== "undefined") (window as { __screensLoaded?: string }).__screensLoaded = screen.id
		const made = (screen?.layersAfterLoad ?? []).find((l) => l.metadata?.source_path === `${req.workspaceFolder}/${req.relativePath}`)
		return Promise.resolve({ layerId: made?.id ?? "fixture-loaded", settingsRestored: false, positionFromTop: -1, sizeBytes: 0 })
	}
	if (service === "MapServiceClient" && method === "unloadMapLayer") {
		return Promise.resolve({ unloaded: true, settingsKept: true })
	}
	if (service === "MapServiceClient" && method === "getMapState") {
		return Promise.resolve({ layers: screen?.layers ?? [] })
	}
	// Catalogue calls answer the way the host does: an `items` array, empty when the screen supplies none.
	if (service === "McpServiceClient" && method === "refreshMcpMarketplace") {
		return Promise.resolve({ items: screen?.catalogues?.mcpMarketplace ?? [] })
	}
	if (service === "SkillsServiceClient" && method === "listInstalledSkills") {
		return Promise.resolve({ items: screen?.catalogues?.skillsInstalled ?? [] })
	}
	if (service === "SkillsServiceClient" && method === "refreshSkillsMarketplace") {
		return Promise.resolve({ items: screen?.catalogues?.skillsMarketplace ?? [] })
	}
	return Promise.resolve({})
}

export function hostSubscribe(service: string, method: string, _request: unknown, handlers: Handlers): () => void {
	const screen = getActiveScreen()
	if (service === "StateServiceClient" && method === "subscribeToState") {
		queueMicrotask(() => handlers.onResponse?.({ stateJson: JSON.stringify(buildState(screen?.state)) }))
	}
	if (service === "McpServiceClient" && method === "subscribeToMcpServers" && screen?.mcpServers) {
		const servers = screen.mcpServers
		// The host recomputes trust from the launcher record; the fixture states its verdict instead.
		const proto = convertMcpServersToProtoMcpServers(servers).map((p, i) => ({
			...p,
			trusted: servers[i].trust?.trusted ?? p.trusted,
			trustReason: servers[i].trust?.reason ?? p.trustReason,
		}))
		queueMicrotask(() => handlers.onResponse?.({ mcpServers: proto }))
	}
	if (service === "McpServiceClient" && method === "subscribeToToolsEnvStatus" && screen?.toolsEnv) {
		const status = emptyToolsEnvStatus(screen.toolsEnv)
		queueMicrotask(() =>
			handlers.onResponse?.({
				...status,
				extensionVersion: "fixture",
				diagnostics: formatToolsDiagnostics(status, "fixture"),
			}),
		)
	}
	return () => {}
}

function buildState(overrides?: Partial<ExtensionState>): ExtensionState {
	return buildBaseState(overrides)
}
