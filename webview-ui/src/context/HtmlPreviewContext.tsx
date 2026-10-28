import { EmptyRequest } from "@shared/proto/cline/common"
import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import { RemoveHtmlPreviewItemRequest } from "@shared/proto/cline/html_preview"
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { webviewState } from "../config/platform.config"
import { HtmlPreviewServiceClient } from "../services/grpc-client"
import { useExtensionState } from "./ExtensionStateContext"
import { applyPreviewItemOp, type PreviewItemOp, reconcileSnapshot } from "./htmlPreviewReconcile"

/**
 * HtmlPreviewContext — webview-side state for the AI-Hydro HTML Preview panel.
 *
 * The contract with the extension (post-redesign):
 *   • `HtmlPreviewItem.webviewUri` is the URL the iframe should load
 *     (produced by `webview.asWebviewUri()` on the extension side).
 *   • `htmlContent` carries inline HTML when its UTF-8 encoding is at or
 *     below 8 MiB (preferred `srcdoc` render path); otherwise the webview
 *     falls back to `webviewUri`.
 *   • Rendering profile (scripts on/off) is chosen on the extension via
 *     `detectMode()` — the UI exposes a single "Preview" experience.
 */
/**
 * Module manifest payload (matches the `application/vnd.aihydro.module+json`
 * block authors embed at the top of a module). All fields are optional from
 * the panel's perspective — it just surfaces whatever is present.
 */
export interface AiHydroModuleManifest {
	id?: string
	title?: string
	version?: string
	authors?: Array<{ name?: string; affiliation?: string; orcid?: string }>
	license?: string
	topic?: string
	level?: "intro" | "intermediate" | "advanced" | string
	estimated_minutes?: number
	requires?: { executable?: boolean; python?: string[] }
	citation?: { text?: string; doi?: string }
	thumbnail?: string
	ai_hydro_preview_min_version?: string
	[k: string]: unknown
}

interface HtmlPreviewContextType {
	items: HtmlPreviewItem[]
	/** True once a preview snapshot from the host has been applied at least once. */
	snapshotLoaded: boolean
	activeItemId: string | null
	setActiveItemId: (id: string | null) => void
	refreshItems: () => Promise<void>
	removeItem: (id: string) => Promise<void>
	clearAllItems: () => Promise<void>
	addItemFromContent: (title: string, htmlContent: string, filePath?: string) => Promise<void>
	loadWorkspaceFile: (filePath: string, title: string) => Promise<void>
	manifestsById: Record<string, AiHydroModuleManifest>
	setManifest: (itemId: string, manifest: AiHydroModuleManifest) => void
}

const HtmlPreviewContext = createContext<HtmlPreviewContextType>({
	items: [],
	snapshotLoaded: false,
	activeItemId: null,
	setActiveItemId: () => {},
	refreshItems: async () => {},
	removeItem: async () => {},
	clearAllItems: async () => {},
	addItemFromContent: async () => {},
	loadWorkspaceFile: async () => {},
	manifestsById: {},
	setManifest: () => {},
})

/** Preview ids are `<source>_<hash of the path>`; log only a short prefix so traces carry no stable file identity. */
const shortId = (id: string) => id.slice(0, 10)

const ACTIVATION_SEQ_KEY = "studioLastActivationSeq"

export const HtmlPreviewContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [items, setItems] = useState<HtmlPreviewItem[]>([])
	const [activeItemId, setActiveItemId] = useState<string | null>(null)
	const [snapshotLoaded, setSnapshotLoaded] = useState(false)
	const [manifestsById, setManifestsById] = useState<Record<string, AiHydroModuleManifest>>({})
	const setManifest = useCallback((itemId: string, manifest: AiHydroModuleManifest) => {
		setManifestsById((prev) => ({ ...prev, [itemId]: manifest }))
	}, [])
	const activeItemIdRef = useRef(activeItemId)
	const itemsRef = useRef(items)
	useEffect(() => {
		itemsRef.current = items
	}, [items])
	// Debug identity for this provider instance, so a trace can tell which of several
	// webview reloads/mounts a log line (or a late callback) belongs to.
	const instanceIdRef = useRef(Math.random().toString(36).slice(2, 7))
	const debug = useCallback((message: string, extra?: unknown) => {
		console.debug(`[HtmlPreviewContext:${instanceIdRef.current}] ${message}`, extra ?? "")
	}, [])
	// Operations that arrived while a snapshot request is in flight (see htmlPreviewReconcile.ts).
	const inflightSnapshotsRef = useRef(new Set<PreviewItemOp[]>())
	const recordOp = useCallback((op: PreviewItemOp) => {
		inflightSnapshotsRef.current.forEach((ops) => ops.push(op))
	}, [])
	// Latest-wins: replies are numbered by request order, and a reply older than one already
	// applied is dropped, so a slow older snapshot can never roll the list back (for example
	// bring back an "allowed" item that a newer snapshot already shows revoked).
	const requestSeqRef = useRef(0)
	const lastAppliedSeqRef = useRef(0)
	const fetchSnapshot = useCallback(async (): Promise<HtmlPreviewItem[] | null> => {
		const laterOps: PreviewItemOp[] = []
		const seq = ++requestSeqRef.current
		inflightSnapshotsRef.current.add(laterOps)
		try {
			const response = await HtmlPreviewServiceClient.getHtmlPreviewState(EmptyRequest.create())
			if (seq < lastAppliedSeqRef.current) {
				console.debug(
					`[HtmlPreviewContext:${instanceIdRef.current}] snapshot #${seq} ignored (newer #${lastAppliedSeqRef.current} already applied)`,
				)
				return null
			}
			lastAppliedSeqRef.current = seq
			const items = reconcileSnapshot(response.items, laterOps)
			console.debug(
				`[HtmlPreviewContext:${instanceIdRef.current}] snapshot applied host=${response.items.length} later_ops=${laterOps.length} result=${items.length}`,
			)
			return items
		} finally {
			inflightSnapshotsRef.current.delete(laterOps)
		}
	}, [])
	const lastVersionRef = useRef<number>(-1)
	const extensionState = useExtensionState()

	useEffect(() => {
		activeItemIdRef.current = activeItemId
	}, [activeItemId])

	const refreshItems = useCallback(async () => {
		try {
			const nextItems = await fetchSnapshot()
			if (!nextItems) {
				return
			}
			setItems(nextItems)
			setSnapshotLoaded(true)
			if (nextItems.length > 0 && !activeItemIdRef.current) {
				setActiveItemId(nextItems[nextItems.length - 1].id)
			}
		} catch (error) {
			console.error("[HtmlPreviewContext] Failed to fetch preview state:", error)
		}
	}, [fetchSnapshot])

	const removeItem = useCallback(
		async (id: string) => {
			recordOp({ kind: "remove", id })
			let nextItems: HtmlPreviewItem[] = []
			setItems((prev) => {
				nextItems = prev.filter((i) => i.id !== id)
				return nextItems
			})
			setManifestsById((prev) => {
				if (!(id in prev)) {
					return prev
				}
				const next = { ...prev }
				delete next[id]
				return next
			})
			if (activeItemIdRef.current === id) {
				setActiveItemId(nextItems.length > 0 ? nextItems[nextItems.length - 1].id : null)
			}
			try {
				await HtmlPreviewServiceClient.removeHtmlPreviewItem(RemoveHtmlPreviewItemRequest.create({ id }))
			} catch (error) {
				console.error("[HtmlPreviewContext] Failed to remove preview item:", error)
			}
		},
		[recordOp],
	)

	// The host opened a document (auto-open, "Add to Studio", agent hand-off): show it. Applied once per
	// host activation, so it never overrides a selection the user makes afterwards, and it does not rely on
	// the shell reloading to pick up the newest item.
	// Persisted in webview state so a shell reload (same webview, fresh React state) does not re-apply an
	// activation the user has since moved on from.
	const lastActivationSeqRef = useRef(webviewState.get<number>(ACTIVATION_SEQ_KEY) ?? 0)
	const hostActivationSeq = extensionState.htmlPreviewActivationSeq ?? 0
	const hostActiveId = extensionState.htmlPreviewActiveId
	useEffect(() => {
		if (hostActivationSeq <= lastActivationSeqRef.current || !hostActiveId) {
			return
		}
		if (items.some((i) => i.id === hostActiveId)) {
			lastActivationSeqRef.current = hostActivationSeq
			webviewState.set(ACTIVATION_SEQ_KEY, hostActivationSeq)
			setActiveItemId(hostActiveId)
		}
	}, [hostActivationSeq, hostActiveId, items])

	// React to htmlPreviewVersion changes from ExtensionState — this is the
	// reliable signal that the controller mutated HTML previews.
	useEffect(() => {
		const version = extensionState.htmlPreviewVersion ?? 0
		if (version > 0 && version !== lastVersionRef.current) {
			lastVersionRef.current = version
			refreshItems()
		}
	}, [extensionState.htmlPreviewVersion, refreshItems])

	useEffect(() => {
		// Initial pull + streaming subscription.
		debug("mount: subscribing and requesting snapshot")
		refreshItems()

		const handleClearEvent = (e: Event) => {
			const detail = (e as CustomEvent).detail as { id?: string }
			if (detail?.id) {
				void removeItem(detail.id)
			}
		}
		window.addEventListener("htmlPreviewClear", handleClearEvent)

		const subscription = HtmlPreviewServiceClient.subscribeToHtmlPreviews(EmptyRequest.create(), {
			onResponse: (item: HtmlPreviewItem) => {
				const op = item.metadata?.__operation
				debug(`stream item id=${shortId(item.id)} op=${op ?? "upsert"}`)
				if (op === "clear") {
					recordOp({ kind: "clear" })
					setItems([])
					setActiveItemId(null)
					return
				}
				if (op === "remove") {
					recordOp({ kind: "remove", id: item.id })
					let nextItems: HtmlPreviewItem[] = []
					setItems((prev) => {
						nextItems = prev.filter((i) => i.id !== item.id)
						return nextItems
					})
					if (activeItemIdRef.current === item.id) {
						setActiveItemId(nextItems.length > 0 ? nextItems[nextItems.length - 1].id : null)
					}
					return
				}
				recordOp({ kind: "upsert", item })
				setItems((prev) => applyPreviewItemOp(prev, { kind: "upsert", item }))
				if (!activeItemIdRef.current) {
					setActiveItemId(item.id)
				}
			},
			onError: (error) => {
				console.error("[HtmlPreviewContext] Subscription error:", error)
			},
			onComplete: () => {
				console.log("[HtmlPreviewContext] Subscription completed")
			},
		})

		return () => {
			debug("unmount: unsubscribing")
			window.removeEventListener("htmlPreviewClear", handleClearEvent)
			subscription()
		}
	}, [refreshItems, removeItem, recordOp, debug])

	const clearAllItems = useCallback(async () => {
		recordOp({ kind: "clear" })
		setItems([])
		setActiveItemId(null)
		setManifestsById({})
		try {
			const { ClearHtmlPreviewRequest } = await import("@shared/proto/cline/html_preview")
			await HtmlPreviewServiceClient.clearHtmlPreview(ClearHtmlPreviewRequest.create({}))
		} catch (error) {
			console.error("[HtmlPreviewContext] Failed to clear all previews:", error)
		}
	}, [recordOp])

	const addItemFromContent = useCallback(async (title: string, htmlContent: string, filePath?: string) => {
		try {
			const { PreviewHtmlRequest } = await import("@shared/proto/cline/html_preview")
			await HtmlPreviewServiceClient.previewHtml(
				PreviewHtmlRequest.create({
					htmlContent,
					title,
					filePath: filePath || "",
					// mode omitted → UNSPECIFIED → extension auto-detects
				}),
			)
		} catch (error) {
			console.error("[HtmlPreviewContext] addItemFromContent failed:", error)
			throw error
		}
	}, [])

	// Tolerant path-equality: normalises slashes, trims trailing separators,
	// case-insensitive on macOS/Windows. Used to decide whether a target file
	// is already represented by an existing preview item.
	const pathsEqual = useCallback((a?: string, b?: string) => {
		if (!a || !b) {
			return false
		}
		const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
		return norm(a) === norm(b)
	}, [])

	const loadWorkspaceFile = useCallback(
		async (filePath: string, title: string) => {
			try {
				// Fast path: if a tab for this file already exists, just activate it.
				// This is what makes course Prev/Next reliable — we don't depend on
				// the extension reusing items by filePath, and we don't pay the
				// previewHtml round-trip when the artifact is already loaded.
				const existing = items.find((i) => pathsEqual(i.filePath, filePath))
				if (existing) {
					setActiveItemId(existing.id)
					return
				}

				const { PreviewHtmlRequest } = await import("@shared/proto/cline/html_preview")
				await HtmlPreviewServiceClient.previewHtml(
					PreviewHtmlRequest.create({
						htmlContent: "",
						title,
						filePath,
					}),
				)
				// Fetch the updated item list, then activate the newly loaded item
				// using tolerant path comparison (the extension may normalise slashes).
				const fetched = await fetchSnapshot()
				if (fetched) {
					setItems(fetched)
				}
				const nextItems = fetched ?? itemsRef.current
				const newItem =
					nextItems.find((i) => pathsEqual(i.filePath, filePath)) ??
					(nextItems.length > 0 ? nextItems[nextItems.length - 1] : null)
				if (newItem) {
					setActiveItemId(newItem.id)
				}
			} catch (error) {
				console.error("[HtmlPreviewContext] loadWorkspaceFile failed:", error)
				throw error
			}
		},
		[items, pathsEqual, fetchSnapshot],
	)

	return (
		<HtmlPreviewContext.Provider
			value={{
				items,
				snapshotLoaded,
				activeItemId,
				setActiveItemId,
				refreshItems,
				removeItem,
				clearAllItems,
				addItemFromContent,
				loadWorkspaceFile,
				manifestsById,
				setManifest,
			}}>
			{children}
		</HtmlPreviewContext.Provider>
	)
}

export const useHtmlPreviewContext = () => useContext(HtmlPreviewContext)
