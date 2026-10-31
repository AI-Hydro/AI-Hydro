/**
 * Screen registry for the UI harness (dev-only; see scripts/ui-screens/).
 * Each entry names a real production component tree plus the synthetic host
 * data it should see. Do not import this file from production code.
 */

import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { ReactNode } from "react"
import App from "../App"
import { ScienceToolCard } from "../components/chat/ScienceToolCard"
import ConnectorsView from "../components/connectors/ConnectorsView"
import HistoryView from "../components/history/HistoryView"
import McpView from "../components/mcp/configuration/McpConfigurationView"
import SettingsView from "../components/settings/SettingsView"
import SkillsView from "../components/skills/SkillsView"
import { Providers } from "../Providers"
import {
	areaFailCall,
	fixtureAlwaysAllowServers,
	fixtureAnnotatedServers,
	fixtureMcpServers,
	fixtureOwnerServers,
	fixturePausedMixedServers,
	fixturePausedServers,
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
import { basinPolygon, featureLayers, fixturePins, framedWorkspace, gaugePoint, MAP_STORAGE_KEY } from "./fixtures/map"
import { fixtureInstalledSkills, fixtureMarketplaceSkills, fixtureMcpMarketplace } from "./fixtures/nav"
import { replayCapsule, replayMismatch, replayMissing, replayNoTimezone, replaySession, replayWarnings } from "./fixtures/replay"
import { catalogueModules, courseManifest, courseModule, courseProgress, executableModule, staticDoc } from "./fixtures/studio"
import * as tx from "./fixtures/transcripts"
import { MapBannerVariantsScreen } from "./MapBannerVariantsScreen"
import { PrimitivesScreen } from "./PrimitivesScreen"
import type { ScreenDef, ScreenStep } from "./types"

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

/** The extension host's answer to "which pins does this project have": the fixture pins, optionally as imported. */
const pinsHost =
	(imported = false): ScreenDef["onMessage"] =>
	(msg, reply) => {
		if (msg.type !== "aihydro-map-load-annotations") return
		const annotations = fixturePins().map((pin) => (imported ? { ...pin, imported: true } : pin))
		reply({
			type: "aihydro-map-load-annotations-result",
			requestId: msg.requestId,
			ok: true,
			projectKey: "prj_FIXTURE",
			importedCount: imported ? annotations.length : 0,
			annotations,
			collections: [],
		})
	}

/**
 * Steps that open a tool whichever chrome the width gives: the rail (800 and up), or the collapsed "Map tools" button
 * and its menu (a bottom sheet, below 600). `more` goes through the More menu where there is a rail.
 */
const openTool = (label: string, more = false): ScreenStep[] => [
	{ click: 'button[aria-label^="Map tools"]', optional: true },
	...(more ? ([{ click: 'button[aria-label="More tools"]', optional: true }] as const) : []),
	{ click: `button[aria-label^="${label}"]` },
	{ wait: 500 },
]

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
const APPROVAL_INLINE = "[data-testid=inline-approval]"
const APPROVAL_ALWAYS = "[data-testid=inline-approval-always]"
const FOOTER_ACTIONS = "[data-testid=footer-actions]"

const taskState = (aihydroMessages: NonNullable<ScreenDef["state"]>["aihydroMessages"], withScienceServer = false) => ({
	currentTaskItem: taskItem,
	aihydroMessages,
	...(withScienceServer ? { mcpServers: fixtureMcpServers } : {}),
})

/** The owner's risky policy: every command and every file edit runs without asking (needs a higher version to apply). */
const ownerAutoRunSettings = {
	...DEFAULT_AUTO_APPROVAL_SETTINGS,
	version: DEFAULT_AUTO_APPROVAL_SETTINGS.version + 1,
	actions: {
		...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
		readFiles: true,
		editFiles: true,
		editFilesExternally: true,
		executeSafeCommands: true,
		executeAllCommands: true,
		useMcp: true,
	},
}

/** Screen options for the owner-session fixture at one detail level (the only difference between the two screens). */
const ownerShape = (detail: "normal" | "focus"): Partial<ScreenDef> => ({
	mcpServers: fixtureOwnerServers,
	state: {
		...taskState(tx.ownerApprovalPendingTask),
		transcriptDetail: detail,
		autoApprovalSettings: ownerAutoRunSettings,
		currentFocusChainChecklist: tx.ownerTodoChecklist,
	},
	expectVisible: [
		"text=The measurement could not resolve a study.",
		"text=SESSION_RESOLUTION_FAILED",
		"[data-testid=inline-approval]",
		"[data-testid=auto-run-risk]",
		// The count lives in the chip's accessible name and the popover; the chip itself stays "Auto-run: N on, risky".
		"[data-testid=auto-run-chip][aria-label*='45 MCP tools always allowed']",
		// X1-C1: the two undeclared-effect calls are one server-level line at Normal and a header count at Focus.
		detail === "normal" ? "text=declares no effect hints (2 calls" : "text=2 calls with no declared effect",
	],
	expectAbsent: ["text=API Request", ...(detail === "focus" ? ["text=declares no effect hints"] : [])],
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

const SETTINGS_TABS_VISIBLE: Partial<ScreenDef> = {
	expectVisible: ["[role=tablist][aria-label='Settings sections']", "[role=tab][aria-selected=true]", "[role=tabpanel]"],
}

/** A sidebar sub-view (Settings, MCP, Connectors, Skills) drawn full-bleed under the real providers. */
const navView = (id: string, title: string, view: () => ReactNode, extra: Partial<ScreenDef> = {}): ScreenDef => ({
	id,
	title,
	group: "nav",
	surface: "sidebar",
	render: () => (
		<Providers>
			<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>{view()}</div>
		</Providers>
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
	chatScreen("tools-status-ready", "Welcome with tools ready and trusted", {
		state: { welcomeViewCompleted: false },
		toolsEnv: {
			phase: "ready",
			healthy: true,
			version: "2.8.2",
			trust: "trusted",
			trustReason: "Trusted: its launch line matches the launcher AI-Hydro recorded.",
			venvPath: "/fixture/.aihydro/venvs/tools-2.8",
			serverName: "ai-hydro",
			serverCommand: "/fixture/.aihydro/venvs/tools-2.8/bin/aihydro-mcp",
		},
	}),
	chatScreen("tools-status-installing", "Welcome while the tools install", {
		state: { welcomeViewCompleted: false },
		toolsEnv: { phase: "installing", message: "Installing AI-Hydro tools (this can take several minutes)" },
	}),
	chatScreen("tools-status-unhealthy", "Chat home with unhealthy tools", {
		toolsEnv: {
			phase: "unhealthy",
			version: "2.8.1",
			message: "aihydro-mcp did not complete the MCP handshake: the server exited (code 1)",
			errorCode: "UNHEALTHY",
		},
	}),
	chatScreen("tools-status-untrusted", "Chat home with an untrusted launcher", {
		toolsEnv: {
			phase: "ready",
			healthy: true,
			version: "2.8.2",
			trust: "untrusted",
			trustReason:
				"AI-Hydro Tools is running from a new location (`/fixture/.aihydro/venvs/tools-2.8/bin/aihydro-mcp`). Your auto-run settings are paused until you confirm it. Previously trusted: ai-hydro (disabled).",
			serverName: "aihydro-tools",
			serverCommand: "/fixture/.aihydro/venvs/tools-2.8/bin/aihydro-mcp",
		},
	}),
	chatScreen("chat-home-history", "Chat home with history cards and composer status"),
	// W2-D: the composer footer. One status line replaces the 3-line "Tool auto-run" bar, the hint line and the
	// full-width Cancel.
	chatScreen("composer-danger-policy", "Composer: risky auto-run grants (edit all, all commands, MCP always allow)", {
		state: {
			...taskState(tx.runningTaskIdle),
			autoApprovalSettings: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				// The state stream only replaces the auto-approval settings when their version is higher.
				version: DEFAULT_AUTO_APPROVAL_SETTINGS.version + 1,
				actions: {
					...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
					readFiles: true,
					editFiles: true,
					editFilesExternally: true,
					executeSafeCommands: true,
					executeAllCommands: true,
					useMcp: true,
				},
			},
		},
		mcpServers: fixtureAlwaysAllowServers,
		expectVisible: [
			"[data-testid=auto-run-risk]",
			"text=risky",
			"[data-testid=composer-status]",
			"[data-testid=send-button]",
			"[data-testid=new-chat-button]",
		],
		expectAbsent: [
			"text=Tool auto-run",
			"text=hold shift to drag",
			"[data-testid=stop-button]",
			"text=Does not approve claims",
			"text=Start New Task",
		],
	}),
	chatScreen("composer-running", "Composer: request in flight (compact stop, no full-width Cancel)", {
		state: taskState(tx.runningTask),
		expectVisible: ["[data-testid=stop-button]", "[aria-label='Stop task']", "[data-testid=composer-status]"],
		expectAbsent: ["text=Tool auto-run", "text=hold shift to drag", "text=Type @ for context", "[data-testid=send-button]"],
	}),
	chatScreen("composer-popover", "Composer: auto-run popover with the claim disclaimer in its header", {
		state: taskState(tx.runningTaskIdle),
		steps: [{ wait: 600 }, { click: "[data-testid=auto-run-chip]" }, { wait: 400 }],
		expectVisible: [
			"text=Tool auto-run settings",
			"text=Enable tool auto-run",
			"text=Run any command",
			"text=Browse websites",
			"[data-testid=popover-disclaimer]",
			"text=Does not approve claims",
			"[data-testid=auto-run-chip][aria-expanded=true]",
		],
		expectAbsent: [
			"text=hold shift to drag",
			"text=Enable auto-approve",
			"text=Execute all commands",
			"text=Use the browser",
		],
	}),
	chatScreen("composer-add-menu", "Composer: the one Add menu (context, files, rules)", {
		state: taskState(tx.runningTaskIdle),
		steps: [{ wait: 600 }, { click: "[data-testid=add-menu-button]" }, { wait: 400 }],
		expectVisible: [
			"[data-testid=add-menu-button][aria-expanded=true]",
			"text=Add context (@)",
			"text=Attach files & images",
			"text=Rules & workflows",
		],
		expectAbsent: ["[aria-label*='MCP Servers']", "[aria-label*='Rules & Workflows']"],
	}),
	// X1-C4: paused MCP grants are a separate count chip; its popover says why and how to fix it.
	chatScreen("composer-paused-grants", "Composer: 45 paused MCP grants, popover open", {
		state: {
			...taskState(tx.runningTaskIdle),
			autoApprovalSettings: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				version: DEFAULT_AUTO_APPROVAL_SETTINGS.version + 1,
				actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, readFiles: true, useMcp: true },
			},
		},
		mcpServers: fixturePausedServers,
		steps: [{ wait: 600 }, { click: "[data-testid=paused-chip]" }, { wait: 400 }],
		expectVisible: [
			"[data-testid=paused-chip][aria-expanded=true]",
			"text=45 paused",
			"[data-testid=paused-popover]",
			"[data-testid=trust-launcher-action]",
			"[data-testid=open-mcp-view]",
			"[data-testid=auto-run-chip]",
		],
		expectAbsent: ["[data-testid=auto-run-risk]", "text=Does not approve claims"],
	}),
	// Every paused tool asks by design (destructive declaration, third-party server): neutral "5 ask first" chip, names
	// grouped by server with the reason, nothing to fix, and no Trust action.
	chatScreen("composer-paused-by-design", "Composer: 5 tools ask first by design (mixed causes), popover open", {
		state: {
			...taskState(tx.runningTaskIdle),
			autoApprovalSettings: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				version: DEFAULT_AUTO_APPROVAL_SETTINGS.version + 1,
				actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, readFiles: true, useMcp: true },
			},
		},
		mcpServers: fixturePausedMixedServers,
		steps: [{ wait: 600 }, { click: "[data-testid=paused-chip]" }, { wait: 400 }],
		expectVisible: [
			"[data-testid=paused-chip][aria-expanded=true]",
			"text=5 ask first",
			"text=run_workflow, workflow_status",
			"text=third-party server, so each run asks you",
			"text=may change or delete data, so each run asks you",
			"text=there is nothing to fix",
			"[data-testid=open-mcp-view]",
		],
		expectAbsent: ["[data-testid=trust-launcher-action]", "text=To lift a pause"],
	}),
	chatScreen("chat-home-empty-history", "Chat home, no history", { state: { taskHistory: [] } }),
	chatScreen("chat-task-text", "Task with plain text", {
		state: taskState(plainTextTask),
		expectVisible: ["text=Fixture text only"],
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
	}),
	// X0-2: the study chip and its picker (host-owned state; the chat id is a fixture value).
	chatScreen("chat-study-bound", "Study chip: bound by the map layer", {
		state: {
			...taskState(plainTextTask),
			studyBinding: {
				chatId: "01FIXTURECHAT000000000000",
				status: "bound",
				studyId: "fx-study-01",
				label: "Fixture River near Example, XX (fixture 0000001)",
				reason: "The map layer belongs to this study.",
				by: "map-layer",
				canChoose: true,
			},
		},
		expectVisible: ["#bound-study"],
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
	}),
	chatScreen("chat-study-choose", "Study picker: several studies, none chosen", {
		state: {
			...taskState(plainTextTask),
			studyBinding: {
				chatId: "01FIXTURECHAT000000000000",
				status: "choose",
				candidates: [
					{
						studyId: "fx-study-01",
						label: "Fixture River near Example, XX (fixture 0000001)",
						lastRun: "2026-08-02T14:03:00Z",
					},
					{
						studyId: "fx-study-02",
						label: "Fixture Creek at Sample, YY (fixture 0000002)",
						lastRun: "2026-07-19T09:30:00Z",
					},
					{ studyId: "fx-test-03", label: "fx-test-03 (unnamed study)" },
				],
				reason: "3 studies in this folder. Pick one before the first run.",
				canChoose: true,
			},
		},
		expectVisible: ["[data-testid=study-picker]", "text=Fixture Creek at Sample"],
		steps: SCROLL_TO_END,
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
	}),
	chatScreen("chat-study-none", "Study chip: no study in this folder", {
		state: {
			...taskState(plainTextTask),
			studyBinding: {
				chatId: "01FIXTURECHAT000000000000",
				status: "none",
				reason: "No study in this folder yet. Delineating a watershed creates one.",
				canChoose: true,
			},
		},
		expectVisible: ["#bound-study"],
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
	// Current tools (2.6.0-style): every tool annotated, so reads and session writes fold and only the destructive call is listed.
	chatTx(
		"chat-annotated-first-party",
		"Eight first-party calls, annotated tools (read / write / destructive mix)",
		tx.run8ToolsTask,
		"Eight recorded runs are listed above.",
		{
			mcpServers: fixtureAnnotatedServers,
			expectVisible: [
				"text=Eight recorded runs are listed above.",
				"[data-testid=work-group] button[aria-expanded=false]",
				"text=trend_analysis",
			],
			expectAbsent: ["text=API Request", "text=effect not declared by the server"],
		},
	),
	// An old server (for example aihydro-tools 2.3.7) publishes no annotations: each call is listed with a neutral tone.
	chatTx(
		"chat-unannotated-first-party",
		"Eight first-party calls, old server without annotations",
		tx.run8ToolsTask,
		"Eight recorded runs are listed above.",
		{
			mcpServers: fixtureUnannotatedServers,
			expectVisible: [
				"text=Eight recorded runs are listed above.",
				"[data-testid=work-group] button[aria-expanded=false]",
				"text=declares no effect hints (8 calls",
			],
			expectAbsent: ["text=API Request"],
		},
	),
	// ── X1-C0 (chat-polish P0): the "before" images X1-C1..C4 are measured against. No product change. ──────────
	// The owner's reviewed session shape: two unannotated answered calls, a SESSION_RESOLUTION_FAILED refusal, a pending
	// list_features ask, a risky auto-run policy, 45 always-allowed tools and a to-do 2/4. Normal and Focus differ since
	// X1-C1 (see chatDetailBaseline.test.ts).
	chatTx(
		"chat-owner-approval-pending",
		"Owner session shape at Normal: refusal, pending approval, risky policy, 45 granted tools, to-do 2/4",
		tx.ownerApprovalPendingTask,
		"The measurement could not resolve a study.",
		ownerShape("normal"),
	),
	chatTx(
		"chat-owner-approval-pending-focus",
		"Owner session shape at Focus (same transcript and state)",
		tx.ownerApprovalPendingTask,
		"The measurement could not resolve a study.",
		ownerShape("focus"),
	),
	// Four commands that ran under "Run any command" (auto_run_all), one exiting non-zero.
	chatTx(
		"chat-auto-run-all-commands",
		"Four commands auto-ran under All Commands, one exited non-zero",
		tx.autoRunAllCommandsTask,
		"Three commands ran cleanly; git status exited non-zero.",
		{
			state: {
				...taskState(tx.autoRunAllCommandsTask, true),
				autoApprovalSettings: ownerAutoRunSettings,
			},
			expectVisible: [
				"text=Three commands ran cleanly; git status exited non-zero.",
				"[data-testid=work-group] button[aria-expanded=false]",
				"text=Exited with code 128",
				"text=auto run all",
			],
			expectAbsent: ["text=API Request"],
		},
	),
	// Twelve calls to a server with no annotations, at Focus: the clutter case.
	chatTx(
		"chat-many-unannotated",
		"Twelve first-party calls, old server without annotations, at Focus",
		tx.manyUnannotatedTask,
		"Twelve recorded runs are listed above.",
		{
			mcpServers: fixtureUnannotatedServers,
			state: { ...taskState(tx.manyUnannotatedTask, true), transcriptDetail: "focus" },
			expectVisible: [
				"text=Twelve recorded runs are listed above.",
				"[data-testid=work-group] button[aria-expanded=false]",
				"text=12 calls with no declared effect",
			],
			// Focus: the notice is a header count, not a row.
			expectAbsent: ["text=API Request", "text=declares no effect hints"],
		},
	),
	// §2.2 C2: a chat started from the map; the first user turn is the whole wrapped template today.
	chatTx(
		"chat-map-launched-first-turn",
		"Map-launched chat: the first turn is the long wrapped template",
		tx.mapLaunchedFirstTurnTask,
		"The answer would go here. Fixture answer, not a result.",
		{
			state: {
				...taskState(tx.mapLaunchedFirstTurnTask, true),
				currentTaskItem: { ...taskItem, origin: "map", userQuestion: tx.MAP_LAUNCH_QUESTION },
			},
			expectVisible: ["text=The answer would go here. Fixture answer, not a result."],
		},
	),
	// Approvals are answered on their own card (W2-E2): the footer carries no Run/Deny for these asks.
	chatTx("chat-approval-mcp", "Pending MCP approval", tx.approvalMcpTask, "I will call the forcing tool next.", {
		expectVisible: ["text=I will call the forcing tool next.", APPROVAL_INLINE],
		expectAbsent: [FOOTER_ACTIONS],
	}),
	chatTx("chat-approval-command", "Pending command approval", tx.approvalCommandTask, "I will run the tests.", {
		expectVisible: ["text=I will run the tests.", APPROVAL_INLINE],
		expectAbsent: [FOOTER_ACTIONS],
	}),
	chatTx("chat-approval-edit", "Pending edit approval with diff", tx.approvalEditTask, "The label is wrong; I will edit it.", {
		expectVisible: ["text=The label is wrong; I will edit it.", APPROVAL_INLINE],
		expectAbsent: [FOOTER_ACTIONS],
	}),
	chatTx(
		"chat-approval-protected-path",
		"Pending approval outside the workspace",
		tx.protectedPathApprovalTask,
		"This needs a file outside the workspace.",
		{
			expectVisible: ["text=This needs a file outside the workspace.", APPROVAL_INLINE],
			// A security-marked call is never offered "Always".
			expectAbsent: [FOOTER_ACTIONS, APPROVAL_ALWAYS],
		},
	),
	chatTx(
		"chat-approval-protected-path-answered",
		"Answered approval outside the workspace",
		tx.protectedPathApprovedTask,
		"The hosts entry is in place.",
	),
	chatTx(
		"chat-approval-mcp-always",
		"Pending MCP approval, tool declared safe by a trusted server: Always offered",
		tx.approvalMcpTask,
		"I will call the forcing tool next.",
		{
			mcpServers: fixtureAnnotatedServers,
			expectVisible: ["text=I will call the forcing tool next.", APPROVAL_INLINE, APPROVAL_ALWAYS],
			expectAbsent: [FOOTER_ACTIONS],
		},
	),
	chatTx(
		"chat-approval-mcp-destructive",
		"Pending MCP approval, tool declared destructive: no Always",
		tx.approvalMcpDestructiveTask,
		"I will run the trend analysis next.",
		{
			mcpServers: fixtureAnnotatedServers,
			expectVisible: ["text=I will run the trend analysis next.", APPROVAL_INLINE],
			expectAbsent: [FOOTER_ACTIONS, APPROVAL_ALWAYS],
		},
	),
	// The realistic case today: the real server publishes no annotations, so every call has an undeclared effect.
	chatTx(
		"chat-approval-mcp-unannotated",
		"Pending MCP approval, server without annotations: no Always",
		tx.approvalMcpTask,
		"I will call the forcing tool next.",
		{
			mcpServers: fixtureUnannotatedServers,
			expectVisible: ["text=I will call the forcing tool next.", APPROVAL_INLINE],
			expectAbsent: [FOOTER_ACTIONS, APPROVAL_ALWAYS],
		},
	),
	chatTx(
		"chat-approval-mcp-untrusted",
		"Pending MCP approval, untrusted server: no Always",
		tx.approvalMcpTask,
		"I will call the forcing tool next.",
		{
			mcpServers: fixtureAnnotatedServers.map((s) => ({
				...s,
				trust: { trusted: false, reason: "fixture: not the registered server" },
			})),
			expectVisible: ["text=I will call the forcing tool next.", APPROVAL_INLINE],
			expectAbsent: [FOOTER_ACTIONS, APPROVAL_ALWAYS],
		},
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
	chatTx(
		"chat-answer-claims-audit",
		"Answer with approved and unapproved claim chips, a run chip and a graded audit footer",
		tx.answerClaimsAuditTask,
		"Fixture answer with claims and audit: no value here is a result.",
		{
			ledger: { sessionId: FIXTURE_SESSION, claims: [...statusClaims, approvalClaims.approved] },
			expectVisible: [
				"text=Fixture answer with claims and audit: no value here is a result.",
				"[data-testid=answer-turn-summary]",
				"[data-testid=answer-audit-footer]",
			],
		},
	),
	chatTx(
		"chat-answer-audit-hard",
		"Answer with untraced numbers: one summary line, underlined numbers, Ask AI-Hydro to link these",
		tx.answerAuditHardUxTask,
		"is a layout fixture. Fixture answer, not a result.",
		{
			expectVisible: [
				"text=3 numbers aren't linked to a recorded run",
				"button:has-text('Ask AI-Hydro to link these')",
				"[data-testid=untraced-number]",
			],
			expectAbsent: ["text=Fix:", "text=immediately after", "text=uncited_number"],
		},
	),
	chatTx(
		"chat-answer-audit-advisory",
		"Answer with advisory notes only: neutral summary, no action",
		tx.answerAuditAdvisoryUxTask,
		"is a layout fixture. Fixture answer, not a result.",
		{
			expectVisible: ["text=2 notes to review"],
			expectAbsent: ["button:has-text('Ask AI-Hydro to link these')", "[data-testid=untraced-number]"],
		},
	),
	chatTx(
		"chat-answer-audit-clean",
		"Answer with every number traced: a tiny check line",
		tx.answerAuditCleanUxTask,
		"Fixture answer, not a result.",
		{ expectVisible: ["text=All 4 numbers traced"], expectAbsent: ["[data-testid=untraced-number]"] },
	),
	chatTx("chat-answer-audit-graded", "Answer audit (structured, graded)", tx.answerAuditGradedTask, "linked to a recorded run"),
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

	// ── Navigation surfaces (Nav-0): sub-views the sidebar opens in place of the chat ──
	// Each renders the real view component full-bleed, the way App.tsx does when the view-title command opens it.
	// N3: the section list is a named tablist whose tabs have names at any width (icon-only below 500 px).
	navView(
		"settings-api",
		"Settings: API Configuration",
		() => <SettingsView onDone={() => {}} targetSection="api-config" />,
		SETTINGS_TABS_VISIBLE,
	),
	navView(
		"settings-features",
		"Settings: Features",
		() => <SettingsView onDone={() => {}} targetSection="features" />,
		SETTINGS_TABS_VISIBLE,
	),
	navView(
		"settings-general",
		"Settings: General",
		() => <SettingsView onDone={() => {}} targetSection="general" />,
		SETTINGS_TABS_VISIBLE,
	),
	navView(
		"settings-about",
		"Settings: About",
		() => <SettingsView onDone={() => {}} targetSection="about" />,
		SETTINGS_TABS_VISIBLE,
	),
	// Keyboard only: the arrows walk the sections (Features, then Browser) and select as they go.
	navView("settings-keyboard", "Settings: arrow keys walk the section list", () => <SettingsView onDone={() => {}} />, {
		steps: [
			{ wait: 300 },
			{ click: "[data-testid=tab-api-config]" },
			{ press: "ArrowDown" },
			{ press: "ArrowDown" },
			{ wait: 200 },
		],
		expectVisible: ["[data-testid=tab-browser][aria-selected=true]", "[role=tabpanel]"],
	}),
	navView(
		"mcp-configure",
		"MCP servers: Installed tab with servers and the tools status",
		() => <McpView onDone={() => {}} />,
		{
			mcpServers: fixtureMcpServers,
			toolsEnv: { phase: "ready", healthy: true, version: "2.8.2", trust: "trusted", serverName: "ai-hydro" },
			// N12: Installed is the first tab, the tools status sits above the servers, the switch has a name.
			expectVisible: [
				"[role=tab][aria-selected=true]:has-text('Installed')",
				"[data-testid=tools-status]",
				"[role=switch][aria-label^='Enable ']",
			],
		},
	),
	navView("mcp-installed-unhealthy", "MCP servers: Installed tab with unhealthy tools", () => <McpView onDone={() => {}} />, {
		mcpServers: fixtureMcpServers,
		toolsEnv: {
			phase: "unhealthy",
			version: "2.8.1",
			message: "aihydro-mcp did not complete the MCP handshake: the server exited (code 1)",
			errorCode: "UNHEALTHY",
		},
		expectVisible: ["[data-testid=tools-status]", "text=unhealthy"],
	}),
	navView("mcp-marketplace", "MCP servers: Marketplace tab", () => <McpView initialTab="marketplace" onDone={() => {}} />, {
		state: { mcpMarketplaceEnabled: true },
		catalogues: { mcpMarketplace: fixtureMcpMarketplace },
		// The view opens on its first tab once the extension state arrives, so wait and choose Marketplace explicitly.
		steps: [{ wait: 400 }, { click: "button:has-text('Marketplace')" }, { wait: 400 }],
	}),
	navView("connectors", "External connectors", () => <ConnectorsView onDone={() => {}} />),
	navView("skills", "Skills: Configured tab", () => <SkillsView onDone={() => {}} />, {
		catalogues: { skillsInstalled: fixtureInstalledSkills },
	}),
	navView("skills-marketplace", "Skills: Marketplace tab", () => <SkillsView onDone={() => {}} />, {
		catalogues: { skillsMarketplace: fixtureMarketplaceSkills },
		steps: [{ click: "button:has-text('Marketplace')" }, { wait: 400 }],
	}),
	// The first-run card inside the chat. Healthy and unhealthy tools: the card's checklist and the status chip
	// are read side by side.
	chatScreen("onboarding-card", "Onboarding card with the tools ready", {
		state: { shouldShowAnnouncement: true },
		mcpServers: fixtureMcpServers,
		toolsEnv: { phase: "ready", healthy: true, version: "2.8.2", trust: "trusted", serverName: "ai-hydro" },
		ready: ".announcement-step-dot",
	}),
	chatScreen("onboarding-card-unhealthy", "Onboarding card with unhealthy tools", {
		state: { shouldShowAnnouncement: true },
		mcpServers: fixtureMcpServers,
		toolsEnv: {
			phase: "unhealthy",
			version: "2.8.1",
			message: "aihydro-mcp did not complete the MCP handshake: the server exited (code 1)",
			errorCode: "UNHEALTHY",
		},
		ready: ".announcement-step-dot",
	}),
	// A running chat with its header folded: what a returning user sees first in a long task.
	chatScreen("chat-header-collapsed", "Chat header folded to its title row", {
		state: taskState(tx.ownerApprovalPendingTask, true),
		mcpServers: fixtureMcpServers,
		steps: [{ wait: 400 }, { click: ".task-header-card svg", nth: 0 }, ...SCROLL_TO_END],
		pixelDiffThreshold: STRUCTURAL_ONLY,
		scrollPinned: PINNED,
	}),

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
		steps: [...openTool("Layer manager"), { click: "#map-chrome-tab-basemap" }, { wait: 500 }],
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
		steps: [...openTool("Layer manager"), { click: "#map-chrome-tab-basemap" }, { wait: 500 }],
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
		steps: openTool("Layer manager"),
	}),
	mapScreen("map-layer-provenance", "Layer provenance tab with MISSING_PROVENANCE", {
		layers: featureLayers(),
		steps: [
			...openTool("Layer manager"),
			{ click: 'button[title="Show details"]', nth: 2 },
			{ wait: 300 },
			{ click: 'button:text-is("Provenance")' },
			{ wait: 300 },
			{ scroll: "text=No provenance record linked" },
		],
	}),
	mapScreen("map-time-slider", "Map time slider", {
		layers: featureLayers(),
		steps: openTool("Time slider", true),
	}),
	mapScreen("map-swipe", "Map swipe compare", {
		layers: [basinPolygon, ...featureLayers().slice(0, 1)],
		steps: openTool("Swipe", true),
	}),
	mapScreen("map-export-success", "Map export panel, artifacts written", {
		layers: featureLayers(),
		exportOutputs: 2,
		steps: [
			...openTool("Export snapshot", true),
			{ wait: 300 },
			{ click: 'button:has-text("Quick Export")' },
			{ wait: 1200 },
		],
	}),
	mapScreen("map-export-zero-output", "Map export panel, zero outputs reported", {
		layers: featureLayers(),
		exportOutputs: 0,
		steps: [
			...openTool("Export snapshot", true),
			{ wait: 300 },
			{ click: 'button:has-text("Quick Export")' },
			{ wait: 1200 },
		],
	}),

	// Pins (X1-M2, map-polish MP2): the Pins panel, the pin card, and the context menu on empty map and on a pin.
	mapScreen("map-pins-list", "Pins panel: list with rename, zoom to, delete and Clear all", {
		layers: featureLayers(),
		onMessage: pinsHost(),
		steps: openTool("Pins"),
	}),
	mapScreen("map-pin-card", "Pin card after clicking a pin: name, note, coordinates, actions", {
		layers: featureLayers(),
		onMessage: pinsHost(),
		steps: [...openTool("Pins"), { click: 'button[aria-label="Open pin Outlet candidate"]' }, { wait: 400 }],
		expectVisible: ['[data-testid="pin-card"]'],
		expectAbsent: ["text=__annotations-overlay", "text=#f97316"],
	}),
	mapScreen("map-pins-imported-banner", "Pins from before projects, with the one-time Keep / Clear banner", {
		layers: featureLayers(),
		onMessage: pinsHost(true),
		steps: openTool("Pins"),
	}),
	mapScreen("map-context-menu-empty", "Map context menu on empty map: grouped, codicons, one Add pin", {
		layers: featureLayers(),
		onMessage: pinsHost(),
		steps: [{ wait: 800 }, { contextClick: "canvas#ai-hydro-research-map", at: [80, 60] }, { wait: 500 }],
		expectVisible: ['[role="menu"]'],
	}),
	mapScreen("map-context-menu-pin", "Map context menu on a pin: Rename pin, Ask about this pin, Remove pin", {
		layers: featureLayers(),
		onMessage: pinsHost(),
		steps: [{ wait: 800 }, { contextClick: "canvas#ai-hydro-research-map" }, { wait: 500 }],
		expectVisible: ['[role="menu"]'],
	}),

	// Map chrome (X1-M1, map-polish MP1). The three chrome states, and the panel in the placement the width gives
	// it: docked at 960 and up (the canvas shrinks), floating at 600-959, a bottom sheet below 600 where the rail
	// is forced to the collapsed button. The harness checks each against the coverage budget.
	mapScreen("map-chrome-collapsed", "Map chrome collapsed: one 32 px Map tools button", {
		layers: featureLayers(),
		storage: { [MAP_STORAGE_KEY]: framedWorkspace(undefined, false, undefined, undefined, "collapsed") },
	}),
	mapScreen("map-chrome-rail", "Map chrome as a 40 px icon rail (5 tools and More)", {
		layers: featureLayers(),
		storage: { [MAP_STORAGE_KEY]: framedWorkspace(undefined, false, undefined, undefined, "rail") },
	}),
	mapScreen("map-chrome-hidden", "Map chrome hidden: only the edge tab remains", {
		layers: featureLayers(),
		storage: { [MAP_STORAGE_KEY]: framedWorkspace(undefined, false, undefined, undefined, "hidden") },
	}),
	mapScreen("map-panel-docked-layers", "Layers panel: docked beside the canvas at 960 and up", {
		layers: featureLayers(),
		steps: openTool("Layer manager"),
	}),
	mapScreen("map-panel-overlay-pins", "Pins panel: floats over the map at 600-959", {
		layers: featureLayers(),
		steps: openTool("Pins"),
	}),
	mapScreen("map-panel-sheet-400", "Measure panel: a bottom sheet below 600", {
		layers: featureLayers(),
		steps: openTool("Measure"),
	}),
	// Resizable panels (X1-M3 / polish-map): a size the user chose is remembered per panel and per window state.
	mapScreen("map-panel-docked-resized", "Layers panel docked, widened to 460 px (canvas gives up the width)", {
		layers: featureLayers(),
		storage: {
			[MAP_STORAGE_KEY]: framedWorkspace(undefined, false, undefined, undefined, undefined, {
				panelSizes: { layers: { docked: { width: 460 } } },
			}),
		},
		steps: openTool("Layer manager"),
	}),
	mapScreen("map-panel-overlay-resized", "Pins panel floating, resized and moved by its edges", {
		layers: featureLayers(),
		onMessage: pinsHost(),
		storage: {
			[MAP_STORAGE_KEY]: framedWorkspace(undefined, false, undefined, undefined, undefined, {
				panelSizes: { annotations: { overlay: { width: 360, height: 300, right: 40, top: 56 } } },
			}),
		},
		steps: openTool("Pins"),
	}),
	mapScreen("map-panel-resize-keyboard", "Panel widened from the keyboard: arrow keys on the focused separator", {
		layers: featureLayers(),
		onMessage: pinsHost(),
		steps: [
			...openTool("Pins"),
			{ click: '[role="separator"][aria-label^="Resize pins panel"]' },
			{ press: "Shift+ArrowLeft" },
			{ wait: 300 },
		],
	}),
	// No layers: Swipe, Time and Flood are listed but disabled, each with its reason.
	mapScreen("map-more-flyout", "More menu with Swipe, Time and Flood disabled and why", {
		steps: [
			{ click: 'button[aria-label^="Map tools"]', optional: true },
			{ click: 'button[aria-label="More tools"]', optional: true },
			{ wait: 400 },
		],
		expectVisible: ['[role="menuitem"][aria-label^="Swipe"]'],
	}),
	mapScreen("map-export-sheet", "Export as a centred sheet over a scrim", {
		layers: featureLayers(),
		steps: openTool("Export snapshot", true),
		expectVisible: ['[role="dialog"]'],
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
