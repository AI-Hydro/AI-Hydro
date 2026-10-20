import { readArtifactTrust } from "@shared/artifactTrust"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import {
	ArtifactCodeLanguage,
	type ArtifactKernelInfoResponse,
	GetArtifactKernelInfoRequest,
	type HtmlPreviewItem,
	InterruptArtifactKernelRequest,
	NotifyParamChangedRequest,
	ProbePythonEnvironmentRequest,
	type PythonEnvironment,
	RestartArtifactKernelRequest,
	RunArtifactCodeRequest,
	SetArtifactKernelProfileRequest,
	SetArtifactExecutionAllowanceRequest,
} from "@shared/proto/cline/html_preview"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { type AiHydroModuleManifest, useHtmlPreviewContext } from "@/context/HtmlPreviewContext"
import { AIHYDRO_BRIDGE_CITATION_SCRIPT } from "@/integrations/aihydro-bridge/citation-adapter"
import { AIHYDRO_BRIDGE_CORE_SCRIPT } from "@/integrations/aihydro-bridge/core"
import { AIHYDRO_BRIDGE_EDITOR_SCRIPT } from "@/integrations/aihydro-bridge/editor-adapter"
import { AIHYDRO_BRIDGE_LEAFLET_SCRIPT } from "@/integrations/aihydro-bridge/leaflet-adapter"
import { FileServiceClient, HtmlPreviewServiceClient, UiServiceClient } from "@/services/grpc-client"
import {
	AIHYDRO_DESIGN_SYSTEM_FONTS,
	AIHYDRO_PREVIEW_STYLE,
	CELL_BRIDGE_SCRIPT,
	usesAihydroDesignSystem,
} from "./aihydroCellBridge"
import { applyArtifactBaseHref, FRAGMENT_NAV_GUARD_SCRIPT } from "./artifactBaseHref"
import { AgentHandoffPrompt } from "./AgentHandoffPrompt"
import { ArtifactTrustBar } from "./ArtifactTrustBar"
import { CourseHeader } from "./CourseHeader"
import { courseNavigationKey, persistThenLoadCourseModule, resolveAgentCourseNavigation } from "./courseAgentNavigation"
import { EditContextRibbon } from "./EditContextRibbon"
import { HtmlPreviewToolbar } from "./HtmlPreviewToolbar"
import {
	applyInstalledPackCsp,
	isInstalledLearningPack,
	type LearningPackScope,
	learningPackScopeFromItem,
} from "./installedPackCsp"
import { LEAFLET_NORMALIZER_SCRIPT, LEAFLET_NORMALIZER_STYLE } from "./leafletNormalizer"
import { reportPreviewEvent, requestSaveDocument, startPreviewAgentTask } from "./previewBridge"
import { resolveModuleFilePath, useCourse } from "./useCourse"
import { useCourseProgress } from "./useCourseProgress"
import { isFromHost } from "./hostMessage"

/**
 * HtmlPreviewView — single-iframe renderer for one HTML artifact.
 *
 * Layout: every container uses inline `display: flex` styles instead of
 * Tailwind utilities. We hit issues where the iframe collapsed to 0 × 0
 * because a Tailwind class was missing or being tree-shaken away; inline
 * styles remove that class of bug.
 *
 * Rendering: we prefer `<iframe srcdoc={item.htmlContent}>` over `src=URL`.
 *
 *   • `srcdoc` inherits the parent's CSP (which whitelists common viz CDNs
 *     like jsdelivr, plot.ly, jquery) for anything the artifact tries to
 *     load, and is sandboxed into an opaque origin (no `allow-same-origin`),
 *     so the document cannot touch the shell.
 *
 *   • Using `src=https://file+.vscode-resource.vscode-cdn.net/…` (i.e.
 *     `asWebviewUri`) puts the iframe on a *different* subdomain from the
 *     parent. VS Code's frame protections can silently render that iframe
 *     blank even with status 200 and the right bytes returned (we verified
 *     this with a fetch + diagnostic strip in 0.1.15).
 *
 *   • When the artifact is too large to ship over gRPC (cap defined on the
 *     extension side), the extension leaves `htmlContent` empty and we
 *     fall back to `src=item.webviewUri`. That works for static HTML even
 *     if it doesn't always work for interactive maps.
 *
 *   • One user-facing mode: **Preview**. The iframe always uses a tight
 *     sandbox with scripts enabled; CSP whitelists scientific CDNs. Backend
 *     picks `srcdoc` (inline HTML) vs `src` (webview URI) automatically.
 *
 *   • Technical diagnostics are behind a **Details** toolbar toggle.
 */
interface HtmlPreviewViewProps {
	item?: HtmlPreviewItem
	/** Whether the parent side panel (Files/Modules/Skills/Comments) is open. Optional — defaults to true with a no-op toggle. */
	sidePanelOpen?: boolean
	onToggleSidePanel?: () => void
}

interface FetchInfo {
	status: number
	bytes: number
	preview: string
	csp?: string | null
	contentType?: string | null
	err?: string
}

interface FrameDiag {
	scriptCount: number
	scriptSrcs: string[]
	stylesheetCount: number
	stylesheetHrefs: string[]
	bodyChildren: number
	bodySize: number
	leafletPresent: boolean
	foliumDivCount: number
	tileImageCount: number
	mapRects: string[]
	errors: string[]
	consoleMsgs: string[]
	cspViolations: string[]
	diagInstalled: boolean
}

/**
 * Tiny script we prepend to every `srcdoc` HTML body. It hooks `window.onerror`,
 * the `unhandledrejection` event, and console.error/warn so that any runtime
 * failure inside the artifact (a missing script, a CSP violation, a Leaflet
 * exception, …) is captured into `window.__aihydroDiag`. The iframe is an
 * opaque origin, so the shell cannot read it; it asks via postMessage
 * (`aihydro-diag-request`) and this script answers with a plain-data summary.
 *
 * This is the diagnostic that turns "the map is blank" into a specific error
 * message in the diagnostic strip.
 */
const DIAG_SCRIPT = `<script>(function(){
  var d = { errors: [], consoleMsgs: [], cspViolations: [], installed: true };
  window.__aihydroDiag = d;
  function rec(kind, args) {
    try {
      var msg = Array.prototype.slice.call(args).map(function(a){
        if (a && a.stack) return String(a.stack);
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch(_) { return String(a); } }
        return String(a);
      }).join(' ');
      (kind === 'error' ? d.errors : d.consoleMsgs).push('[' + kind + '] ' + msg.slice(0, 400));
    } catch(_) {}
  }
  window.addEventListener('error', function(e){
    rec('error', [e.message + ' @ ' + (e.filename||'?') + ':' + (e.lineno||'?')]);
  });
  window.addEventListener('unhandledrejection', function(e){
    rec('error', ['unhandledrejection: ' + (e.reason && e.reason.message || e.reason)]);
  });
  // CSP violations don't fire window.onerror — they fire their own event.
  // Without this listener, a script blocked by CSP is silently invisible.
  window.addEventListener('securitypolicyviolation', function(e){
    try {
      d.cspViolations.push(
        e.violatedDirective + ' blocked ' + (e.blockedURI || 'inline') +
        ' (' + (e.sourceFile || '?') + ':' + (e.lineNumber || '?') + ')'
      );
    } catch(_) {}
  });
  // Only hook console.error — wrapping warn/log floods the diagnostics strip
  // (e.g. third-party libs) without helping users.
  var origErr = console.error;
  console.error = function(){ rec('error', arguments); try { origErr.apply(console, arguments); } catch(_){} };

  // The shell cannot read this document (opaque origin), so it asks and the document answers
  // with a plain-data summary. Only counts/short strings leave; the shell clamps them again.
  function collect() {
    var doc = document;
    var scripts = Array.prototype.slice.call(doc.querySelectorAll('script'));
    var sheets = Array.prototype.slice.call(doc.querySelectorAll('link[rel~="stylesheet"]'));
    var maps = Array.prototype.slice.call(doc.querySelectorAll('div.folium-map, div[id^="map_"], div.leaflet-container, div[id^="plotly"]'));
    var rects = maps.slice(0, 4).map(function(el){
      var r = el.getBoundingClientRect(); var c = window.getComputedStyle(el);
      return (el.id || el.className) + ': ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ' display=' + c.display + ' visibility=' + c.visibility + ' z=' + c.zIndex;
    });
    return {
      scriptCount: scripts.length,
      scriptSrcs: scripts.map(function(s){ return s.getAttribute('src') || ''; }).filter(Boolean).slice(0, 8),
      stylesheetCount: sheets.length,
      stylesheetHrefs: sheets.map(function(s){ return s.getAttribute('href') || ''; }).filter(Boolean).slice(0, 8),
      bodyChildren: doc.body ? doc.body.childElementCount : 0,
      bodySize: doc.body ? doc.body.innerHTML.length : 0,
      leafletPresent: typeof window.L !== 'undefined',
      foliumDivCount: maps.length,
      tileImageCount: doc.querySelectorAll('.leaflet-tile, img.leaflet-tile').length,
      mapRects: rects,
      errors: d.errors.slice(0, 6),
      consoleMsgs: d.consoleMsgs.slice(0, 6),
      cspViolations: d.cspViolations.slice(0, 6),
      diagInstalled: true
    };
  }
  window.addEventListener('message', function(e){
    if (e.source !== window.parent || !e.data || e.data.type !== 'aihydro-diag-request') return;
    try { window.parent.postMessage({ type: 'aihydro-frame-diag', diag: collect() }, '*'); } catch(_) {}
  });
})();</script>`

/**
 * Executable cell bridge: wires `.aihydro-cell` Run buttons and supports
 * legacy `requestPythonRun()` / `artifact/runCode` postMessage from artifacts
 * like twi.html. JavaScript cells run in-iframe; Python delegates to the
 * extension host via the parent webview → gRPC → persistent kernel.
 */
function buildArtifactContextScript(item?: HtmlPreviewItem): string {
	if (!item?.id) {
		return ""
	}
	const payload = JSON.stringify({ id: item.id, filePath: item.filePath || "" })
	return `<script>window.__aihydroArtifact=${payload};</script>`
}

// Leaflet/Folium sizing normalizer extracted to ./leafletNormalizer.ts in
// Phase 0 of the preview architecture refactor. In Phase 2 the normalizer
// becomes a plugin on the AI-Hydro Bridge core (loaded only when a Leaflet
// map is present).

type RenderPath = "srcdoc" | "src" | "none"

// Set by ArtifactPreviewService.registerFile() when the artifact's directory
// looks like a rendered Quarto/multi-file site (site_libs/ + search.json
// siblings). Not currently used to change the render path — see the
// "multi-file site asset loading" note in artifactBaseHref.ts and
// docs/audits/publication-fidelity-root-cause.md in the Studio repo for why
// srcdoc cannot serve these artifacts' sibling assets, and what a follow-up
// fix requires. Exported for the tests and for that follow-up to build on.
export function isMultiFileSite(item?: HtmlPreviewItem): boolean {
	return item?.metadata?.multiFileSite === "true"
}

function pickRenderPath(item?: HtmlPreviewItem): RenderPath {
	if (!item) {
		return "none"
	}
	if (item.htmlContent && item.htmlContent.length > 0) {
		return "srcdoc"
	}
	if (item.webviewUri) {
		return "src"
	}
	return "none"
}

// No `allow-same-origin`: the document runs in an opaque origin, so its script cannot reach the
// shell's DOM, React props, or window globals. Everything it can say to the shell arrives as a
// postMessage and is treated as untrusted data (see the message handlers below). Allow, Send and
// Revoke are shell UI the document cannot touch.
const SANDBOX_ATTR = "allow-scripts allow-popups allow-forms allow-modals"

// Round-trips interactive control state (bindParam values) through the host's
// moduleStateStore. Mirrors the request/response pattern in useCourseProgress.
function sendModuleState(
	artifactId: string,
	action: "get" | "set" | "reset",
	moduleKey: string,
	values?: Record<string, string>,
	learningPackScope?: LearningPackScope | null,
): Promise<Record<string, string> | null> {
	const requestId = `mstate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	return new Promise((resolve) => {
		const cleanup = () => {
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
		}
		const timeout = window.setTimeout(() => {
			cleanup()
			resolve(null)
		}, 4000)
		const onMessage = (e: MessageEvent) => {
			if (!isFromHost(e)) return
			const d = e.data
			if (!d || d.type !== "aihydro-module-state-result" || d.requestId !== requestId) return
			cleanup()
			resolve((d.state?.values as Record<string, string> | undefined) ?? null)
		}
		window.addEventListener("message", onMessage)
		try {
			PLATFORM_CONFIG.postMessage({
				type: "aihydro-module-state",
				artifactId,
				requestId,
				action,
				moduleKey,
				values,
				learningPackScope: learningPackScope ?? undefined,
			})
		} catch {
			cleanup()
			resolve(null)
		}
	})
}

function emptyFrameDiag(error: string): FrameDiag {
	return {
		scriptCount: 0,
		scriptSrcs: [],
		stylesheetCount: 0,
		stylesheetHrefs: [],
		bodyChildren: 0,
		bodySize: 0,
		leafletPresent: false,
		foliumDivCount: 0,
		tileImageCount: 0,
		mapRects: [],
		errors: [error],
		consoleMsgs: [],
		cspViolations: [],
		diagInstalled: false,
	}
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(value, 1e9)) : 0)
const strs = (value: unknown, max: number): string[] =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max).map((v) => v.slice(0, 400)) : []

/** Coerce an untrusted diagnostics payload from the document into the FrameDiag shape. */
export function sanitizeFrameDiag(raw: unknown): FrameDiag {
	if (!raw || typeof raw !== "object") return emptyFrameDiag("diagnostics reply was malformed")
	const d = raw as Record<string, unknown>
	return {
		scriptCount: num(d.scriptCount),
		scriptSrcs: strs(d.scriptSrcs, 8),
		stylesheetCount: num(d.stylesheetCount),
		stylesheetHrefs: strs(d.stylesheetHrefs, 8),
		bodyChildren: num(d.bodyChildren),
		bodySize: num(d.bodySize),
		leafletPresent: d.leafletPresent === true,
		foliumDivCount: num(d.foliumDivCount),
		tileImageCount: num(d.tileImageCount),
		mapRects: strs(d.mapRects, 4),
		errors: strs(d.errors, 6),
		consoleMsgs: strs(d.consoleMsgs, 6),
		cspViolations: strs(d.cspViolations, 6),
		diagInstalled: d.diagInstalled === true,
	}
}

const HtmlPreviewView: React.FC<HtmlPreviewViewProps> = ({ item, sidePanelOpen = true, onToggleSidePanel }) => {
	const { setManifest, loadWorkspaceFile, manifestsById } = useHtmlPreviewContext()
	const learningPackScope = useMemo(() => learningPackScopeFromItem(item), [item?.id, item?.metadata])
	// Phase A: detect a course.json in the active module's parent folder
	const { course, courseRoot, currentModuleId } = useCourse(item?.filePath)
	const courseProgress = useCourseProgress(course, learningPackScope)
	const navigationKey = courseNavigationKey(course?.courseId ?? "", learningPackScope)
	// Persist "currently visiting" module ID whenever it changes (Phase B)
	useEffect(() => {
		if (course && currentModuleId) {
			void courseProgress
				.setCurrent(currentModuleId)
				.then((persisted) => {
					if (persisted === null) {
						console.warn("[HtmlPreviewView] Current course module could not be persisted")
					}
				})
				.catch((error) => console.warn("[HtmlPreviewView] Current course module persistence failed:", error))
		}
	}, [course?.courseId, courseProgress.setCurrent, currentModuleId])
	// Phase C: write an active-course pointer (~/.aihydro/active_course.json)
	// so the MCP course tools know which course the user is viewing.
	useEffect(() => {
		if (!course || !courseRoot) return
		const sep = courseRoot.includes("\\") && !courseRoot.includes("/") ? "\\" : "/"
		const coursePath = courseRoot.endsWith(sep) ? `${courseRoot}course.json` : `${courseRoot}${sep}course.json`
		try {
			PLATFORM_CONFIG.postMessage({
				type: "aihydro-active-course",
				artifactId: item?.id ?? "",
				courseId: course.courseId,
				coursePath,
				courseRoot,
				currentModuleId: currentModuleId ?? null,
			})
		} catch (err) {
			console.warn("[HtmlPreviewView] active-course post failed:", err)
		}
	}, [course?.courseId, courseRoot, currentModuleId, item?.id])
	// Phase D — accept navigation pushes from the agent's course_navigate
	// MCP tool. The extension host watches ~/.aihydro/course_nav_intent.json
	// and forwards intent messages here. We route through the same code
	// path the Next button uses, so prerequisite gating and tab-activation
	// behave identically whether a user or agent triggered the navigation.
	useEffect(() => {
		if (!course) return
		const onMessage = (e: MessageEvent) => {
			// Only the extension host may navigate the course; a document must not drive it.
			if (!isFromHost(e)) return
			const d = e.data
			if (!d || d.type !== "aihydro-agent-navigate") return
			const target = resolveAgentCourseNavigation(
				{ courseId: String(d.courseId ?? ""), moduleId: String(d.moduleId ?? "") },
				course,
				courseProgress.canAccess,
			)
			if (!target || !courseRoot) return
			const fullPath = resolveModuleFilePath(courseRoot, target.path)
			void persistThenLoadCourseModule(navigationKey, target.id, currentModuleId, courseProgress.setCurrent, () =>
				loadWorkspaceFile(fullPath, target.title),
			)
				.then((loaded) => {
					if (!loaded) {
						console.warn("[HtmlPreviewView] Agent navigation cancelled because progress could not be persisted")
					}
				})
				.catch((error) => console.warn("[HtmlPreviewView] Agent course navigation failed:", error))
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [
		course,
		courseRoot,
		courseProgress.canAccess,
		courseProgress.setCurrent,
		currentModuleId,
		loadWorkspaceFile,
		navigationKey,
	])

	const handleCourseNavigate = useCallback(
		async (moduleId: string) => {
			if (!course || !courseRoot) return
			const target = course.modules.find((m) => m.id === moduleId)
			if (!target) return
			// Prerequisite gate — silently no-op if locked (the UI shouldn't have
			// surfaced the click anyway, but this is defence-in-depth).
			if (!courseProgress.canAccess(target)) return
			const fullPath = resolveModuleFilePath(courseRoot, target.path)
			try {
				const loaded = await persistThenLoadCourseModule(
					navigationKey,
					moduleId,
					currentModuleId,
					courseProgress.setCurrent,
					() => loadWorkspaceFile(fullPath, target.title),
				)
				if (!loaded) {
					console.warn("[HtmlPreviewView] Course navigation cancelled because progress could not be persisted")
				}
			} catch (error) {
				console.warn("[HtmlPreviewView] Course navigation failed:", error)
			}
		},
		[
			course,
			courseRoot,
			courseProgress.canAccess,
			courseProgress.setCurrent,
			currentModuleId,
			loadWorkspaceFile,
			navigationKey,
		],
	)
	const iframeRef = useRef<HTMLIFrameElement | null>(null)
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [loadAt, setLoadAt] = useState<number>(0)
	const [loadedOnce, setLoadedOnce] = useState(false)
	const [fetchInfo, setFetchInfo] = useState<FetchInfo | null>(null)

	const [frameDiag, setFrameDiag] = useState<FrameDiag | null>(null)
	const [pathCopied, setPathCopied] = useState(false)
	const [kernelInfo, setKernelInfo] = useState<ArtifactKernelInfoResponse | null>(null)
	const [pythonEnvironments, setPythonEnvironments] = useState<PythonEnvironment[]>([])
	const [activeProfileId, setActiveProfileId] = useState("")
	const [pythonCellCount, setPythonCellCount] = useState(0)
	const [isRunning, setIsRunning] = useState(false)
	const [runAllCurrent, setRunAllCurrent] = useState(0)
	const [runAllTotal, setRunAllTotal] = useState(0)
	const registeredCellIdsRef = useRef<Set<string>>(new Set())
	const isRunningRef = useRef(false)
	// Reactive-param sliders (aihydro.bindParam autorun / timeline scrubber) debounce
	// re-runs at 80–250ms, far below a real Python round-trip. Without coalescing, a
	// run that arrives while the kernel is busy was silently dropped, so the final
	// slider value never executed and the output lagged behind the visible code. We
	// keep only the LATEST dropped request and fire it on the trailing edge once the
	// in-flight run finishes — latest-wins so intermediate drags don't queue up.
	const pendingRunRef = useRef<{ code: string; language: string; cellId?: string } | null>(null)
	const handleArtifactRunCodeRef = useRef<((code: string, language: string, cellId?: string) => void) | null>(null)
	// Phase 4: Edit Mode state
	const [editModeActive, setEditModeActive] = useState(false)
	// UI Refinement: batch state from the iframe editor adapter
	const [pendingChangeCount, setPendingChangeCount] = useState(0)
	// Save / unsaved-changes tracking
	const [hasPendingTextEdits, setHasPendingTextEdits] = useState(false)
	const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false)
	const [isSaving, setIsSaving] = useState(false)
	// Undo/redo availability — updated from iframe's edit.state events
	const [canUndo, setCanUndo] = useState(false)
	const [canRedo, setCanRedo] = useState(false)
	// Resolver for the async save-document round-trip with the iframe
	const pendingSaveResolverRef = useRef<((html: string) => void) | null>(null)
	// Execution trust, as decided and enforced by the host. The webview only
	// displays it and refuses to forward kernel/agent requests that the host
	// would refuse anyway (the host re-checks every one).
	const trust = useMemo(() => readArtifactTrust(item?.metadata), [item?.metadata])
	const canExecute = trust.canExecute
	const [trustBusy, setTrustBusy] = useState(false)
	// A document-initiated agent hand-off waits here, prompt visible, for a user click.
	const [pendingAgentPrompt, setPendingAgentPrompt] = useState<string | null>(null)
	const [agentPromptSending, setAgentPromptSending] = useState(false)
	const [agentHandoffNotice, setAgentHandoffNotice] = useState<string | null>(null)

	const renderPath = useMemo<RenderPath>(
		() => pickRenderPath(item),
		[item?.id, item?.contentHash, item?.htmlContent?.length, item?.webviewUri],
	)

	// Pre-pend a tiny error/console forwarder so we can introspect what
	// actually happens inside the iframe at load time. The forwarder is
	// only useful for the `srcdoc` path; for the `src` fallback the iframe
	// is cross-origin and we can't read its window anyway.
	const srcdocWithDiag = useMemo(() => {
		if (renderPath !== "srcdoc" || !item?.htmlContent) {
			return ""
		}
		const html = item.htmlContent
		// Installed packs get the strict child-document CSP + base (which strips
		// any authored <base>); every other artifact gets just the base href so
		// relative assets (Quarto site_libs, figures) resolve. See
		// artifactBaseHref.ts for the trailing-slash and authored-base rules.
		const finalize = (injectedHtml: string) =>
			isInstalledLearningPack(item)
				? applyInstalledPackCsp(injectedHtml, item.dirUri)
				: applyArtifactBaseHref(injectedHtml, item.dirUri)
		const artifactContext = buildArtifactContextScript(item)
		// The kernel bridge (Run buttons, runCode/paramChanged posts) is injected
		// only for a trusted document the user has allowed. A static document gets
		// no bridge at all, so the "static" badge describes what is enforced.
		const cellBridge = canExecute ? CELL_BRIDGE_SCRIPT : ""
		// The Google Fonts <link>s are a real network request — only pay for it
		// when the artifact actually uses the .aihydro-* design system (or is a
		// module), and never for installed Learning Packs (offline-capable;
		// their CSP already blocks the request, but skipping it avoids the
		// wasted attempt and console noise). CSS ownership boundary, redesign
		// brief §8.4 — see aihydroCellBridge.ts's doc comment for the rest of
		// the split (AIHYDRO_PREVIEW_STYLE itself stays unconditional: it's
		// fully class-scoped and inert for artifacts that don't use it).
		const designSystemFonts =
			!isInstalledLearningPack(item) && usesAihydroDesignSystem(html) ? AIHYDRO_DESIGN_SYSTEM_FONTS : ""
		const headCloseIdx = html.search(/<\/head\s*>/i)
		const bodyCloseIdx = html.search(/<\/body\s*>/i)
		const withHeadAssets =
			headCloseIdx >= 0
				? html.slice(0, headCloseIdx) +
					designSystemFonts +
					AIHYDRO_PREVIEW_STYLE +
					LEAFLET_NORMALIZER_STYLE +
					html.slice(headCloseIdx)
				: designSystemFonts + AIHYDRO_PREVIEW_STYLE + LEAFLET_NORMALIZER_STYLE + html
		// Insert the diagnostic hook immediately after <head> so it captures
		// errors from external scripts. Insert the Leaflet normalizer near the
		// end of <body> so Folium's own map variables already exist before we
		// call invalidateSize().
		// Injection order in <head> open tag:
		//   artifactContext (sets window.__aihydroArtifact)
		//   DIAG_SCRIPT (global error hook)
		//   FRAGMENT_NAV_GUARD_SCRIPT (keeps #fragment links in-document under <base>)
		//   AIHYDRO_BRIDGE_CORE_SCRIPT (sets window.__aihydroBridge, adapter registry)
		//   AIHYDRO_BRIDGE_LEAFLET_SCRIPT (registers data-aihydro-map adapter)
		//   AIHYDRO_BRIDGE_CITATION_SCRIPT (registers cite[data-aihydro-cite-key] adapter)
		//   AIHYDRO_BRIDGE_EDITOR_SCRIPT (edit mode + comment-pin, activated by postMessage)
		//   CELL_BRIDGE_SCRIPT (Run button wiring, Python kernel bridge)
		// Injection before </body>:
		//   LEAFLET_NORMALIZER_SCRIPT (backward-compat sizing fix for Folium/ad-hoc Leaflet)
		const headIdx = html.search(/<head[^>]*>/i)
		if (headIdx >= 0) {
			const closeIdx = html.indexOf(">", headIdx)
			const withDiag =
				withHeadAssets.slice(0, closeIdx + 1) +
				artifactContext +
				DIAG_SCRIPT +
				FRAGMENT_NAV_GUARD_SCRIPT +
				AIHYDRO_BRIDGE_CORE_SCRIPT +
				AIHYDRO_BRIDGE_LEAFLET_SCRIPT +
				AIHYDRO_BRIDGE_CITATION_SCRIPT +
				AIHYDRO_BRIDGE_EDITOR_SCRIPT +
				cellBridge +
				withHeadAssets.slice(closeIdx + 1)
			const bodyCloseAfterDiag = withDiag.search(/<\/body\s*>/i)
			if (bodyCloseAfterDiag >= 0) {
				return finalize(
					withDiag.slice(0, bodyCloseAfterDiag) + LEAFLET_NORMALIZER_SCRIPT + withDiag.slice(bodyCloseAfterDiag),
				)
			}
			if (bodyCloseIdx >= 0) {
				return finalize(withDiag + LEAFLET_NORMALIZER_SCRIPT)
			}
			return finalize(withDiag + LEAFLET_NORMALIZER_SCRIPT)
		}
		return finalize(
			artifactContext +
				DIAG_SCRIPT +
				FRAGMENT_NAV_GUARD_SCRIPT +
				AIHYDRO_BRIDGE_CORE_SCRIPT +
				AIHYDRO_BRIDGE_LEAFLET_SCRIPT +
				AIHYDRO_BRIDGE_CITATION_SCRIPT +
				AIHYDRO_BRIDGE_EDITOR_SCRIPT +
				cellBridge +
				withHeadAssets +
				LEAFLET_NORMALIZER_SCRIPT,
		)
	}, [renderPath, item?.htmlContent, item?.id, item?.filePath, item?.dirUri, item?.metadata?.artifactKind, canExecute])

	useEffect(() => {
		setError(null)
		setLoading(renderPath !== "none")
		setLoadedOnce(false)
		setFetchInfo(null)
		setFrameDiag(null)
		setPythonCellCount(0)
		registeredCellIdsRef.current = new Set()
	}, [item?.id, item?.contentHash, renderPath])

	// Independently probe the URL via fetch() so we know what VS Code's
	// resource server actually returns: status, bytes, content-type, and
	// most importantly any `Content-Security-Policy` header — if VS Code
	// sets one that blocks third-party scripts, the iframe will load the
	// HTML but Leaflet/Plotly will never run inside it.
	useEffect(() => {
		if (!item?.webviewUri) {
			return
		}
		let cancelled = false
		fetch(item.webviewUri)
			.then(async (res) => {
				const text = await res.text()
				if (cancelled) {
					return
				}
				setFetchInfo({
					status: res.status,
					bytes: text.length,
					preview: text.slice(0, 220).replace(/\s+/g, " ").trim(),
					csp: res.headers.get("content-security-policy"),
					contentType: res.headers.get("content-type"),
				})
			})
			.catch((err: unknown) => {
				if (cancelled) {
					return
				}
				setFetchInfo({ status: -1, bytes: 0, preview: "", err: err instanceof Error ? err.message : String(err) })
			})
		return () => {
			cancelled = true
		}
	}, [item?.webviewUri, loadAt])

	const sandbox = SANDBOX_ATTR

	const iframeKey = useMemo(
		() => `${item?.id ?? "none"}-${item?.contentHash ?? "0"}-${loadAt}`,
		[item?.id, item?.contentHash, loadAt],
	)

	const handleRefresh = useCallback(() => {
		setError(null)
		setLoading(true)
		setLoadedOnce(false)
		setLoadAt(Date.now())
	}, [])

	const handleCopyPath = useCallback(async () => {
		if (!item?.filePath) {
			return
		}
		try {
			await FileServiceClient.copyToClipboard(StringRequest.create({ value: item.filePath }))
			setPathCopied(true)
			window.setTimeout(() => setPathCopied(false), 1500)
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to copy file path:", err)
		}
	}, [item?.filePath])

	const handleOpenInEditor = useCallback(async () => {
		if (!item?.filePath) {
			return
		}
		try {
			await FileServiceClient.openFile(StringRequest.create({ value: item.filePath }))
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to open file in editor:", err)
		}
	}, [item?.filePath])

	const handleClear = useCallback(() => {
		if (!item?.id) {
			return
		}
		window.dispatchEvent(new CustomEvent("htmlPreviewClear", { detail: { id: item.id } }))
	}, [item?.id])

	const refreshPythonEnvironments = useCallback(async () => {
		try {
			const list = await HtmlPreviewServiceClient.listPythonEnvironments(EmptyRequest.create())
			setPythonEnvironments(list.environments)
			setActiveProfileId(list.activeProfileId)
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to list Python environments:", err)
		}
	}, [])

	const refreshKernelInfo = useCallback(async () => {
		try {
			const info = await HtmlPreviewServiceClient.getArtifactKernelInfo(
				GetArtifactKernelInfoRequest.create({
					artifactId: item?.id ?? "",
					profileId: activeProfileId,
				}),
			)
			setKernelInfo(info)
			if (info.profileId) {
				setActiveProfileId(info.profileId)
			}
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to fetch kernel info:", err)
		}
	}, [item?.id, activeProfileId])

	const refreshKernelState = useCallback(async () => {
		await refreshPythonEnvironments()
		await refreshKernelInfo()
	}, [refreshPythonEnvironments, refreshKernelInfo])

	useEffect(() => {
		void refreshKernelState()
	}, [refreshKernelState])

	const postResultToIframe = useCallback((payload: Record<string, unknown>) => {
		const win = iframeRef.current?.contentWindow
		if (win) {
			win.postMessage(payload, "*")
		}
	}, [])

	const postCommandToIframe = useCallback(
		(command: string, extra?: Record<string, unknown>) => {
			postResultToIframe({ type: "artifact/command", command, ...extra })
		},
		[postResultToIframe],
	)

	const handleArtifactRunCode = useCallback(
		async (code: string, language: string, cellId?: string) => {
			if (!canExecute) {
				// Defense in depth: the bridge is not injected for such documents and the
				// host refuses the RPC, but never forward a request we know will be denied.
				postResultToIframe({
					type: "artifact/runCodeResult",
					status: "denied",
					error: "denied: document is not allowed to run Python",
					stdout: "",
					stderr: "",
					cellId: cellId ?? "",
				})
				return
			}
			if (language !== "python") {
				postResultToIframe({
					type: "artifact/runCodeResult",
					status: "error",
					error: `Unsupported language: ${language}`,
					stdout: "",
					stderr: "",
					cellId: cellId ?? "",
				})
				return
			}
			if (!item?.id) {
				postResultToIframe({
					type: "artifact/runCodeResult",
					status: "error",
					error: "Missing artifact id",
					stdout: "",
					stderr: "",
				})
				return
			}
			if (isRunningRef.current) {
				// Kernel busy: coalesce to the most recent request and run it on the
				// trailing edge (see pendingRunRef above) instead of dropping it.
				pendingRunRef.current = { code, language, cellId }
				return
			}
			const artifactIdFromContext = item.id
			if (cellId && registeredCellIdsRef.current.size > 0 && !registeredCellIdsRef.current.has(cellId)) {
				postResultToIframe({
					type: "artifact/runCodeResult",
					status: "error",
					error: `Unknown cell: ${cellId}`,
					cellId,
					stdout: "",
					stderr: "",
				})
				return
			}
			isRunningRef.current = true
			setIsRunning(true)
			try {
				const response = await HtmlPreviewServiceClient.runArtifactCode(
					RunArtifactCodeRequest.create({
						artifactId: artifactIdFromContext,
						profileId: activeProfileId,
						language: ArtifactCodeLanguage.ARTIFACT_CODE_LANGUAGE_PYTHON,
						code,
						cellId: cellId ?? "",
					}),
				)
				const images =
					response.imagesPngBase64?.length > 0
						? response.imagesPngBase64
						: (response.outputs ?? []).filter((o) => o.type === "image/png" && o.data).map((o) => o.data)
				postResultToIframe({
					type: "artifact/runCodeResult",
					stdout: response.stdout,
					stderr: response.stderr,
					status: response.status,
					error: response.error,
					result_repr: response.resultRepr,
					images,
					outputs: response.outputs,
					truncated: response.truncated,
					cellId: response.cellId || cellId || "",
				})
				void refreshKernelInfo()
			} catch (err) {
				postResultToIframe({
					type: "artifact/runCodeResult",
					status: "error",
					error: err instanceof Error ? err.message : String(err),
					stdout: "",
					stderr: "",
					cellId: cellId ?? "",
				})
			} finally {
				isRunningRef.current = false
				setIsRunning(false)
				// Trailing-edge drain: if slider input arrived while we were busy,
				// run the latest coalesced request now so the output catches up to
				// where the user actually left the control.
				const pending = pendingRunRef.current
				if (pending) {
					pendingRunRef.current = null
					handleArtifactRunCodeRef.current?.(pending.code, pending.language, pending.cellId)
				}
			}
		},
		[canExecute, item?.id, activeProfileId, postResultToIframe, refreshKernelInfo],
	)

	// Keep a ref to the latest callback so the trailing-edge drain in the finally
	// block above can re-invoke it without a stale-closure or self-reference cycle.
	useEffect(() => {
		handleArtifactRunCodeRef.current = handleArtifactRunCode
	}, [handleArtifactRunCode])

	const handleProfileChange = useCallback(
		async (profileId: string) => {
			try {
				await HtmlPreviewServiceClient.setArtifactKernelProfile(SetArtifactKernelProfileRequest.create({ profileId }))
				setActiveProfileId(profileId)
				await refreshKernelState()
			} catch (err) {
				console.error("[HtmlPreviewView] Failed to set kernel profile:", err)
			}
		},
		[refreshKernelState],
	)

	const handleProbeEnvironment = useCallback(async () => {
		if (!item?.id) {
			return
		}
		try {
			const response = await HtmlPreviewServiceClient.probePythonEnvironment(
				ProbePythonEnvironmentRequest.create({ profileId: activeProfileId, artifactId: item.id }),
			)
			postResultToIframe({
				type: "artifact/runCodeResult",
				stdout: response.stdout,
				stderr: response.stderr,
				status: response.status,
				error: response.error,
			})
			await refreshKernelInfo()
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to probe environment:", err)
		}
	}, [activeProfileId, item?.id, postResultToIframe, refreshKernelInfo])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) {
				return
			}
			const data = event.data as {
				source?: string
				type?: string
				language?: string
				code?: string
				cellId?: string
				cellIds?: string[]
				pythonCount?: number
				current?: number
				total?: number
				artifactId?: string
				manifest?: AiHydroModuleManifest
				passed?: boolean
				score?: number
				quizId?: string
				state?: Record<string, string>
				paramName?: string
				paramValueJson?: string
			}
			if (!data || data.source !== "aihydro-artifact") {
				return
			}
			if (data.artifactId && item?.id && data.artifactId !== item.id) {
				return
			}
			// Everything below is untrusted data from the document. Without an allowance the
			// document has no bridge, so none of these messages is legitimate: answer a run
			// request with a denial and drop the rest (no events, manifests, state or quiz
			// results reach the host or the learner's progress).
			if (!canExecute) {
				if (data.type === "artifact/runCode") {
					void handleArtifactRunCode(data.code ?? "", data.language ?? "python", data.cellId)
				}
				return
			}

			// Phase 1: relay every artifact event to the host's PreviewSessionService
			// so MCP tools (preview_get_state, preview_recent_events) and the agent
			// can observe what's happening inside the iframe. This is purely additive
			// — existing handlers below continue to do their UI work.
			const moduleId = item?.id ?? "unknown"
			const eventBase = { moduleId, cellId: data.cellId }
			if (data.type === "artifact/cellRegistry") {
				reportPreviewEvent(
					"cell.registry",
					{
						...eventBase,
						cells: (data.cellIds ?? []).map((id) => ({ cellId: id, language: "python" })),
						pythonCount: data.pythonCount,
					},
					"system",
					item?.id,
				)
			} else if (data.type === "artifact/manifest" && data.manifest) {
				reportPreviewEvent("manifest.loaded", { ...data.manifest, moduleId }, "system", item?.id)
			} else if (data.type === "artifact/runAllProgress") {
				reportPreviewEvent("cell.run.started", { ...eventBase, current: data.current, total: data.total }, "user", item?.id)
			} else if (data.type === "artifact/runAllComplete") {
				reportPreviewEvent("cell.run.completed", eventBase, "user", item?.id)
			} else if (data.type === "artifact/runCode") {
				reportPreviewEvent("cell.run.started", { ...eventBase, code: data.code, language: data.language }, "user", item?.id)
			}

			if (data.type === "artifact/cellRegistry") {
				registeredCellIdsRef.current = new Set(data.cellIds ?? [])
				setPythonCellCount(data.pythonCount ?? 0)
				return
			}
			if (data.type === "artifact/manifest" && data.manifest && item?.id) {
				setManifest(item.id, data.manifest)
				return
			}
			if (data.type === "artifact/runAllProgress") {
				setRunAllCurrent(data.current ?? 0)
				setRunAllTotal(data.total ?? 0)
				setIsRunning(true)
				isRunningRef.current = true
				return
			}
			if (data.type === "artifact/runAllComplete") {
				setIsRunning(false)
				isRunningRef.current = false
				setRunAllCurrent(0)
				setRunAllTotal(0)
				void refreshKernelInfo()
				return
			}
			if (data.type === "artifact/runCode") {
				void handleArtifactRunCode(data.code ?? "", data.language ?? "python", data.cellId)
				return
			}
			if (data.type === "artifact/quizComplete") {
				reportPreviewEvent(
					"user.interaction",
					{ ...eventBase, quizId: data.quizId, passed: data.passed, score: data.score, total: data.total },
					"user",
					item?.id,
				)
				if (data.passed && course && currentModuleId && !courseProgress.isCompleted(currentModuleId)) {
					void courseProgress.markComplete(currentModuleId)
				}
				return
			}
			// Module-state persistence (Phase 1c): the bridge asks for saved state
			// on load and pushes debounced changes; we round-trip through the host.
			const moduleKey = item?.filePath || item?.id || ""
			if (data.type === "artifact/stateRequest") {
				if (moduleKey) {
					void sendModuleState(item?.id ?? "", "get", moduleKey, undefined, learningPackScope).then((values) => {
						postResultToIframe({ type: "artifact/stateRestore", state: values ?? {} })
					})
				}
				return
			}
			if (data.type === "artifact/stateChanged") {
				if (moduleKey) void sendModuleState(item?.id ?? "", "set", moduleKey, data.state ?? {}, learningPackScope)
				return
			}
			// Phase 3.5b — reactive param widgets: bridge posts this when an input
			// with notifyHostOnChange=true changes. The RPC injects a Python
			// assignment and re-executes the cell via the running kernel.
			if (data.type === "artifact/paramChanged" && item?.id) {
				if (!canExecute) return
				void HtmlPreviewServiceClient.notifyParamChanged(
					NotifyParamChangedRequest.create({
						artifactId: item.id,
						cellId: (data.cellId as string) ?? "",
						paramName: (data.paramName as string) ?? "",
						paramValueJson: (data.paramValueJson as string) ?? "",
					}),
				)
				return
			}
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [
		canExecute,
		course,
		courseProgress,
		currentModuleId,
		handleArtifactRunCode,
		item?.id,
		item?.filePath,
		learningPackScope,
		postResultToIframe,
		refreshKernelInfo,
		setManifest,
	])

	// ── Bridge event relay (iframe → webview → host) ────────────────────────
	// The aihydro-bridge core posts `aihydro-preview-event` messages from inside
	// the iframe. We track local UI state (batch count for the EditContextRibbon)
	// and forward every event to the extension host so PreviewSessionService
	// receives it (and the agent can observe via preview_recent_events).
	useEffect(() => {
		const onBridgeMessage = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) return
			const data = event.data as { type?: string; kind?: string; payloadJson?: string; source?: string }
			if (!data || data.type !== "aihydro-preview-event") return

			let payload: Record<string, unknown> = {}
			try {
				payload = data.payloadJson ? JSON.parse(data.payloadJson) : {}
			} catch {
				/* ignore */
			}

			// Local UI updates: track batch count for the EditContextRibbon
			if (data.kind === "user.comment.draft") {
				setPendingChangeCount((n) => n + 1)
			} else if (data.kind === "user.batch_changes") {
				setPendingChangeCount(0)
				// A document asked to hand work to the agent. Never start the task from
				// here: stage the prompt, show it, and wait for the user's click. The
				// prompt text is built here, not taken from the document.
				if (!canExecute) {
					setAgentHandoffNotice(
						"Agent hand-off is off for this document. Only a trusted document that you have allowed can start an agent task.",
					)
				} else {
					// The bridge reports the module id the session service keys on. It is
					// document-supplied, so accept only a plain identifier; the user also
					// sees the final prompt before it is sent.
					const reportedId = payload.moduleId
					const moduleId =
						typeof reportedId === "string" && /^[\w.-]{1,128}$/.test(reportedId) ? reportedId : (item?.id ?? "unknown")
					const changeCount = Array.isArray(payload.changes) ? payload.changes.length : 1
					const moduleTitle = item?.title || moduleId
					const agentPrompt = [
						`The user has submitted ${changeCount} change${changeCount === 1 ? "" : "s"} and comment${changeCount === 1 ? "" : "s"} for the HTML module "${moduleTitle}".`,
						`Please call \`preview_get_pending_changes("${moduleId}")\` to read the full list,`,
						`then address each one: apply prose edits to the document, implement cell/figure changes in code,`,
						`and call \`preview_address_comment\` for each item once done.`,
					].join(" ")
					setAgentHandoffNotice(null)
					setPendingAgentPrompt(agentPrompt)
				}
			} else if (data.kind === "user.batch.cleared") {
				setPendingChangeCount(0)
			} else if (data.kind === "text.changed") {
				// Prose edits made in contenteditable — real DOM mutation confirmed
				// (format-only commands that produce no content delta do NOT fire this)
				setHasPendingTextEdits(true)
			} else if (data.kind === "edit.state") {
				// Undo/redo stack availability update from the iframe adapter
				if (typeof payload.undoEnabled === "boolean") setCanUndo(payload.undoEnabled)
				if (typeof payload.redoEnabled === "boolean") setCanRedo(payload.redoEnabled)
			} else if (data.kind === "edit.toggled") {
				if (typeof payload?.enabled === "boolean") {
					setEditModeActive(payload.enabled)
					if (!payload.enabled) {
						// Edit mode turned off — reset all derived state
						setHasPendingTextEdits(false)
						setShowUnsavedPrompt(false)
						setCanUndo(false)
						setCanRedo(false)
					}
				}
			}

			// Relay to the host PreviewSessionService (it dedupes by source).
			// Phase 1's previewBridge already does this for events the webview
			// generates itself; we mirror the same path for bridge events.
			// The module id is the host-assigned artifact id, never the document's claim, and a
			// document without an allowance is tagged so the agent reads its events as untrusted.
			reportPreviewEvent(
				(data.kind ?? "unknown") as Parameters<typeof reportPreviewEvent>[0],
				{ ...payload, moduleId: item?.id ?? "unknown", module_id: undefined } as Record<string, unknown>,
				canExecute ? "bridge" : "untrusted-document",
				item?.id,
			)
		}
		window.addEventListener("message", onBridgeMessage)
		return () => window.removeEventListener("message", onBridgeMessage)
	}, [canExecute, item?.id, item?.title])

	// Staged prompts and notices belong to one document; drop them on switch/revoke.
	useEffect(() => {
		setPendingAgentPrompt(null)
		setAgentHandoffNotice(null)
	}, [item?.id, canExecute])

	const handleSetExecutionAllowed = useCallback(
		async (allowed: boolean) => {
			if (!item?.id) return
			setTrustBusy(true)
			try {
				await HtmlPreviewServiceClient.setArtifactExecutionAllowance(
					SetArtifactExecutionAllowanceRequest.create({ artifactId: item.id, allowed }),
				)
			} catch (err) {
				console.error("[HtmlPreviewView] Failed to update execution allowance:", err)
			} finally {
				setTrustBusy(false)
			}
		},
		[item?.id],
	)

	const handleSendAgentPrompt = useCallback(async () => {
		if (!item?.id || !pendingAgentPrompt || !canExecute) return
		const prompt = pendingAgentPrompt
		setAgentPromptSending(true)
		try {
			const result = await startPreviewAgentTask(prompt, item.id)
			if (result.ok) {
				setPendingAgentPrompt(null)
			} else {
				setAgentHandoffNotice(result.error || "The agent task could not be started.")
				setPendingAgentPrompt(null)
			}
		} finally {
			setAgentPromptSending(false)
		}
	}, [canExecute, item?.id, pendingAgentPrompt])

	// ── Listen for the iframe's save-document response ──────────────────────
	// When we post `aihydro-request-save` to the iframe the adapter posts back
	// `aihydro-save-document { html }` as a plain postMessage (not an
	// aihydro-preview-event). We resolve the in-flight save promise here.
	useEffect(() => {
		const onSaveResponse = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) return
			const data = event.data as { type?: string; html?: string }
			if (data?.type !== "aihydro-save-document") return
			if (pendingSaveResolverRef.current) {
				pendingSaveResolverRef.current(data.html ?? "")
				pendingSaveResolverRef.current = null
			}
		}
		window.addEventListener("message", onSaveResponse)
		return () => window.removeEventListener("message", onSaveResponse)
	}, [])

	// Reset batch count whenever Edit Mode turns off externally
	useEffect(() => {
		if (!editModeActive) setPendingChangeCount(0)
	}, [editModeActive])

	// Tell the iframe whenever Edit Mode state changes (canonical sync)
	useEffect(() => {
		const win = iframeRef.current?.contentWindow
		if (win) win.postMessage({ type: "aihydro-edit-mode", enabled: editModeActive }, "*")
	}, [editModeActive])

	const handleSendBatch = useCallback(() => {
		const win = iframeRef.current?.contentWindow
		if (!win) return
		win.postMessage({ type: "aihydro-send-batch" }, "*")
	}, [])

	/** Request the iframe's current HTML, write to disk, reset unsaved state. */
	const handleSaveDocument = useCallback(async (): Promise<boolean> => {
		const win = iframeRef.current?.contentWindow
		if (!win || !item?.filePath) return false
		setIsSaving(true)
		try {
			const html = await new Promise<string>((resolve) => {
				// 5-second safety timeout
				const tid = window.setTimeout(() => {
					pendingSaveResolverRef.current = null
					resolve("")
				}, 5000)
				pendingSaveResolverRef.current = (h) => {
					window.clearTimeout(tid)
					resolve(h)
				}
				win.postMessage({ type: "aihydro-request-save" }, "*")
			})
			if (html) {
				requestSaveDocument(item.id, item.filePath, html)
				setHasPendingTextEdits(false)
				return true
			}
		} catch (err) {
			console.error("[HtmlPreviewView] handleSaveDocument:", err)
		} finally {
			setIsSaving(false)
		}
		return false
	}, [item?.filePath])

	/** Exit edit mode — prompt if there are unsaved prose edits. */
	const handleExitEditMode = useCallback(() => {
		if (hasPendingTextEdits) {
			setShowUnsavedPrompt(true)
		} else {
			setEditModeActive(false)
		}
	}, [hasPendingTextEdits])

	const handleRestartKernel = useCallback(async () => {
		if (!item?.id) {
			return
		}
		try {
			await HtmlPreviewServiceClient.restartArtifactKernel(
				RestartArtifactKernelRequest.create({ artifactId: item.id, profileId: activeProfileId }),
			)
			await refreshKernelState()
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to restart kernel:", err)
		}
	}, [item?.id, activeProfileId, refreshKernelState])

	const handleStop = useCallback(async () => {
		if (!item?.id) {
			return
		}
		try {
			await HtmlPreviewServiceClient.interruptArtifactKernel(
				InterruptArtifactKernelRequest.create({ artifactId: item.id, profileId: activeProfileId }),
			)
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to interrupt kernel:", err)
		} finally {
			setIsRunning(false)
			isRunningRef.current = false
			void refreshKernelInfo()
		}
	}, [item?.id, activeProfileId, refreshKernelInfo])

	const handleRestartAndRunAll = useCallback(async () => {
		await handleRestartKernel()
		postCommandToIframe("runAll")
	}, [handleRestartKernel, postCommandToIframe])

	const handleOpenInBrowser = useCallback(async () => {
		if (!item?.filePath) {
			return
		}
		try {
			// Must go through the extension: window.open(webviewUri) does nothing useful
			// because vscode-resource URLs only work inside VS Code.
			await UiServiceClient.openUrl(StringRequest.create({ value: item.filePath }))
		} catch (err) {
			console.error("[HtmlPreviewView] Failed to open in browser:", err)
		}
	}, [item?.filePath])

	/**
	 * After the iframe loads, ask the document (srcdoc only, via postMessage; the
	 * cross-origin `src` fallback has no diagnostic script) to report what's
	 * actually in there: script count, whether Leaflet is defined,
	 * captured runtime errors, console output. This is the diagnostic that
	 * pinpoints WHY a Folium/Plotly map renders blank.
	 */
	const captureFrameDiag = useCallback(() => {
		const iframe = iframeRef.current
		if (!iframe) {
			return
		}
		if (renderPath !== "srcdoc" || !iframe.contentWindow) {
			// The `src` fallback is a different origin and carries no diagnostic script.
			setFrameDiag(emptyFrameDiag("diagnostics unavailable (cross-origin fallback)"))
			return
		}
		// The srcdoc document is sandboxed into an opaque origin: ask it to report (see DIAG_SCRIPT).
		iframe.contentWindow.postMessage({ type: "aihydro-diag-request" }, "*")
	}, [renderPath])

	// Diagnostics replies are untrusted data from the document: shape-check and clamp every field.
	useEffect(() => {
		const onDiag = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) return
			const data = event.data as { type?: string; diag?: unknown } | null
			if (!data || data.type !== "aihydro-frame-diag") return
			setFrameDiag(sanitizeFrameDiag(data.diag))
		}
		window.addEventListener("message", onDiag)
		return () => window.removeEventListener("message", onDiag)
	}, [])

	if (!item) {
		return <EmptyState />
	}

	const outerStyle: React.CSSProperties = {
		display: "flex",
		flexDirection: "column",
		width: "100%",
		height: "100%",
		minHeight: 0,
		minWidth: 0,
		background: "var(--vscode-editor-background, #1e1e1e)",
		position: "relative",
	}

	const iframeWrapperStyle: React.CSSProperties = {
		flex: "1 1 auto",
		minHeight: 400,
		minWidth: 0,
		position: "relative",
		overflow: "hidden",
		background: "#ffffff",
		border: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.12))",
	}

	return (
		<div style={outerStyle}>
			{/* Phase A: course header strip — only renders when course.json found */}
			{course && (
				<CourseHeader
					course={course}
					currentModuleId={currentModuleId}
					onNavigate={handleCourseNavigate}
					progress={courseProgress}
				/>
			)}
			<HtmlPreviewToolbar
				activeProfileId={activeProfileId}
				diagnosticsOpen={diagnosticsOpen}
				editModeActive={editModeActive}
				isRunning={isRunning}
				item={item}
				kernelInfo={kernelInfo}
				onClear={handleClear}
				onClearOutputs={() => postCommandToIframe("clearOutputs")}
				onCopyModuleState={() => postCommandToIframe("copyState")}
				onCopyPath={handleCopyPath}
				onOpenInBrowser={handleOpenInBrowser}
				onOpenInEditor={handleOpenInEditor}
				onProbeEnvironment={handleProbeEnvironment}
				onProfileChange={handleProfileChange}
				onRefresh={handleRefresh}
				onRefreshEnvironments={refreshPythonEnvironments}
				onResetModuleState={() => postCommandToIframe("resetState")}
				onRestartAndRunAll={handleRestartAndRunAll}
				onRestartKernel={handleRestartKernel}
				onRunAll={() => postCommandToIframe("runAll")}
				onRunCell={() => postCommandToIframe("runCell")}
				onStop={handleStop}
				onToggleDiagnostics={() => setDiagnosticsOpen((v) => !v)}
				onToggleEditMode={() => {
					if (editModeActive) {
						handleExitEditMode()
					} else {
						setEditModeActive(true)
					}
				}}
				onToggleSidePanel={onToggleSidePanel ?? (() => {})}
				pathCopied={pathCopied}
				pendingChangeCount={pendingChangeCount}
				pythonCellCount={pythonCellCount}
				pythonEnvironments={pythonEnvironments}
				runAllCurrent={runAllCurrent}
				runAllTotal={runAllTotal}
				sidePanelOpen={sidePanelOpen}
				workspaceTrusted={kernelInfo?.workspaceTrusted ?? true}
			/>
			{diagnosticsOpen && item ? (
				<DiagnosticStrip
					error={error}
					fetchInfo={fetchInfo}
					frameDiag={frameDiag}
					item={item}
					kernelInfo={kernelInfo}
					loadedOnce={loadedOnce}
					loading={loading}
					renderPath={renderPath}
				/>
			) : null}
			{/* UI Refinement: Edit context ribbon — appears ONLY when Edit Mode is active */}
			{editModeActive && (
				<EditContextRibbon
					canRedo={canRedo}
					canUndo={canUndo}
					hasPendingTextEdits={hasPendingTextEdits}
					iframeRef={iframeRef}
					isSaving={isSaving}
					onExit={handleExitEditMode}
					onSave={handleSaveDocument}
					onSendBatch={handleSendBatch}
					pendingCount={pendingChangeCount}
				/>
			)}
			{item && renderPath !== "none" && (
				<ArtifactTrustBar
					busy={trustBusy}
					onAllow={() => void handleSetExecutionAllowed(true)}
					onRevoke={() => void handleSetExecutionAllowed(false)}
					trust={trust}
				/>
			)}
			{pendingAgentPrompt !== null && canExecute && (
				<AgentHandoffPrompt
					onDismiss={() => setPendingAgentPrompt(null)}
					onSend={() => void handleSendAgentPrompt()}
					prompt={pendingAgentPrompt}
					sending={agentPromptSending}
				/>
			)}
			{agentHandoffNotice && (
				<div data-testid="agent-handoff-notice" role="status" style={{ padding: "4px 10px", fontSize: 11, opacity: 0.85 }}>
					{agentHandoffNotice}
				</div>
			)}
			<div style={iframeWrapperStyle}>
				{renderPath === "none" ? (
					<NoUriMessage item={item} />
				) : (
					<>
						{loading && <LoadingOverlay />}
						{error && <ErrorOverlay message={error} onRetry={handleRefresh} />}
						<iframe
							key={iframeKey}
							ref={iframeRef}
							sandbox={sandbox}
							// srcdoc renders the exact hashed snapshot the host trust-checked, in a
							// sandboxed opaque origin. Only artifacts too big to embed fall back to
							// `src` (the live file), and those can never hold an execution allowance.
							{...(renderPath === "srcdoc" ? { srcDoc: srcdocWithDiag } : { src: item.webviewUri })}
							onError={() => {
								setError("Failed to load the artifact in the iframe.")
								setLoading(false)
							}}
							onLoad={() => {
								setLoading(false)
								setLoadedOnce(true)
								// Bridge may post cellRegistry before this listener is attached;
								// rescan after load so toolbar Run / Run All enable correctly.
								if (renderPath === "srcdoc") {
									postCommandToIframe("rescan")
								}
								// Capture immediately, then re-capture after a beat
								// because external Leaflet/Plotly scripts load async
								// and any error from them shows up a tick after onload.
								captureFrameDiag()
								window.setTimeout(captureFrameDiag, 500)
								window.setTimeout(captureFrameDiag, 2000)
							}}
							style={{
								position: "absolute",
								inset: 0,
								width: "100%",
								height: "100%",
								border: "none",
								display: "block",
								backgroundColor: "#ffffff",
							}}
							title={item.title || "AI-Hydro HTML Preview"}
						/>
					</>
				)}
			</div>
			{/* Unsaved-changes dialog — overlays entire panel when hasPendingTextEdits on exit */}
			{showUnsavedPrompt && (
				<UnsavedChangesDialog
					isSaving={isSaving}
					onCancel={() => setShowUnsavedPrompt(false)}
					onDiscard={() => {
						setShowUnsavedPrompt(false)
						setHasPendingTextEdits(false)
						setEditModeActive(false) // useEffect fires aihydro-edit-mode:false to iframe
					}}
					onSaveAndExit={async () => {
						const saved = await handleSaveDocument()
						if (saved) {
							setShowUnsavedPrompt(false)
							setEditModeActive(false) // useEffect fires aihydro-edit-mode:false to iframe
						}
					}}
				/>
			)}
		</div>
	)
}

// ─── Diagnostic strip ───────────────────────────────────────────────────

const DiagnosticStrip: React.FC<{
	item: HtmlPreviewItem
	loading: boolean
	loadedOnce: boolean
	error: string | null
	fetchInfo: FetchInfo | null
	renderPath: RenderPath
	frameDiag: FrameDiag | null
	kernelInfo: ArtifactKernelInfoResponse | null
}> = ({ item, loading, loadedOnce, error, fetchInfo, renderPath, frameDiag, kernelInfo }) => {
	const uri = item.webviewUri || "(empty — extension did not return a webviewUri)"
	const shortUri = uri.length > 140 ? `${uri.slice(0, 70)}…${uri.slice(-60)}` : uri
	const htmlBytes = item.htmlContent ? item.htmlContent.length : 0
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: 8,
				padding: "4px 10px",
				borderBottom: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.12))",
				background: "var(--vscode-panel-background, rgba(0,0,0,0.25))",
				color: "var(--vscode-foreground, #ddd)",
				fontFamily: "var(--vscode-editor-font-family, monospace)",
				fontSize: 10,
				flex: "0 0 auto",
				userSelect: "text",
			}}>
			<strong style={{ color: "var(--vscode-charts-blue, #4fc1ff)" }}>PREVIEW</strong>
			<Sep />
			<span>id={item.id}</span>
			<Sep />
			<span>render={renderPath}</span>
			<Sep />
			<span>html={htmlBytes}B</span>
			<Sep />
			<span>hash={(item.contentHash || "—").slice(0, 8)}</span>
			{kernelInfo && (
				<>
					<Sep />
					<span style={{ flexBasis: "100%" }}>
						kernel: {kernelInfo.label || "—"} state={kernelInfo.state} python={kernelInfo.interpreterPath || "—"} ver=
						{kernelInfo.pythonVersion || "—"} cwd={kernelInfo.cwd || "—"}
						{kernelInfo.lastError ? ` err=${kernelInfo.lastError}` : ""}
					</span>
				</>
			)}
			<Sep />
			<span>loading={String(loading)}</span>
			<Sep />
			<span>loaded={String(loadedOnce)}</span>
			<span style={{ wordBreak: "break-all", flexBasis: "100%" }}>uri={shortUri}</span>
			<span style={{ flexBasis: "100%" }}>
				{fetchInfo
					? fetchInfo.err
						? `fetch: ERR ${fetchInfo.err}`
						: `fetch: status=${fetchInfo.status} bytes=${fetchInfo.bytes} type=${fetchInfo.contentType ?? "—"} csp=${
								fetchInfo.csp
									? `"${fetchInfo.csp.slice(0, 120)}${fetchInfo.csp.length > 120 ? "…" : ""}"`
									: "(none)"
							} preview="${fetchInfo.preview.slice(0, 120)}"`
					: "fetch: (running…)"}
			</span>
			{frameDiag && (
				<>
					<span style={{ flexBasis: "100%" }}>
						frame: diag={String(frameDiag.diagInstalled)} scripts={frameDiag.scriptCount} (srcs=[
						{frameDiag.scriptSrcs.map((s) => s.slice(0, 60)).join(", ")}]) styles={frameDiag.stylesheetCount} (hrefs=[
						{frameDiag.stylesheetHrefs.map((s) => s.slice(0, 60)).join(", ")}]) bodyKids={frameDiag.bodyChildren}{" "}
						bodySize={frameDiag.bodySize} L={String(frameDiag.leafletPresent)} mapDivs={frameDiag.foliumDivCount}{" "}
						tiles={frameDiag.tileImageCount}
					</span>
					{frameDiag.cspViolations.length > 0 && (
						<span
							style={{
								color: "var(--vscode-errorForeground, #f48771)",
								flexBasis: "100%",
								whiteSpace: "pre-wrap",
							}}>
							CSP violations:{"\n"}
							{frameDiag.cspViolations.join("\n")}
						</span>
					)}
					{frameDiag.mapRects.length > 0 && (
						<span style={{ color: "var(--vscode-charts-green, #89d185)", flexBasis: "100%", whiteSpace: "pre-wrap" }}>
							map rects:{"\n"}
							{frameDiag.mapRects.join("\n")}
						</span>
					)}
					{frameDiag.errors.length > 0 && (
						<span
							style={{
								color: "var(--vscode-errorForeground, #f48771)",
								flexBasis: "100%",
								whiteSpace: "pre-wrap",
							}}>
							iframe errors:{"\n"}
							{frameDiag.errors.join("\n")}
						</span>
					)}
					{frameDiag.consoleMsgs.length > 0 && (
						<span
							style={{ color: "var(--vscode-charts-yellow, #cca700)", flexBasis: "100%", whiteSpace: "pre-wrap" }}>
							iframe console:{"\n"}
							{frameDiag.consoleMsgs.join("\n")}
						</span>
					)}
				</>
			)}
			{error && (
				<span style={{ color: "var(--vscode-errorForeground, #f48771)", fontWeight: "bold", flexBasis: "100%" }}>
					ERROR: {error}
				</span>
			)}
		</div>
	)
}

const Sep = () => <span style={{ color: "var(--vscode-descriptionForeground, #999)", opacity: 0.5 }}>|</span>

// ─── Overlays / fallbacks ──────────────────────────────────────────────

/** Inject the spin keyframe once (idempotent). */
function ensureSpinStyle() {
	if (typeof document === "undefined") return
	if (document.getElementById("aihydro-spin-style")) return
	const el = document.createElement("style")
	el.id = "aihydro-spin-style"
	el.textContent = `@keyframes aihydro-spin { to { transform: rotate(360deg); } }`
	document.head.appendChild(el)
}

const LoadingOverlay: React.FC = () => {
	ensureSpinStyle()
	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				zIndex: 10,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 12,
				background: "rgba(20,20,28,0.72)",
				pointerEvents: "none",
			}}>
			{/* Spinning ring */}
			<div
				style={{
					width: 28,
					height: 28,
					borderRadius: "50%",
					border: "2.5px solid rgba(255,255,255,0.12)",
					borderTopColor: "#00A3FF",
					animation: "aihydro-spin 0.75s linear infinite",
				}}
			/>
			<span
				style={{
					fontSize: 12,
					color: "var(--vscode-descriptionForeground, #999)",
					letterSpacing: "0.3px",
				}}>
				Loading preview…
			</span>
		</div>
	)
}

const ErrorOverlay: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
	<div
		style={{
			position: "absolute",
			inset: 0,
			zIndex: 20,
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 14,
			padding: 32,
			background: "var(--vscode-editor-background, #1e1e1e)",
			textAlign: "center",
		}}>
		{/* Warning icon */}
		<svg
			fill="none"
			height="36"
			stroke="var(--vscode-errorForeground, #f48771)"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.5"
			viewBox="0 0 24 24"
			width="36">
			<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
			<line x1="12" x2="12" y1="9" y2="13" />
			<line x1="12" x2="12.01" y1="17" y2="17" />
		</svg>
		<div
			style={{
				fontSize: 13,
				color: "var(--vscode-errorForeground, #f48771)",
				maxWidth: 360,
				lineHeight: 1.5,
			}}>
			{message}
		</div>
		<button
			onClick={onRetry}
			style={{
				padding: "6px 16px",
				fontSize: 12,
				fontWeight: 500,
				background: "transparent",
				color: "var(--vscode-foreground, #ddd)",
				border: "1px solid rgba(255,255,255,0.2)",
				borderRadius: 4,
				cursor: "pointer",
				transition: "background 0.12s",
			}}
			type="button">
			Retry
		</button>
	</div>
)

const NoUriMessage: React.FC<{ item: HtmlPreviewItem }> = ({ item }) => (
	<div
		style={{
			position: "absolute",
			inset: 0,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 24,
			background: "var(--vscode-editor-background, #1e1e1e)",
			color: "var(--vscode-descriptionForeground, #999)",
			textAlign: "center",
			fontSize: 12,
		}}>
		<div>
			<div style={{ marginBottom: 8 }}>The extension has not yet supplied a webview URI for this artifact.</div>
			<div style={{ fontSize: 11, opacity: 0.7 }}>
				id={item.id} · file={item.filePath || "(none)"}
			</div>
			<div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
				Open the preview panel from the extension side first, then re-click the file. If this persists, the panel is open
				in a different column than the artifact registration happened in.
			</div>
		</div>
	</div>
)

const EmptyState: React.FC = () => (
	<div
		style={{
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			width: "100%",
			height: "100%",
			background: "var(--vscode-editor-background, #1e1e1e)",
			color: "var(--vscode-descriptionForeground, #999)",
		}}>
		<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
			<svg
				fill="none"
				height="48"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
				viewBox="0 0 24 24"
				width="48">
				<rect height="18" rx="2" ry="2" width="18" x="3" y="3" />
				<line x1="3" x2="21" y1="9" y2="9" />
				<line x1="9" x2="9" y1="21" y2="9" />
			</svg>
			<p style={{ fontSize: 13, fontWeight: 500 }}>No HTML preview active</p>
			<p style={{ fontSize: 11, opacity: 0.7 }}>Click a workspace file in the sidebar.</p>
		</div>
	</div>
)

function shortenPath(p: string): string {
	if (p.length <= 60) {
		return p
	}
	return `…${p.slice(-58)}`
}

// ─── Unsaved-changes dialog ────────────────────────────────────────────────

const UnsavedChangesDialog: React.FC<{
	onSaveAndExit: () => void
	onDiscard: () => void
	onCancel: () => void
	isSaving: boolean
}> = ({ onSaveAndExit, onDiscard, onCancel, isSaving }) => (
	<div
		style={{
			position: "absolute",
			inset: 0,
			zIndex: 9999,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			background: "rgba(10,10,21,0.80)",
			backdropFilter: "blur(4px)",
		}}>
		<div
			style={{
				background: "rgba(20,20,36,0.98)",
				border: "1px solid rgba(0,221,255,0.35)",
				borderRadius: 14,
				padding: "26px 30px",
				maxWidth: 400,
				width: "90%",
				boxShadow: "0 24px 72px rgba(0,0,0,0.75)",
				fontFamily: "Poppins, system-ui, sans-serif",
			}}>
			{/* Icon + title */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					marginBottom: 12,
				}}>
				<span style={{ fontSize: 22 }}>💾</span>
				<span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>Unsaved prose edits</span>
			</div>
			{/* Body */}
			<p
				style={{
					margin: "0 0 22px",
					fontSize: 12,
					color: "#94a3b8",
					lineHeight: 1.65,
				}}>
				You have unsaved text edits in this document. Would you like to write them to disk before leaving Edit Mode?
			</p>
			{/* Actions */}
			<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
				<button
					onClick={onCancel}
					style={{
						padding: "6px 14px",
						fontSize: 12,
						fontWeight: 600,
						background: "transparent",
						color: "var(--vscode-foreground, #ddd)",
						border: "1px solid rgba(255,255,255,0.15)",
						borderRadius: 7,
						cursor: "pointer",
					}}
					type="button">
					Cancel
				</button>
				<button
					onClick={onDiscard}
					style={{
						padding: "6px 14px",
						fontSize: 12,
						fontWeight: 600,
						background: "rgba(255,80,80,0.12)",
						color: "#f87171",
						border: "1px solid rgba(255,80,80,0.25)",
						borderRadius: 7,
						cursor: "pointer",
					}}
					type="button">
					Discard
				</button>
				<button
					disabled={isSaving}
					onClick={onSaveAndExit}
					style={{
						padding: "6px 16px",
						fontSize: 12,
						fontWeight: 700,
						background: isSaving ? "rgba(0,163,255,0.3)" : "linear-gradient(135deg, #00A3FF, #00DDFF)",
						color: isSaving ? "#94a3b8" : "#0a0a15",
						border: "none",
						borderRadius: 7,
						cursor: isSaving ? "not-allowed" : "pointer",
						opacity: isSaving ? 0.7 : 1,
						transition: "all 0.15s",
					}}
					type="button">
					{isSaving ? "Saving…" : "Save & Exit"}
				</button>
			</div>
		</div>
	</div>
)

export default HtmlPreviewView
