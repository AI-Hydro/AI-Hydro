/**
 * Screen registry for the UI harness (dev-only; see scripts/ui-screens/).
 * Each entry names a real production component tree plus the synthetic host
 * data it should see. Do not import this file from production code.
 */

import App from "../App"
import { ScienceToolCard } from "../components/chat/ScienceToolCard"
import HistoryView from "../components/history/HistoryView"
import { Providers } from "../Providers"
import {
	areaFailCall,
	fixtureMcpServers,
	fixtureUnannotatedServers,
	provisionalCall,
	type RecordedCall,
	refusalCall,
	signaturesCall,
	successCall,
} from "./fixtures/aihydro"
import { finalAnswerTask, mcpCallTask, plainTextTask, refusalTask, taskItem } from "./fixtures/chat"
import { approvalClaims, claim, driftClaims, FIXTURE_SESSION, statusClaims } from "./fixtures/claims"
import { experimentFailed, experimentNoCi, experimentWithCi } from "./fixtures/experiments"
import { basinPolygon, featureLayers, framedWorkspace, gaugePoint, MAP_STORAGE_KEY } from "./fixtures/map"
import { replayCapsule, replayMismatch, replayMissing, replayNoTimezone, replaySession, replayWarnings } from "./fixtures/replay"
import { catalogueModules, courseManifest, courseModule, courseProgress, executableModule, staticDoc } from "./fixtures/studio"
import * as tx from "./fixtures/transcripts"
import { MapBannerVariantsScreen } from "./MapBannerVariantsScreen"
import { PrimitivesScreen } from "./PrimitivesScreen"
import type { ScreenDef } from "./types"

const app = () => <App />

const EVIDENCE = "AIHYDRO_EVIDENCE_BOARD_STANDALONE"
const EXPERIMENT = "AIHYDRO_EXPERIMENT_TABLE_STANDALONE"
const REPLAY = "AIHYDRO_REPLAY_PANEL_STANDALONE"
const MAP = "AIHYDRO_MAP_STANDALONE"
const PREVIEW = "AIHYDRO_HTML_PREVIEW_STANDALONE"

const experimentHost =
	(payload: unknown): ScreenDef["onMessage"] =>
	(msg, reply) => {
		if (msg.type === "experiment_table_ready") reply(payload)
		if (msg.type === "list_sessions") reply({ type: "session_list", sessions: [FIXTURE_SESSION] })
	}
const replayHost =
	(payload: unknown): ScreenDef["onMessage"] =>
	(msg, reply) => {
		if (msg.type === "replay_ready") reply(payload)
		if (msg.type === "list_sessions") reply({ type: "session_list", sessions: [FIXTURE_SESSION] })
	}
const studioHost: ScreenDef["onMessage"] = (msg, reply) => {
	if (msg.type === "aihydro-load-course") {
		const isCourse = String(msg.filePath ?? "").includes("/course/")
		reply({
			type: "aihydro-course-loaded",
			requestId: msg.requestId,
			course: isCourse ? courseManifest : null,
			courseRoot: isCourse ? "/fixture/course" : null,
		})
	}
	if (msg.type === "aihydro-course-progress") {
		reply({ type: "aihydro-course-progress-result", requestId: msg.requestId, progress: courseProgress })
	}
}

const evidenceScreen = (id: string, title: string, claims: ScreenDef["ledger"], extra: Partial<ScreenDef> = {}): ScreenDef => ({
	id,
	title,
	group: "evidence",
	surface: "editor",
	flags: [EVIDENCE],
	ledger: claims,
	render: app,
	...extra,
})

const mapScreen = (id: string, title: string, extra: Partial<ScreenDef> = {}): ScreenDef => ({
	id,
	title,
	group: "map",
	surface: "editor",
	flags: [MAP],
	hasMapCanvas: true,
	storage: { [MAP_STORAGE_KEY]: framedWorkspace() },
	ready: "canvas#ai-hydro-research-map",
	render: app,
	...extra,
})

const chatScreen = (id: string, title: string, extra: Partial<ScreenDef> = {}): ScreenDef => ({
	id,
	title,
	group: "chat",
	surface: "sidebar",
	render: app,
	...extra,
})

/** Chat task transcripts: pin the virtualised list to its end so the capture does not depend on smooth-scroll timing. */
const SCROLL_TO_END: ScreenDef["steps"] = [
	{ wait: 600 },
	{ scrollEnd: "[data-virtuoso-scroller=true]" },
	{ wait: 400 },
	{ scrollEnd: "[data-virtuoso-scroller=true]" },
	{ wait: 400 },
]

/**
 * The virtualised chat list settles to a scroll offset that varies by about 20px with machine load, even after
 * iterating scrollTop until it stops moving. These screens therefore skip the pixel diff (threshold 1 = never
 * fails) and assert structure instead: the final message is inside the viewport and the list is pinned to its end.
 * Checker counts are unaffected and still gated.
 */
const STRUCTURAL_ONLY = 1
const PINNED = "[data-virtuoso-scroller=true]"

const taskState = (aihydroMessages: NonNullable<ScreenDef["state"]>["aihydroMessages"], withScienceServer = false) => ({
	currentTaskItem: taskItem,
	aihydroMessages,
	...(withScienceServer ? { mcpServers: fixtureMcpServers } : {}),
})

/** A synthetic transcript screen pinned to its end; `visible` is text that must be inside the viewport. */
const chatTx = (
	id: string,
	title: string,
	messages: NonNullable<ScreenDef["state"]>["aihydroMessages"],
	visible: string,
	extra: Partial<ScreenDef> = {},
): ScreenDef =>
	chatScreen(id, title, {
		state: taskState(messages, true),
		mcpServers: fixtureMcpServers,
		expectVisible: [`text=${visible}`],
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
		...extra,
	})

/** A science tool-call card on its own at sidebar width (the card is what the checker budget is measured on). */
const toolCardScreen = (
	id: string,
	title: string,
	fixtureKind: ScreenDef["fixtureKind"],
	c: RecordedCall,
	extra: Partial<ScreenDef> = {},
): ScreenDef => ({
	id,
	title,
	group: "chat",
	surface: "sidebar",
	fixtureKind,
	ready: "section[aria-label^='Tool call']",
	render: () => (
		<div style={{ padding: "10px 6px 6px 15px", height: "100%", boxSizing: "border-box", overflowY: "auto" }}>
			<ScienceToolCard
				annotations={c.annotations}
				argsJson={c.argsJson}
				resultText={c.resultText}
				serverName="ai-hydro"
				toolMeta={c.meta}
				toolName={c.toolName}
			/>
		</div>
	),
	...extra,
})

const approvalScreen = (key: keyof typeof approvalClaims): ScreenDef =>
	evidenceScreen(`evidence-approval-${key}`, `Evidence Board: approval ${key}`, {
		sessionId: FIXTURE_SESSION,
		claims: [approvalClaims[key]],
	})

export const screens: ScreenDef[] = [
	// ── Design system ───────────────────────────────────────────────
	{
		id: "design-primitives",
		title: "Design system primitives",
		group: "design",
		surface: "panel",
		render: () => <PrimitivesScreen />,
	},

	// ── Chat (sidebar) ──────────────────────────────────────────────
	chatScreen("chat-welcome", "Welcome / first run", { state: { welcomeViewCompleted: false } }),
	chatScreen("chat-home-history", "Chat home with history cards and auto-approve bar"),
	chatScreen("chat-home-empty-history", "Chat home, no history", { state: { taskHistory: [] } }),
	chatScreen("chat-task-text", "Task with plain text", {
		state: taskState(plainTextTask),
		expectVisible: ["text=Fixture text only"],
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
	}),
	chatScreen("chat-task-mcp", "Task with ai-hydro MCP call and result", {
		fixtureKind: "recorded-call",
		// Measures the card itself, so it renders at Verbose (the card inline, as before W2-A2). The card inside a work
		// group's expanded call line is covered by the transcript unit tests and the e2e spec.
		state: { ...taskState(mcpCallTask, true), transcriptDetail: "verbose" },
		expectVisible: ["text=Raw arguments and result (JSON)"],
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
	}),
	chatScreen("chat-task-refusal", "Task with structured refusal (GAUGE_REQUIRED)", {
		fixtureKind: "spliced",
		state: taskState(refusalTask, true),
		expectVisible: ["text=Which gauge do you mean?"],
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
	}),
	chatScreen("chat-task-answer", "Final answer with run and claim chips", {
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
		state: taskState(finalAnswerTask),
		expectVisible: ["text=Fixture answer: no value here is a result."],
		ledger: { sessionId: FIXTURE_SESSION, claims: statusClaims },
	}),
	// ── Wave 2 transcript fixtures (W2-0): the "before" state the redesign is measured against ──────
	// At Normal the cost rows, Thinking rows and the checkpoint marker line are folded into one group; the group header
	// and the retry notice stay on screen.
	chatTx(
		"chat-turn-machinery",
		"Turn machinery: cost rows, thinking, checkpoints, retry notice, science calls",
		tx.turnMachineryTask,
		"Fixture answer, not a result.",
		{
			expectVisible: [
				"text=Fixture answer, not a result.",
				"[data-testid=work-group] button[aria-expanded]",
				"text=malformed tool call; retried",
			],
			expectAbsent: ["text=API Request", "text=Thinking:", ".codicon-bookmark"],
		},
	),
	chatTx(
		"chat-detail-verbose",
		"Turn machinery at Verbose: every row as recorded",
		tx.turnMachineryTask,
		"Fixture answer, not a result.",
		{
			state: { ...taskState(tx.turnMachineryTask, true), transcriptDetail: "verbose" },
			expectAbsent: ["[data-testid=work-group]"],
		},
	),
	chatTx(
		"chat-detail-focus",
		"Turn machinery at Focus: answers and what needs you",
		tx.turnMachineryTask,
		"Fixture answer, not a result.",
		{
			state: { ...taskState(tx.turnMachineryTask, true), transcriptDetail: "focus" },
			expectVisible: [
				"text=Fixture answer, not a result.",
				"[data-testid=work-group] button[aria-expanded=false]",
				"text=malformed tool call; retried",
			],
			expectAbsent: ["text=API Request", "text=Thinking:", ".codicon-bookmark", ".transcript-call"],
		},
	),
	// Every lifted line is real text under the collapsed header.
	chatTx("chat-failure-lifted", "Failures that must stay visible", tx.failureLiftedTask, "which gauge should I use instead?", {
		expectVisible: [
			"text=which gauge should I use instead?",
			"[data-testid=work-group] button[aria-expanded=false]",
			"text=upstream service returned 503",
			"text=Skipped: 'fetch_flow' is not a tool",
			"text=The SEARCH block did not match the file content",
			"text=Could not read /workspace/missing.csv",
		],
		expectAbsent: ["text=API Request"],
	}),
	chatTx("chat-run-8-tools", "Eight science calls in one turn", tx.run8ToolsTask, "Eight recorded runs are listed above."),
	// A real install today: first-party tools publish no annotations, so each call is listed (neutral tone), not folded.
	chatTx(
		"chat-unannotated-first-party",
		"Eight first-party calls, tools publish no annotations",
		tx.run8ToolsTask,
		"Eight recorded runs are listed above.",
		{
			mcpServers: fixtureUnannotatedServers,
			expectVisible: [
				"text=Eight recorded runs are listed above.",
				"[data-testid=work-group] button[aria-expanded=false]",
				"text=effect not declared by the server",
			],
			expectAbsent: ["text=API Request"],
		},
	),
	chatTx("chat-approval-mcp", "Pending MCP approval", tx.approvalMcpTask, "I will call the forcing tool next."),
	chatTx("chat-approval-command", "Pending command approval", tx.approvalCommandTask, "I will run the tests."),
	chatTx("chat-approval-edit", "Pending edit approval with diff", tx.approvalEditTask, "The label is wrong; I will edit it."),
	chatTx(
		"chat-approval-protected-path",
		"Pending approval outside the workspace",
		tx.protectedPathApprovalTask,
		"This needs a file outside the workspace.",
	),
	chatTx(
		"chat-approval-protected-path-answered",
		"Answered approval outside the workspace",
		tx.protectedPathApprovedTask,
		"The hosts entry is in place.",
	),
	chatTx(
		"chat-finished-claims",
		"Finished answer with claim chips",
		tx.finishedClaimsTask,
		"Fixture answer: no value here is a result.",
		{
			ledger: { sessionId: FIXTURE_SESSION, claims: statusClaims },
		},
	),
	chatTx(
		"chat-answer-audit-violations",
		"Answer audit violations (legacy text form)",
		tx.answerAuditViolationsLegacyTask,
		"no run supports this value",
	),
	chatTx("chat-answer-audit-graded", "Answer audit (structured, graded)", tx.answerAuditGradedTask, "1 hard"),
	chatTx(
		"chat-answer-audit-unavailable",
		"Answer audit unavailable (structured)",
		tx.answerAuditUnavailableTask,
		"Audit not run: timed out after 15s",
	),
	chatTx(
		"chat-answer-pending-hidden",
		"Hidden pending audit row inside a group",
		tx.answerPendingHiddenTask,
		"Two recorded runs, nothing hidden.",
		{
			expectVisible: ["text=Two recorded runs, nothing hidden.", "[data-testid=work-group] button[aria-expanded]"],
			expectAbsent: ["text=UNCHECKED DRAFT MUST NOT SHOW", "text=API Request"],
		},
	),
	chatTx(
		"chat-answer-revised",
		"Answer revised after audit (gate, one revision)",
		tx.answerRevisedTask,
		"Revision removed 1 quantity from the draft: 0.42",
	),
	chatTx(
		"chat-answer-disclosure",
		"Answer shown with unresolved findings (gate)",
		tx.answerDisclosureTask,
		"Shown with 1 unresolved hard audit findings after 2 revisions.",
	),
	chatTx(
		"chat-answer-interrupted",
		"Held draft revealed as unchecked (audit interrupted)",
		tx.answerInterruptedTask,
		"Unchecked draft (audit interrupted: stopped by user)",
	),
	chatTx("chat-context-truncation", "Context truncated for a request", tx.contextTruncationTask, "I have the context I need."),
	chatTx("chat-condense", "Conversation condensed (summarizeTask)", tx.condenseTask, "Continuing from the summary."),
	chatTx(
		"chat-command-nonzero-exit",
		"Command exited non-zero",
		tx.commandNonZeroExitTask,
		"The build failed with exit code 2.",
	),
	chatTx("chat-user-cancel", "User cancelled a request", tx.userCancelTask, "Partial output before the cancel"),
	chatTx("chat-resume", "Task reopened, resume pending", tx.resumeTask, "I finished the first run earlier."),
	chatTx("chat-rewind", "After a rewind (deleted_api_reqs)", tx.rewindTask, "Starting approach two after the rewind."),
	chatTx("chat-checkpoint-checked-out", "Checkpoint checked out", tx.checkpointCheckedOutTask, "Edited the config."),
	chatTx("chat-old-task-no-outcomes", "Old task without askOutcome/execOutcome", tx.oldTaskNoOutcomesTask, "Both steps ran."),
	// ── Science tool-call cards (S3) ────────────────────────────────
	toolCardScreen("toolcard-success", "Tool card: success, explicit gauge, area check pass", "recorded", successCall),
	toolCardScreen("toolcard-refusal", "Tool card: terminal refusal (GAUGE_REQUIRED)", "spliced", refusalCall),
	toolCardScreen("toolcard-area-fail", "Tool card: gauge area check failed", "spliced", areaFailCall),
	toolCardScreen("toolcard-provisional", "Tool card: provisional 43/120", "spliced", provisionalCall),
	toolCardScreen(
		"toolcard-unreported-class",
		"Tool card: nothing reported (class, source, quality)",
		"recorded",
		signaturesCall,
	),
	{
		id: "chat-history-list",
		title: "History list view",
		group: "chat",
		surface: "sidebar",
		render: () => (
			<Providers>
				<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
					<HistoryView onDone={() => {}} />
				</div>
			</Providers>
		),
	},

	// ── Evidence Board (editor) ─────────────────────────────────────
	evidenceScreen("evidence-all-statuses", "Evidence Board: one claim per status", {
		sessionId: FIXTURE_SESSION,
		claims: statusClaims,
	}),
	evidenceScreen("evidence-drift-states", "Evidence Board: drift no_history / in_sync / drifted", {
		sessionId: FIXTURE_SESSION,
		claims: driftClaims,
	}),
	approvalScreen("approved"),
	approvalScreen("integrity-only"),
	approvalScreen("consumed"),
	approvalScreen("unverifiable"),
	approvalScreen("stale-evidence"),
	approvalScreen("stale-revision"),
	approvalScreen("revision-mismatch"),
	approvalScreen("unreported"),
	evidenceScreen("evidence-empty", "Evidence Board: empty", { sessionId: FIXTURE_SESSION, claims: [] }),
	evidenceScreen("evidence-error", "Evidence Board: load error", {
		sessionId: "",
		claims: [],
		error: "Fixture error: ledger snapshot could not be read",
	}),

	// ── Experiment Table (editor) ───────────────────────────────────
	{
		id: "experiment-with-ci",
		title: "Experiment Table with intervals",
		group: "experiment",
		surface: "editor",
		flags: [EXPERIMENT],
		onMessage: experimentHost(experimentWithCi),
		render: app,
	},
	{
		id: "experiment-no-ci",
		title: "Experiment Table without intervals",
		group: "experiment",
		surface: "editor",
		flags: [EXPERIMENT],
		onMessage: experimentHost(experimentNoCi),
		render: app,
	},
	{
		id: "experiment-failed-rows",
		title: "Experiment Table with failed rows",
		group: "experiment",
		surface: "editor",
		flags: [EXPERIMENT],
		onMessage: experimentHost(experimentFailed),
		render: app,
	},
	{
		id: "experiment-empty",
		title: "Experiment Table empty",
		group: "experiment",
		surface: "editor",
		flags: [EXPERIMENT],
		onMessage: (m, r) =>
			m.type === "experiment_table_ready" &&
			r({ type: "experiment_table_empty", message: "No experiments found in this session." }),
		render: app,
	},

	// ── Replay (editor) ─────────────────────────────────────────────
	{
		id: "replay-session",
		title: "Replay: session source",
		group: "replay",
		surface: "editor",
		flags: [REPLAY],
		onMessage: replayHost(replaySession),
		render: app,
	},
	{
		id: "replay-capsule",
		title: "Replay: capsule source",
		group: "replay",
		surface: "editor",
		flags: [REPLAY],
		onMessage: replayHost(replayCapsule),
		render: app,
	},
	{
		id: "replay-mismatch",
		title: "Replay: digest mismatch",
		group: "replay",
		surface: "editor",
		flags: [REPLAY],
		onMessage: replayHost(replayMismatch),
		render: app,
	},
	{
		id: "replay-missing",
		title: "Replay: missing records",
		group: "replay",
		surface: "editor",
		flags: [REPLAY],
		onMessage: replayHost(replayMissing),
		render: app,
	},
	{
		id: "replay-no-timezone",
		title: "Replay: timezone not recorded",
		group: "replay",
		surface: "editor",
		flags: [REPLAY],
		onMessage: replayHost(replayNoTimezone),
		render: app,
	},
	{
		id: "replay-warnings",
		title: "Replay: loader warnings",
		group: "replay",
		surface: "editor",
		flags: [REPLAY],
		onMessage: replayHost(replayWarnings),
		render: app,
	},

	// ── Map (editor) ────────────────────────────────────────────────
	mapScreen("map-empty-esri", "Map empty state over a persisted street basemap", {
		storage: { [MAP_STORAGE_KEY]: framedWorkspace("esri-topo") },
	}),
	mapScreen("map-empty-default", "Map empty state, default basemap"),
	// Hydrology default basemap: muted base, USGS hydrography overlay, no labels (light and dark come from the theme).
	mapScreen("map-basemap-muted-default", "Map on the muted hydrology default basemap", { layers: [basinPolygon, gaugePoint] }),
	// Basemap notices: US-only basemap over India, a saved removed (CARTO) basemap migrated, and a provider that
	// answers every tile with one identical image.
	mapScreen("map-basemap-outside-coverage", "USGS Topo over India: US-only notice, tiles not requested", {
		storage: { [MAP_STORAGE_KEY]: framedWorkspace("usgs-topo", false, [76.1, 23.3], 5) },
	}),
	mapScreen("map-basemap-migrated", "Saved CARTO basemap migrated to the hydrology default (notice)", {
		storage: { [MAP_STORAGE_KEY]: framedWorkspace("carto-light") },
	}),
	mapScreen("map-basemap-placeholder", "Basemap returning one identical tile for every request (unavailable notice)", {
		layers: [basinPolygon],
	}),
	mapScreen("map-basemap-panel", "Basemap panel with Reset to hydrology default", {
		layers: [basinPolygon],
		steps: [{ click: 'button[aria-label="Basemap"]' }, { wait: 500 }],
	}),
	{
		id: "map-banner-variants",
		title: "Map resource notices: imagery, renderer, both, quiet note",
		group: "map",
		surface: "editor",
		render: () => <MapBannerVariantsScreen />,
	},
	mapScreen("map-error-imagery", "Map with every basemap tile failing (alert, Retry imagery)", { layers: [basinPolygon] }),
	mapScreen("map-error-partial-tiles", "Map with one basemap tile missing (quiet note, no alert)", { layers: [basinPolygon] }),
	mapScreen("map-empty-panel-open", "No layers with a tool panel open (no empty-state card)", {
		steps: [{ click: 'button[aria-label="Basemap"]' }, { wait: 500 }],
	}),
	mapScreen("map-sync-hydrating", "Saved layers still restoring (no empty-state card)", { mapHydrating: true }),
	mapScreen("map-sync-loading", "Layer sync still loading (no empty-state card)", { mapConnection: "loading" }),
	// Ribbon badge counts visible layers only (2 of 4 shown); the tooltip and panel header read "N visible · M hidden".
	mapScreen("map-layer-badge-counts", "Layer badge counts visible layers only", {
		layers: featureLayers().map((layer, index) => (index % 2 === 1 ? { ...layer, visible: false } : layer)),
	}),
	mapScreen("map-features", "Map with basin, gauge, rivers and raster (toolbar visible)", { layers: featureLayers() }),
	mapScreen("map-layer-manager", "Map layer manager open", {
		layers: featureLayers(),
		steps: [{ click: 'button[aria-label^="Layer manager"]' }, { wait: 500 }],
	}),
	mapScreen("map-layer-provenance", "Layer provenance tab with MISSING_PROVENANCE", {
		layers: featureLayers(),
		steps: [
			{ click: 'button[aria-label^="Layer manager"]' },
			{ wait: 500 },
			{ click: 'button[title="Show details"]', nth: 2 },
			{ wait: 300 },
			{ click: 'button:text-is("Provenance")' },
			{ wait: 300 },
			{ scroll: "text=No provenance record linked" },
		],
	}),
	mapScreen("map-time-slider", "Map time slider", {
		layers: featureLayers(),
		steps: [{ click: 'button[aria-label^="Time slider"]' }, { wait: 500 }],
	}),
	mapScreen("map-swipe", "Map swipe compare", {
		layers: [basinPolygon, ...featureLayers().slice(0, 1)],
		steps: [{ click: 'button[aria-label^="Swipe"]' }, { wait: 500 }],
	}),
	mapScreen("map-export-success", "Map export panel, artifacts written", {
		layers: featureLayers(),
		exportOutputs: 2,
		steps: [
			{ click: 'button[aria-label="Export snapshot"]' },
			{ wait: 800 },
			{ click: 'button:has-text("Quick Export")' },
			{ wait: 1200 },
		],
	}),
	mapScreen("map-export-zero-output", "Map export panel, zero outputs reported", {
		layers: featureLayers(),
		exportOutputs: 0,
		steps: [
			{ click: 'button[aria-label="Export snapshot"]' },
			{ wait: 800 },
			{ click: 'button:has-text("Quick Export")' },
			{ wait: 1200 },
		],
	}),

	// ── Studio / HTML preview (editor) ──────────────────────────────
	{
		id: "studio-empty-state",
		title: "Studio: empty state with starting points",
		group: "studio",
		surface: "editor",
		flags: [PREVIEW],
		htmlPreviews: [],
		onMessage: studioHost,
		ready: '[data-testid="studio-empty-state"]',
		render: app,
	},
	{
		id: "studio-catalogue",
		title: "Studio: module catalogue (licence and unsigned labels)",
		group: "studio",
		surface: "editor",
		flags: [PREVIEW],
		htmlPreviews: [],
		marketplace: { modules: catalogueModules, courses: [] },
		onMessage: studioHost,
		steps: [
			{ click: 'button:has-text("Browse courses")' },
			{ wait: 600 },
			{ click: 'button:has-text("Modules"):has-text("2")' },
			{ wait: 600 },
		],
		render: app,
	},
	{
		id: "studio-catalogue-offline",
		title: "Studio: catalogue offline (error with Retry)",
		group: "studio",
		surface: "editor",
		flags: [PREVIEW],
		htmlPreviews: [],
		marketplace: { error: "Could not load the modules catalogue. Check your connection and retry." },
		onMessage: studioHost,
		steps: [{ click: 'button:has-text("Browse courses")' }, { wait: 1000 }],
		render: app,
	},
	{
		id: "studio-static-doc",
		title: "Studio: static document",
		group: "studio",
		surface: "editor",
		flags: [PREVIEW],
		htmlPreviews: [staticDoc],
		onMessage: studioHost,
		render: app,
	},
	{
		id: "studio-executable-module",
		title: "Studio: executable module",
		group: "studio",
		surface: "editor",
		flags: [PREVIEW],
		htmlPreviews: [executableModule],
		onMessage: studioHost,
		render: app,
	},
	{
		id: "studio-course-progress",
		title: "Studio: course with progress",
		group: "studio",
		surface: "editor",
		flags: [PREVIEW],
		htmlPreviews: [courseModule],
		onMessage: studioHost,
		render: app,
	},
]

export function findScreen(id: string): ScreenDef | undefined {
	return screens.find((s) => s.id === id)
}

// Keep `claim` referenced for fixtures that build ad-hoc claims in future screens.
void claim
