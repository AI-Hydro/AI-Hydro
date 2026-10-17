/**
 * UI screen harness (dev-only). Nothing under src/screens is imported by the
 * production entry (main.tsx / App.tsx); the build guard greps the bundle for
 * the fixture badge text to prove it.
 */
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import type { ClaimRecord } from "@shared/proto/cline/ledger"
import type { MapLayer } from "@shared/proto/cline/map"
import type { ReactNode } from "react"

export type ScreenGroup = "chat" | "evidence" | "experiment" | "replay" | "map" | "studio" | "design"
/** Where VS Code would host the screen: narrow sidebar view, panel, or editor tab. */
export type ScreenSurface = "sidebar" | "panel" | "editor"

/** Declarative interaction run after mount (Playwright selector engine strings). */
export type ScreenStep =
	| { click: string; nth?: number }
	| { fill: [string, string] }
	| { scroll: string }
	| { scrollEnd: string }
	| { wait: number }
	| { press: string }

export interface ScreenDef {
	id: string
	title: string
	group: ScreenGroup
	surface: ScreenSurface
	/** Extension-state overrides merged over the harness base state. */
	state?: Partial<ExtensionState>
	ledger?: { sessionId: string; claims: ClaimRecord[]; error?: string }
	layers?: MapLayer[]
	/** Artifacts the fixture host reports from saveMapExport (0 exercises the zero-output state). */
	exportOutputs?: number
	htmlPreviews?: HtmlPreviewItem[]
	/** Window flags App.tsx reads to choose a standalone panel. */
	flags?: string[]
	/** localStorage entries installed before the app boots (e.g. persisted map workspace). */
	storage?: Record<string, string>
	/** Answers webview -> host postMessage traffic the way the extension host would. */
	onMessage?: (msg: Record<string, unknown>, reply: (message: unknown) => void) => void
	steps?: ScreenStep[]
	/** Selector that must exist before the screenshot is taken. */
	ready?: string
	/** True when the screen contains a WebGL map canvas (pixel diffs are masked). */
	hasMapCanvas?: boolean
	/** Per-screen pixel-diff threshold override (fraction of pixels). */
	pixelDiffThreshold?: number
	/** Selectors that must be inside the viewport (structural assertion). */
	expectVisible?: string[]
	/** Scroller that must be pinned to its end (structural assertion). */
	scrollPinned?: string
	render: () => ReactNode
}
