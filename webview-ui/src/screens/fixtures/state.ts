/**
 * Synthetic extension-state fixtures. Everything here is invented for layout
 * review (source_status: "synthetic"); none of it is a research result.
 */
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_DICTATION_SETTINGS } from "@shared/DictationSettings"
import { type ExtensionState } from "@shared/ExtensionMessage"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "@shared/FocusChainSettings"
import type { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_MCP_DISPLAY_MODE } from "@shared/McpDisplayMode"

export const FIXTURE_NOW = Date.UTC(2026, 9, 1, 15, 30, 0)

export const fixtureHistory: HistoryItem[] = [
	{
		id: "fx-task-3",
		ts: FIXTURE_NOW - 3_600_000,
		task: "**Delineate** the catchment for `SYN-00000001` and summarise its [signatures](run:fx-run-0003)",
		tokensIn: 184_200,
		tokensOut: 9_640,
		cacheWrites: 42_100,
		cacheReads: 120_000,
		totalCost: 0.4812,
		isFavorited: true,
	},
	{
		id: "fx-task-2",
		ts: FIXTURE_NOW - 86_400_000,
		task: "Compare modelled and observed streamflow for the synthetic gauge SYN-00000002",
		tokensIn: 52_300,
		tokensOut: 3_100,
		totalCost: 0.1127,
	},
	{
		id: "fx-task-1",
		ts: FIXTURE_NOW - 3 * 86_400_000,
		task: "Why did the gauge lookup stop? Explain the refusal",
		tokensIn: 9_800,
		tokensOut: 1_240,
		totalCost: 0.0231,
	},
]

export function buildBaseState(overrides: Partial<ExtensionState> = {}): ExtensionState {
	return {
		version: "fixture",
		isNewUser: false,
		welcomeViewCompleted: true,
		apiConfiguration: {
			planModeApiProvider: "anthropic",
			actModeApiProvider: "anthropic",
			planModeApiModelId: "fixture-model-plan",
			actModeApiModelId: "fixture-model-act",
		},
		aihydroMessages: [],
		taskHistory: fixtureHistory,
		shouldShowAnnouncement: false,
		autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
		browserSettings: DEFAULT_BROWSER_SETTINGS,
		dictationSettings: DEFAULT_DICTATION_SETTINGS,
		focusChainSettings: DEFAULT_FOCUS_CHAIN_SETTINGS,
		preferredLanguage: "English",
		openaiReasoningEffort: "medium",
		mode: "act",
		platform: "darwin",
		telemetrySetting: "disabled",
		distinctId: "fixture",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: false,
		mcpDisplayMode: DEFAULT_MCP_DISPLAY_MODE,
		transcriptDetail: "normal",
		protectedRoots: [],
		globalAiHydroRulesToggles: {},
		localAiHydroRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		terminalOutputLineLimit: 500,
		maxConsecutiveMistakes: 3,
		subagentTerminalOutputLineLimit: 2000,
		defaultTerminalProfile: "default",
		mcpResponsesCollapsed: true,
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		useAutoCondense: false,
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 99,
		lastDismissedModelBannerVersion: 99,
		remoteConfigSettings: {},
		subagentsEnabled: false,
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		hooksEnabled: { user: false, featureFlag: false },
		workspaceHtmlFiles: [],
		htmlPreviewVersion: 0,
		htmlPreviewActiveId: null,
		...overrides,
	}
}
