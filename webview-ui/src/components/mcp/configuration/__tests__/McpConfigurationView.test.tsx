import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import McpConfigurationView from "../McpConfigurationView"

const state = vi.hoisted(() => ({ mcpMarketplaceEnabled: true }))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpMarketplaceEnabled: state.mcpMarketplaceEnabled,
		setMcpServers: () => {},
		setMcpMarketplaceCatalog: () => {},
		environment: "production",
	}),
}))
vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: {
		refreshMcpMarketplace: async () => ({ items: [] }),
		getLatestMcpServers: async () => ({ mcpServers: [] }),
	},
}))
vi.mock("../tabs/installed/ConfigureServersView", () => ({ default: () => <div>installed content</div> }))
vi.mock("../tabs/marketplace/McpMarketplaceView", () => ({ default: () => <div>marketplace content</div> }))
vi.mock("../tabs/add-server/AddRemoteServerForm", () => ({ default: () => <div>remote content</div> }))

afterEach(cleanup)

describe("McpConfigurationView (N12)", () => {
	it("opens on Installed, first in a named tab list, and the tabs follow the arrow keys", () => {
		state.mcpMarketplaceEnabled = true
		render(<McpConfigurationView onDone={() => {}} />)
		const tabs = screen.getAllByRole("tab")
		expect(tabs.map((t) => t.textContent)).toEqual(["Installed", "Marketplace", "Remote servers"])
		expect(tabs[0]).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tablist")).toHaveAccessibleName("Hydro tools and data sources sections")
		expect(screen.getByRole("tabpanel")).toHaveTextContent("installed content")
		tabs[0].focus()
		fireEvent.keyDown(tabs[0], { key: "ArrowRight" })
		expect(screen.getByRole("tabpanel")).toHaveTextContent("marketplace content")
		fireEvent.keyDown(screen.getAllByRole("tab")[1], { key: "End" })
		expect(screen.getByRole("tabpanel")).toHaveTextContent("remote content")
	})

	it("without the marketplace there is no Marketplace tab", () => {
		state.mcpMarketplaceEnabled = false
		render(<McpConfigurationView onDone={() => {}} />)
		expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Installed", "Remote servers"])
	})

	it("an explicit initial tab is honoured, and the surface has one name", () => {
		state.mcpMarketplaceEnabled = true
		render(<McpConfigurationView initialTab="addRemote" onDone={() => {}} />)
		expect(screen.getByRole("tab", { name: "Remote servers" })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("heading", { level: 1, name: "Hydro Tools & Data Sources" })).toBeInTheDocument()
	})
})
