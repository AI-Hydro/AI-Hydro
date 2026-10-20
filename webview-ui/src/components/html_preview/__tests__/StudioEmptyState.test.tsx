import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { HtmlPreviewPanel } from "../HtmlPreviewPanel"

vi.mock("../../../context/HtmlPreviewContext", () => ({
	useHtmlPreviewContext: () => ({
		items: [],
		activeItemId: null,
		setActiveItemId: vi.fn(),
		removeItem: vi.fn(),
		clearAllItems: vi.fn(),
		addItemFromContent: vi.fn(),
		loadWorkspaceFile: vi.fn(),
		manifestsById: {},
	}),
	HtmlPreviewContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock("../../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ workspaceHtmlFiles: [] }),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock("../marketplace/ModulesMarketplaceView", () => ({ default: () => <div>marketplace-stub</div> }))

describe("Studio empty state and sidebar honesty", () => {
	it("offers real starting points instead of HTML-file instructions", () => {
		render(<HtmlPreviewPanel />)
		const empty = screen.getByTestId("studio-empty-state")
		expect(empty).toHaveTextContent("AI-Hydro Studio")
		expect(empty).toHaveTextContent("Browse courses")
		expect(empty).toHaveTextContent("Add a document")
		expect(empty).toHaveTextContent("Install Learning Pack")
		expect(empty).toHaveTextContent("ask the AI-Hydro agent")
		expect(empty.textContent).not.toMatch(/How to add files|HTML [Pp]review|preview_html/)
	})

	it("Browse courses opens the catalogue", () => {
		render(<HtmlPreviewPanel />)
		fireEvent.click(screen.getByText("Browse courses"))
		expect(screen.getByText("marketplace-stub")).toBeInTheDocument()
	})

	it("has no static Skills section and names the comments queue for what it is", () => {
		render(<HtmlPreviewPanel />)
		expect(screen.queryByText("Skills")).not.toBeInTheDocument()
		expect(screen.queryByText("Comments")).not.toBeInTheDocument()
		expect(screen.getByText("Requests to agent")).toBeInTheDocument()
	})
})
