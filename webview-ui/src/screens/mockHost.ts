/**
 * Stand-in for the extension host's gRPC surface, used by the screen harness.
 * Every method resolves to an empty message unless the active screen supplies data,
 * so panels render their real "not reported" / empty branches rather than crashing.
 */
import type { ExtensionState } from "@shared/ExtensionMessage"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
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
	return () => {}
}

function buildState(overrides?: Partial<ExtensionState>): ExtensionState {
	return buildBaseState(overrides)
}
