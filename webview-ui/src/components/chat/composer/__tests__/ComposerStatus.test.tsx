import { type AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { McpServer } from "@shared/mcp"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deriveAutoRunPolicy } from "../autoRunPolicy"
import ComposerStatus, { CLAIM_DISCLAIMER } from "../ComposerStatus"

let settings: AutoApprovalSettings = DEFAULT_AUTO_APPROVAL_SETTINGS
let servers: McpServer[] = []
let yolo = false

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ autoApprovalSettings: settings, mcpServers: servers, yoloModeToggled: yolo }),
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
vi.mock("@/services/grpc-client", () => ({}))

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
	it("is one chip derived from the action ids, e.g. Auto-run: Read, Edit, MCP", () => {
		settings = withActions({ readFiles: true, editFiles: true, useMcp: true })
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		expect(chip).toHaveTextContent("Auto-run: Read, Edit, MCP")
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
			expect(risk).toHaveTextContent("(risky)")
			expect(risk.querySelector(".codicon-warning")).not.toBeNull()
			expect(screen.getByTestId("auto-run-chip").getAttribute("aria-label")).toMatch(reason)
			unmount()
		}
	})

	it("shows the count of MCP always-allowed tools, ignoring disabled servers", () => {
		settings = withActions({ readFiles: true, useMcp: true })
		servers = [server([{ name: "a", autoApprove: true }]), server([{ name: "b", autoApprove: true }], true)]
		render(<ComposerStatus />)
		expect(screen.getByTestId("auto-run-chip")).toHaveTextContent("1 MCP tool always allowed")
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
		expect(chip).toHaveTextContent("YOLO: everything auto-runs")
		expect(screen.getByTestId("auto-run-risk")).toHaveTextContent("(risky)")
		expect(chip.getAttribute("aria-label")).toMatch(/YOLO mode is on: everything auto-runs, even when auto-run is off/)
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
		expect(screen.getByTestId("auto-run-chip")).toHaveTextContent(
			"2 MCP tools set to always allow (inactive while auto-run is off)",
		)
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

	it("uses truthiness for the master switch like core", () => {
		const s = withActions({ editFiles: true, editFilesExternally: true }, { enabled: undefined as unknown as boolean })
		expect(deriveAutoRunPolicy(s, []).risky).toBe(false)
	})
})

describe("ComposerStatus disclaimer and popover", () => {
	it("keeps the claim disclaimer visible in the footer (owner decision O2 is pending)", () => {
		render(<ComposerStatus />)
		expect(screen.getByText(CLAIM_DISCLAIMER)).toBeInTheDocument()
	})

	it("opens the settings popover from the chip with the disclaimer in its header", () => {
		render(<ComposerStatus />)
		const chip = screen.getByTestId("auto-run-chip")
		expect(chip).toHaveAttribute("aria-expanded", "false")
		fireEvent.click(chip)
		expect(chip).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByText("Tool auto-run settings")).toBeInTheDocument()
		expect(screen.getAllByText(CLAIM_DISCLAIMER)).toHaveLength(2)
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
