import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { ApiHandler } from "@core/api"
import { getRecordedFirstPartyLauncher, setRecordedFirstPartyLauncher } from "@shared/aihydro/firstPartyServers"
import type { SubagentOrigin } from "@shared/aihydro/subagents"
import type { AiHydroAsk } from "@shared/ExtensionMessage"
import { HostProvider } from "@/hosts/host-provider"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import type { AskMeta } from "../../askMeta"
import { EXPLORER_PROFILE } from "../agentProfile"
import { type ParentAsk, ParentAskBridge } from "../ParentAskBridge"
import type { SupervisorRunnerBase } from "../SubagentSupervisor"
import type { SubagentRecord, SubagentRecordWriter } from "../subagentRecord"

export const LAUNCHER = { name: "ai-hydro", command: "/opt/miniconda3/bin/aihydro-mcp", args: [] as string[] }
export const TRUSTED_CONFIG = JSON.stringify({ type: "stdio", command: LAUNCHER.command, args: [] })

/** What a scripted model says on one request: text, optional usage. A function sees the history so far. */
export type ScriptedTurn =
	| string
	| { text: string; usage?: { inputTokens: number; outputTokens: number; totalCost?: number } }
	| ((history: any[]) => string)

export function tool(name: string, params: Record<string, string>): string {
	return `<${name}>\n${Object.entries(params)
		.map(([key, value]) => `<${key}>${value}</${key}>`)
		.join("\n")}\n</${name}>`
}

/** A model that plays the given turns in order, then keeps repeating the last. `onRequest` observes each call. */
export function scriptedApi(
	turns: ScriptedTurn[],
	opts: { contextWindow?: number; onRequest?: (system: string, history: any[]) => void; hang?: boolean } = {},
): ApiHandler & { requests: number; streamsOpen: number } {
	let index = 0
	const api = {
		requests: 0,
		streamsOpen: 0,
		getModel: () => ({
			id: "scripted-model",
			info: { contextWindow: opts.contextWindow ?? 200_000, supportsImages: false } as any,
		}),
		createMessage(system: string, history: any[]) {
			api.requests++
			opts.onRequest?.(system, history)
			const turn = turns[Math.min(index++, turns.length - 1)]
			const resolved =
				typeof turn === "function" ? { text: turn(history) } : typeof turn === "string" ? { text: turn } : turn
			return (async function* () {
				api.streamsOpen++
				try {
					if (opts.hang) {
						await new Promise(() => {})
					}
					yield { type: "response_model" as const, modelId: "scripted-model-2026" }
					yield { type: "text" as const, text: resolved.text }
					yield {
						type: "usage" as const,
						inputTokens: (resolved as any).usage?.inputTokens ?? 100,
						outputTokens: (resolved as any).usage?.outputTokens ?? 20,
						...((resolved as any).usage?.totalCost !== undefined
							? { totalCost: (resolved as any).usage.totalCost }
							: {}),
					}
				} finally {
					api.streamsOpen--
				}
			})()
		},
	}
	return api as any
}

export interface FakeTool {
	name: string
	description?: string
	annotations?: Record<string, unknown>
	inputSchema?: object
	autoApprove?: boolean
	_meta?: Record<string, unknown>
}

export const DEFAULT_MCP_TOOLS: FakeTool[] = [
	{
		name: "get_session_summary",
		annotations: { readOnlyHint: true, openWorldHint: false },
		description: "Summarise the session",
	},
	{ name: "run_python", annotations: { readOnlyHint: false, destructiveHint: true }, description: "Run code" },
	{ name: "add_claim", annotations: { readOnlyHint: false }, description: "Add a claim" },
	{ name: "fetch_usgs", annotations: { readOnlyHint: true }, description: "Open-world fetch" },
]

export function fakeMcpHub(tools: FakeTool[] = DEFAULT_MCP_TOOLS, config: string = TRUSTED_CONFIG) {
	const calls: Array<{ server: string; tool: string; args: unknown; meta: unknown }> = []
	const server = { name: "ai-hydro", status: "connected", config, tools, resources: [] }
	const hub = {
		calls,
		connections: [{ server }],
		getServers: () => [server],
		getPendingNotifications: () => [],
		callTool: async (serverName: string, toolName: string, args: unknown, _ulid: string, meta: unknown) => {
			calls.push({ server: serverName, tool: toolName, args, meta })
			return { content: [{ type: "text", text: `result of ${toolName}` }] }
		},
		readResource: async () => ({ contents: [{ text: "resource" }] }),
	}
	return hub
}

export interface ParentHarness {
	dir: string
	/** Asks that reached the parent, in order, with the origin the bridge stamped. */
	asks: Array<{ type: AiHydroAsk; text?: string; meta?: AskMeta }>
	/** The parent's `say` must never be called by a child; this counts calls to it. */
	parentSays: number
	/** lastMessageTs of the fake parent: a child must never move it. */
	lastMessageTs: number
	aborted: boolean
	/** How the parent answers asks: a function of the ask. Defaults to approve. */
	answer: (ask: { type: AiHydroAsk; text?: string; meta?: AskMeta }) => Promise<{ response: any; text?: string }>
	bridge: ParentAskBridge
	records: SubagentRecord[]
	writeRecord: SubagentRecordWriter
	runnerBase: SupervisorRunnerBase
	mcp: ReturnType<typeof fakeMcpHub>
	settings: Record<string, unknown>
	cleanup: () => void
}

/**
 * A fake parent task: a real temp workspace, a trusted fake MCP hub, a settings map, and a record of every ask that
 * reaches the parent. The runner, the executor, the handlers and the bridge under test are the real ones.
 */
export function makeParent(overrides: { mcpTools?: FakeTool[]; settings?: Record<string, unknown> } = {}): ParentHarness {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-sub-"))
	fs.writeFileSync(path.join(dir, "README.md"), "# Demo\nA tiny workspace.\n")
	fs.mkdirSync(path.join(dir, "src"))
	fs.writeFileSync(path.join(dir, "src", "model.py"), "def nse(sim, obs):\n    return 1.0\n")

	const savedLauncher = getRecordedFirstPartyLauncher()
	setRecordedFirstPartyLauncher(LAUNCHER)
	HostProvider.reset()
	HostProvider.initialize(
		(() => {}) as any,
		(() => {}) as any,
		{ workspaceClient: { getWorkspacePaths: async () => ({ paths: [dir] }) } } as any,
		() => {},
		async () => "",
		async () => "",
		"/mock/extension",
		path.join(os.tmpdir(), "aihydro-sub-storage"),
	)

	const settings: Record<string, unknown> = {
		yoloModeToggled: false,
		mode: "act",
		strictPlanModeEnabled: false,
		hooksEnabled: false,
		browserSettings: { disableToolUse: true },
		focusChainSettings: { enabled: false },
		maxConsecutiveMistakes: 3,
		multiRootEnabled: false,
		autoApprovalSettings: {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			enabled: true,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, readFiles: true, readFilesExternally: false, useMcp: true },
		},
		...overrides.settings,
	}
	const stateManager = {
		getGlobalSettingsKey: (key: string) => settings[key],
		getGlobalStateKey: (key: string) => settings[key],
	} as any

	const mcp = fakeMcpHub(overrides.mcpTools)
	const harness: ParentHarness = {
		dir,
		asks: [],
		parentSays: 0,
		lastMessageTs: 1_000,
		aborted: false,
		answer: async () => ({ response: "yesButtonClicked" }),
		records: [],
		mcp,
		settings,
		bridge: undefined as any,
		writeRecord: async (record) => {
			harness.records.push(record)
			return `subagents/${record.childId}.json`
		},
		runnerBase: undefined as any,
		cleanup: () => {
			setRecordedFirstPartyLauncher(savedLauncher)
			HostProvider.reset()
			fs.rmSync(dir, { recursive: true, force: true })
		},
	}
	const parentAsk: ParentAsk = async (type, text, _partial, meta) => {
		harness.asks.push({ type, text, meta })
		return harness.answer({ type, text, meta })
	}
	harness.bridge = new ParentAskBridge(parentAsk, () => harness.aborted)
	harness.runnerBase = {
		context: { extension: { extensionPath: "/mock" } } as any,
		services: {
			mcpHub: mcp as any,
			browserSession: {
				closeBrowser: () => {
					throw new Error("a child must never touch the parent's browser")
				},
			} as any,
			urlContentFetcher: {} as any,
			diffViewProvider: {} as any,
			fileContextTracker: {
				trackFileContext: () => {
					throw new Error("a child must not use the parent's tracker")
				},
			} as any,
			aihydroIgnoreController: { validateAccess: () => true, aihydroIgnoreContent: undefined } as any,
			contextManager: {} as any,
			stateManager,
			controller: { getChatProjectId: () => undefined, observeStudyBindingSignal: () => {} } as any,
		},
		stateManager,
		cwd: dir,
		taskId: "task-1",
		ulid: "ulid-parent",
		isMultiRootEnabled: false,
		aihydroIgnoreController: { validateAccess: () => true, aihydroIgnoreContent: undefined } as any,
		bridge: harness.bridge,
		isParentAborted: () => harness.aborted,
		writeRecord: harness.writeRecord,
		now: Date.now,
		pollMs: 10,
	}
	return harness
}

export const PARENT_CAPS = { canCall: () => true, workspaceTrusted: true, parentIsChild: false }
export const PROFILE = EXPLORER_PROFILE
export type { SubagentOrigin }
