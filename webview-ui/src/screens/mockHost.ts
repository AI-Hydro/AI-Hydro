/**
 * Stand-in for the extension host's gRPC surface, used by the screen harness.
 * Every method resolves to an empty message unless the active screen supplies data,
 * so panels render their real "not reported" / empty branches rather than crashing.
 */
import type { ExtensionState } from "@shared/ExtensionMessage"
import { getActiveScreen } from "./active"
import { buildBaseState } from "./fixtures/state"

type Handlers = { onResponse?: (value: any) => void; onError?: (e: unknown) => void; onComplete?: () => void }

export function hostCall(service: string, method: string, _request: unknown): Promise<unknown> {
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
	if (service === "HtmlPreviewServiceClient" && method === "getHtmlPreviewState") {
		const items = screen?.htmlPreviews ?? []
		return Promise.resolve({ items, itemCount: items.length })
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
		const files = (screen?.workspaceFiles ?? []).map((relativePath) => ({
			relativePath,
			name: relativePath.split("/").pop() ?? relativePath,
			extension: `.${relativePath.split(".").pop() ?? "geojson"}`,
		}))
		return Promise.resolve({ files, totalCount: files.length })
	}
	if (service === "MapServiceClient" && method === "getMapState") {
		return Promise.resolve({ layers: screen?.layers ?? [] })
	}
	return Promise.resolve({})
}

export function hostSubscribe(service: string, method: string, _request: unknown, handlers: Handlers): () => void {
	const screen = getActiveScreen()
	if (service === "StateServiceClient" && method === "subscribeToState") {
		queueMicrotask(() => handlers.onResponse?.({ stateJson: JSON.stringify(buildState(screen?.state)) }))
	}
	return () => {}
}

function buildState(overrides?: Partial<ExtensionState>): ExtensionState {
	return buildBaseState(overrides)
}
