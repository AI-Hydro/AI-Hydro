import { type AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { McpServer } from "@shared/mcp"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deriveAutoRunPolicy } from "../autoRunPolicy"
import ComposerStatus, { CLAIM_DISCLAIMER } from "../ComposerStatus"

let settings: AutoApprovalSettings = DEFAULT_AUTO_APPROVAL_SETTINGS
let servers: McpServer[] = []
let yolo = false

const navigateToMcp = vi.fn()
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ autoApprovalSettings: settings, mcpServers: servers, yoloModeToggled: yolo, navigateToMcp }),
}))
vi.mock("@/hooks/useAutoApproveActions", () => ({
	useAutoApproveActions: () => ({
		isChecked: () => false,
		isFavorited: () => false,
		toggleFavorite: () => {},
		updateAction: () => {},
		updateMaxRequests: () => {},
	}),
}))
const runToolsEnvAction = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock("@/services/grpc-client", () => ({ McpServiceClient: { runToolsEnvAction } }))

const withActions = (actions: Partial<AutoApprovalSettings["actions"]>, extra: Partial<AutoApprovalSettings> = {}) => ({
	...DEFAULT_AUTO_APPROVAL_SETTINGS,
	actions: {
		readFiles: false,
		editFiles: false,
		useBrowser: false,
		useMcp: false,
		...actions,
	},
	...extra,
})
const server = (tools: { name: string; autoApprove?: boolean }[], disabled = false): McpServer =>
	({ name: "s", config: "{}", status: "connected", tools, disabled }) as McpServer

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		disconnect() {}
		unobserve() {}
	},
)

afterEach(() => {
	cleanup()
	settings = DEFAULT_AUTO_APPROVAL_SETTINGS
	servers = []
	yolo = false
})

describe("ComposerStatus chip", () => {
	it("is one compact chip with a count, and the accessible name keeps the full list", () => {
		settings = withActions({ readFiles: true, editFiles: true, useMcp: true })
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		expect(chip).toHaveTextContent("Auto-run: 3 on")
		expect(chip).not.toHaveTextContent("Read")
		expect(chip.getAttribute("aria-label")).toContain("Auto-run: Read, Edit, MCP")
		expect(screen.queryByTestId("auto-run-risk")).toBeNull()
		expect(screen.queryByText("Tool auto-run")).toBeNull()
	})

	it("says off when the master switch is off and none when nothing is granted", () => {
		settings = withActions({ readFiles: true }, { enabled: false })
		const { unmount } = render(<ComposerStatus />)
		expect(screen.getByTestId("auto-run-chip")).toHaveTextContent("Auto-run: off")
		unmount()
		settings = withActions({})
		render(<ComposerStatus />)
		expect(screen.getByTestId("auto-run-chip")).toHaveTextContent("Auto-run: none")
	})

	it("marks danger with icon + text and states it in the accessible name, for each risky source", () => {
		const cases: [string, Partial<AutoApprovalSettings["actions"]>, McpServer[], RegExp][] = [
			["edit all", { readFiles: true, editFiles: true, editFilesExternally: true }, [], /edits any file/],
			["all commands", { executeSafeCommands: true, executeAllCommands: true }, [], /runs any terminal command/],
			[
				"enableAll",
				{
					readFiles: true,
					readFilesExternally: true,
					editFiles: true,
					editFilesExternally: true,
					executeSafeCommands: true,
					executeAllCommands: true,
					useBrowser: true,
					useMcp: true,
				},
				[],
				/all actions auto-run/,
			],
			[
				"mcp always-allow",
				{ readFiles: true, useMcp: true },
				[
					server([
						{ name: "a", autoApprove: true },
						{ name: "b", autoApprove: true },
					]),
				],
				/2 MCP tools always allowed/,
			],
		]
		for (const [, actions, srv, reason] of cases) {
			settings = withActions(actions)
			servers = srv
			const { unmount } = render(<ComposerStatus />)
			const risk = screen.getByTestId("auto-run-risk")
			expect(risk).toHaveTextContent("risky")
			expect(risk.querySelector(".codicon-warning")).not.toBeNull()
			expect(screen.getByTestId("auto-run-chip").getAttribute("aria-label")).toMatch(reason)
			unmount()
		}
	})

	it("counts MCP always-allowed tools, ignoring disabled servers, in the name and the popover", () => {
		settings = withActions({ readFiles: true, useMcp: true })
		servers = [server([{ name: "a", autoApprove: true }]), server([{ name: "b", autoApprove: true }], true)]
		render(<ComposerStatus />)
		expect(screen.getByTestId("auto-run-chip").getAttribute("aria-label")).toContain("1 MCP tool always allowed")
		fireEvent.click(screen.getByTestId("auto-run-chip"))
		expect(screen.getByTestId("popover-risk")).toHaveTextContent("1 MCP tool always allowed")
	})

	it("has no danger marker for safe grants (read, edit in workspace, read-only commands, browser, MCP)", () => {
		settings = withActions({
			readFiles: true,
			readFilesExternally: true,
			editFiles: true,
			executeSafeCommands: true,
			useBrowser: true,
			useMcp: true,
		})
		servers = [server([{ name: "a" }, { name: "b", autoApprove: false }])]
		render(<ComposerStatus />)
		expect(screen.queryByTestId("auto-run-risk")).toBeNull()
		expect(deriveAutoRunPolicy(settings, servers).risky).toBe(false)
	})

	it("does not flag action grants while the master switch is off", () => {
		settings = withActions({ editFiles: true, editFilesExternally: true }, { enabled: false })
		render(<ComposerStatus />)
		expect(screen.queryByTestId("auto-run-risk")).toBeNull()
	})
})

describe("ComposerStatus YOLO and dormant MCP grants", () => {
	it("marks YOLO as risky even when auto-run is off, with YOLO in the chip text", () => {
		settings = withActions({ readFiles: true }, { enabled: false })
		yolo = true
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		expect(chip).toHaveTextContent("YOLO")
		expect(screen.getByTestId("auto-run-risk")).toHaveTextContent("risky")
		expect(chip.getAttribute("aria-label")).toMatch(
			/YOLO mode is on: everything auto-runs, even when auto-run is off, except MCP tools without a working Always grant/,
		)
	})

	it("is not risky with YOLO off and the defaults", () => {
		render(<ComposerStatus />)
		expect(screen.queryByTestId("auto-run-risk")).toBeNull()
		expect(deriveAutoRunPolicy(DEFAULT_AUTO_APPROVAL_SETTINGS, [], false).risky).toBe(false)
	})

	it("labels dormant MCP always-allow truthfully and still flags it", () => {
		settings = withActions({ readFiles: true }, { enabled: false })
		servers = [
			server([
				{ name: "a", autoApprove: true },
				{ name: "b", autoApprove: true },
			]),
		]
		render(<ComposerStatus />)
		expect(screen.getByTestId("auto-run-risk")).toBeInTheDocument()
		const name = screen.getByTestId("auto-run-chip").getAttribute("aria-label")
		expect(name).toContain("2 MCP tools set to always allow (inactive while auto-run is off)")
	})

	it("says MCP auto-run is off when only the MCP action is off", () => {
		settings = withActions({ readFiles: true })
		servers = [server([{ name: "a", autoApprove: true }])]
		expect(deriveAutoRunPolicy(settings, servers).mcpLabel).toBe(
			"1 MCP tool set to always allow (inactive while MCP auto-run is off)",
		)
	})

	it("flags All Commands only together with read-only commands, as core gates it", () => {
		expect(deriveAutoRunPolicy(withActions({ executeAllCommands: true }), []).risky).toBe(false)
		expect(deriveAutoRunPolicy(withActions({ executeAllCommands: true, executeSafeCommands: true }), []).risky).toBe(true)
	})

	it("does not call MCP grants dormant under YOLO (core makes them live)", () => {
		const s = withActions({ readFiles: true }, { enabled: false })
		const p = deriveAutoRunPolicy(s, [server([{ name: "a", autoApprove: true }])], true)
		expect(p.mcpDormant).toBe(false)
		expect(p.mcpLabel).toBe("1 MCP tool always allowed")
	})

	it("uses truthiness for the master switch like core", () => {
		const s = withActions({ editFiles: true, editFilesExternally: true }, { enabled: undefined as unknown as boolean })
		expect(deriveAutoRunPolicy(s, []).risky).toBe(false)
	})
})

describe("ComposerStatus disclaimer and popover", () => {
	it("is not a permanent row: the claim disclaimer is absent at rest", () => {
		render(<ComposerStatus />)
		expect(screen.queryByText(CLAIM_DISCLAIMER)).toBeNull()
	})

	it("keeps the footer to one row of chips, each a small target", () => {
		settings = withActions({ readFiles: true, editFilesExternally: true, editFiles: true })
		servers = [{ ...server([{ name: "a", autoApprove: true }]), trust: { trusted: false, reason: "x" } } as McpServer]
		render(<ComposerStatus />)
		const row = screen.getByTestId("composer-status")
		expect(row.className).toContain("aih-composer-status")
		expect(row.querySelectorAll("button")).toHaveLength(2) // auto-run chip and paused chip
		expect(row.querySelectorAll("p")).toHaveLength(0)
	})

	it("reaches the claim disclaimer in one click, in the auto-run popover", () => {
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		expect(chip).toHaveAttribute("aria-expanded", "false")
		fireEvent.click(chip)
		expect(chip).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByText("Tool auto-run settings")).toBeInTheDocument()
		expect(screen.getAllByText(CLAIM_DISCLAIMER)).toHaveLength(1)
		expect(screen.getByTestId("popover-disclaimer")).toHaveTextContent(CLAIM_DISCLAIMER)
	})

	it("lists each risky reason with a warning icon in the popover", () => {
		settings = withActions({ executeSafeCommands: true, executeAllCommands: true })
		render(<ComposerStatus />)
		fireEvent.click(screen.getByTestId("auto-run-chip"))
		const risk = screen.getByTestId("popover-risk")
		expect(risk).toHaveTextContent("Risky: runs any terminal command without asking")
		expect(risk.querySelector(".codicon-warning")).not.toBeNull()
	})

	it("is a labelled dialog, takes focus, closes on Escape and returns focus to the chip", () => {
		const onStop = vi.fn()
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		fireEvent.click(chip)
		const dialog = screen.getByRole("dialog", { name: "Tool auto-run settings" })
		expect(document.activeElement).toBe(dialog)
		expect(screen.getByLabelText("Close")).toBeInTheDocument()
		// a window-level listener stands in for anything that would cancel on Escape
		window.addEventListener("keydown", onStop)
		const bubbled = fireEvent.keyDown(dialog, { key: "Escape" })
		window.removeEventListener("keydown", onStop)
		expect(onStop).not.toHaveBeenCalled()
		expect(bubbled).toBe(false)
		expect(screen.queryByRole("dialog")).toBeNull()
		expect(document.activeElement).toBe(chip)
	})

	it("restores focus to the chip when closed with the Close button", () => {
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		fireEvent.click(chip)
		fireEvent.click(screen.getByLabelText("Close"))
		expect(screen.queryByRole("dialog")).toBeNull()
		expect(document.activeElement).toBe(chip)
	})

	it("closes on a click away and restores focus to the chip", () => {
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		fireEvent.click(chip)
		fireEvent.mouseDown(document.body)
		fireEvent.touchStart(document.body)
		expect(screen.queryByRole("dialog")).toBeNull()
		expect(document.activeElement).toBe(chip)
	})

	it("has no favourite stars (they only fed the removed bar)", () => {
		render(<ComposerStatus />)
		fireEvent.click(screen.getByTestId("auto-run-chip"))
		expect(document.querySelector(".codicon-star-empty, .codicon-star-full")).toBeNull()
	})
})

describe("ComposerStatus context ring", () => {
	it("labels the ring with the percentage and window, and says unknown otherwise", () => {
		const { unmount } = render(<ComposerStatus contextTokens={82_000} contextWindow={200_000} />)
		expect(screen.getByRole("img", { name: "Context 41% of 200.0k" })).toBeInTheDocument()
		unmount()
		render(<ComposerStatus />)
		expect(screen.getByRole("img", { name: "Context usage unknown" })).toBeInTheDocument()
	})
})

describe("ComposerStatus paused MCP grants (M-3)", () => {
	const trusted = { trusted: true, reason: "" }
	const tool = (name: string, annotations?: Record<string, boolean>) => ({ name, autoApprove: true, annotations })
	const srv = (tools: ReturnType<typeof tool>[], trust: McpServer["trust"], status: McpServer["status"] = "connected") =>
		({ name: "ai-hydro", config: "{}", status, tools, trust }) as McpServer

	it("counts a grant the host would honour, and pauses the ones its run-time recheck refuses", () => {
		const s = withActions({ readFiles: true, useMcp: true })
		const p = deriveAutoRunPolicy(s, [
			srv([tool("r", { readOnlyHint: true }), tool("nuke", { destructiveHint: true }), tool("bare")], trusted),
		])
		expect(p.mcpAlwaysAllowed).toBe(1)
		expect(p.mcpPaused).toBe(2)
		expect(p.mcpLabel).toBe("1 MCP tool always allowed, 2 MCP tools paused (asks first)")
	})

	it("a server that lost trust or is disconnected pauses everything and is not risky", () => {
		const s = withActions({ readFiles: true, useMcp: true })
		const tools = [tool("r", { readOnlyHint: true })]
		for (const server of [srv(tools, { trusted: false, reason: "changed" }), srv(tools, trusted, "disconnected")]) {
			const p = deriveAutoRunPolicy(s, [server])
			expect(p.mcpAlwaysAllowed).toBe(0)
			expect(p.mcpPaused).toBe(1)
			expect(p.risky).toBe(false)
			expect(p.mcpLabel).toBe("1 MCP tool paused (asks first)")
		}
	})

	it("without a trust verdict from the host the grant still counts (over-warn)", () => {
		const p = deriveAutoRunPolicy(withActions({ readFiles: true, useMcp: true }), [srv([tool("r")], undefined)])
		expect(p.mcpAlwaysAllowed).toBe(1)
		expect(p.mcpPaused).toBe(0)
		expect(p.risky).toBe(true)
	})

	it("shows paused grants as a separate count chip, only when there are any", () => {
		settings = withActions({ readFiles: true, useMcp: true })
		const { unmount } = render(<ComposerStatus />)
		expect(screen.queryByTestId("paused-chip")).toBeNull()
		unmount()
		servers = [srv([tool("r", { readOnlyHint: true })], { trusted: false, reason: "changed" })]
		render(<ComposerStatus />)
		const paused = screen.getByTestId("paused-chip")
		expect(paused).toHaveTextContent("1 paused")
		expect(paused.getAttribute("aria-label")).toBe("1 MCP tool paused, asks first. Opens details.")
		expect(screen.queryByTestId("auto-run-risk")).toBeNull()
		expect(screen.getByTestId("auto-run-chip")).not.toHaveTextContent("paused")
	})

	it("explains why in a popover, offers the host-owned Trust this launcher action, and links to the tools view", () => {
		settings = withActions({ readFiles: true, useMcp: true })
		servers = [
			srv([tool("a", { readOnlyHint: true }), tool("b", { readOnlyHint: true })], { trusted: false, reason: "changed" }),
		]
		render(<ComposerStatus />)
		fireEvent.click(screen.getByTestId("paused-chip"))
		const popover = screen.getByRole("dialog", { name: "Paused MCP tools" })
		expect(popover).toHaveTextContent("Nothing here runs without you")
		expect(screen.getByTestId("paused-reasons")).toHaveTextContent("2 tools: the server is not trusted")
		const trust = screen.getByTestId("trust-launcher-action")
		expect(trust).toHaveTextContent("Trust this launcher")
		fireEvent.click(trust)
		// The webview only asks the host to show its confirmation; it records nothing itself.
		expect(runToolsEnvAction).toHaveBeenCalledWith(expect.objectContaining({ serverName: "ai-hydro" }))
		fireEvent.click(screen.getByTestId("open-mcp-view"))
		expect(navigateToMcp).toHaveBeenCalledTimes(1)
	})

	it("offers no trust action when the pause is not about trust (a disconnected, trusted server)", () => {
		settings = withActions({ readFiles: true, useMcp: true })
		servers = [srv([tool("a", { readOnlyHint: true })], { trusted: true, reason: "" }, "disconnected")]
		render(<ComposerStatus />)
		fireEvent.click(screen.getByTestId("paused-chip"))
		expect(screen.queryByTestId("trust-launcher-action")).toBeNull()
	})

	it("Escape closes the paused popover and returns focus to its chip", () => {
		settings = withActions({ readFiles: true, useMcp: true })
		servers = [srv([tool("a", { readOnlyHint: true })], { trusted: false, reason: "changed" })]
		render(<ComposerStatus />)
		const chip = screen.getByTestId("paused-chip")
		fireEvent.click(chip)
		fireEvent.keyDown(screen.getByRole("dialog", { name: "Paused MCP tools" }), { key: "Escape" })
		expect(screen.queryByRole("dialog")).toBeNull()
		expect(document.activeElement).toBe(chip)
	})
})
