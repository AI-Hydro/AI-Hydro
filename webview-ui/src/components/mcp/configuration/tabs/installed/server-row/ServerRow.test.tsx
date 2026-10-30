import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ServerRow from "./ServerRow"

const toggleMcpServer = vi.fn(async () => ({ mcpServers: [] }))
const mocks = vi.hoisted(() => ({ delete: (async () => ({ mcpServers: [] })) as () => Promise<unknown> }))
vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: {
		toggleMcpServer: () => toggleMcpServer(),
		restartMcpServer: async () => ({ mcpServers: [] }),
		deleteMcpServer: () => mocks.delete(),
	},
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpMarketplaceCatalog: { items: [] },
		autoApprovalSettings: { enabled: true, actions: { useMcp: false } },
		setMcpServers: () => {},
	}),
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => {
	const passthrough =
		(tag: string) =>
		({ children, appearance: _a, ...rest }: any) => {
			const Tag = tag as any
			return <Tag {...rest}>{children}</Tag>
		}
	return {
		VSCodeButton: passthrough("button"),
		VSCodeCheckbox: passthrough("div"),
		VSCodeDropdown: passthrough("div"),
		VSCodeOption: passthrough("div"),
		VSCodePanels: passthrough("div"),
		VSCodePanelTab: passthrough("div"),
		VSCodePanelView: passthrough("div"),
	}
})

afterEach(() => {
	cleanup()
	toggleMcpServer.mockClear()
})

const server = (over: Record<string, unknown> = {}) =>
	({
		name: "ai-hydro",
		config: "{}",
		status: "connected",
		disabled: false,
		tools: [],
		resources: [],
		resourceTemplates: [],
		...over,
	}) as any

describe("ServerRow (N12)", () => {
	it("the name is a button that states whether the details are open, and opens them from the keyboard", () => {
		render(<ServerRow isExpandable server={server()} />)
		const expand = screen.getByRole("button", { name: "ai-hydro" })
		expect(expand).toHaveAttribute("aria-expanded", "false")
		expect(expand).not.toHaveAttribute("aria-controls")
		fireEvent.click(expand)
		expect(expand).toHaveAttribute("aria-expanded", "true")
		const controlled = expand.getAttribute("aria-controls")
		expect(controlled).toBeTruthy()
		expect(document.getElementById(controlled as string)).not.toBeNull()
		fireEvent.click(expand)
		expect(expand).toHaveAttribute("aria-expanded", "false")
	})

	it("a row that cannot expand has no expand button", () => {
		render(<ServerRow isExpandable={false} server={server()} />)
		expect(screen.queryByRole("button", { name: "ai-hydro" })).toBeNull()
		expect(screen.getByRole("switch", { name: "Enable ai-hydro" })).toBeInTheDocument()
	})

	it("the enable switch has a name, states its state, toggles on click, and is a button (Enter and Space work)", () => {
		render(<ServerRow isExpandable server={server()} />)
		const sw = screen.getByRole("switch", { name: "Enable ai-hydro" })
		expect(sw.tagName).toBe("BUTTON")
		expect(sw).toHaveAttribute("aria-checked", "true")
		fireEvent.click(sw)
		expect(toggleMcpServer).toHaveBeenCalledTimes(1)
	})

	it("a disabled server reads unchecked", () => {
		render(<ServerRow isExpandable server={server({ disabled: true })} />)
		expect(screen.getByRole("switch", { name: "Enable ai-hydro" })).toHaveAttribute("aria-checked", "false")
	})

	it("the switch is not green: green is reserved for approved claims", () => {
		const { container } = render(<ServerRow isExpandable server={server()} />)
		expect(container.innerHTML).not.toContain('testing-iconPassed")')
		const sw = screen.getByRole("switch")
		expect(sw.innerHTML).not.toContain("iconPassed")
	})

	it("the status dot says what it means", () => {
		render(<ServerRow isExpandable server={server({ status: "disconnected" })} />)
		expect(screen.getByRole("img", { name: "Disconnected" })).toBeInTheDocument()
	})

	it("Delete asks first, Cancel keeps the server, and only the confirm deletes", () => {
		const deleteMcpServer = vi.fn(async () => ({ mcpServers: [] }))
		mocks.delete = deleteMcpServer
		render(<ServerRow hasTrashIcon isExpandable server={server()} />)
		fireEvent.click(screen.getByRole("button", { name: "Delete ai-hydro" }))
		expect(deleteMcpServer).not.toHaveBeenCalled()
		const group = screen.getByRole("group", { name: "Confirm deleting ai-hydro" })
		expect(group).toHaveTextContent("Delete ai-hydro?")
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(screen.queryByRole("group", { name: "Confirm deleting ai-hydro" })).toBeNull()
		expect(deleteMcpServer).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Delete ai-hydro" }))
		fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" })
		expect(screen.queryByRole("group")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Delete ai-hydro" }))
		fireEvent.click(screen.getByRole("button", { name: "Delete" }))
		expect(deleteMcpServer).toHaveBeenCalledTimes(1)
	})

	it("restart is named for its server", () => {
		render(<ServerRow isExpandable server={server()} />)
		expect(screen.getByRole("button", { name: "Restart ai-hydro" })).toBeInTheDocument()
	})
})
