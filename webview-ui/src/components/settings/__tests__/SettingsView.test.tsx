import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import SettingsView from "../SettingsView"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ version: "fixture", environment: "production" }),
}))
vi.mock("@/services/grpc-client", () => ({ StateServiceClient: { resetState: async () => ({}) } }))
vi.mock("../SectionHeader", () => ({ default: ({ children }: any) => <div>{children}</div> }))
// The sections are their own subjects; the view's job is the section list and the header.
vi.mock("../sections/AboutSection", () => ({ default: () => <div data-testid="section">AboutSection</div> }))
vi.mock("../sections/ApiConfigurationSection", () => ({
	default: () => <div data-testid="section">ApiConfigurationSection</div>,
}))
vi.mock("../sections/BrowserSettingsSection", () => ({ default: () => <div data-testid="section">BrowserSettingsSection</div> }))
vi.mock("../sections/DebugSection", () => ({ default: () => <div data-testid="section">DebugSection</div> }))
vi.mock("../sections/FeatureSettingsSection", () => ({ default: () => <div data-testid="section">FeatureSettingsSection</div> }))
vi.mock("../sections/GeneralSettingsSection", () => ({ default: () => <div data-testid="section">GeneralSettingsSection</div> }))
vi.mock("../sections/TerminalSettingsSection", () => ({
	default: () => <div data-testid="section">TerminalSettingsSection</div>,
}))

beforeAll(() => {
	;(globalThis as any).ResizeObserver = class {
		observe() {}
		disconnect() {}
	}
})
afterEach(cleanup)

const mount = (onDone = vi.fn(), targetSection?: string) => {
	render(<SettingsView onDone={onDone} targetSection={targetSection} />)
	return onDone
}

describe("SettingsView navigation (N3)", () => {
	it("the section list is a named tablist; each tab has a name even though the narrow layout draws only icons", () => {
		mount()
		const list = screen.getByRole("tablist", { name: "Settings sections" })
		expect(list).toHaveAttribute("aria-orientation", "vertical")
		const tabs = screen.getAllByRole("tab")
		expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
			"API Configuration",
			"Features",
			"Browser",
			"Terminal",
			"General",
			"About",
		])
		for (const tab of tabs) {
			expect(tab).toHaveAttribute("title")
			expect(tab).toHaveTextContent("")
		}
		expect(screen.getByRole("tabpanel")).toBeInTheDocument()
	})

	it("only the selected section is a tab stop, and the arrow keys walk the list, selecting as they go", () => {
		mount()
		const tabs = () => screen.getAllByRole("tab")
		expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
		tabs()[0].focus()
		fireEvent.keyDown(tabs()[0], { key: "ArrowDown" })
		expect(tabs()[1]).toHaveAttribute("aria-selected", "true")
		expect(document.activeElement).toBe(tabs()[1])
		fireEvent.keyDown(tabs()[1], { key: "End" })
		expect(tabs()[5]).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tabpanel")).toHaveAccessibleName("About")
		fireEvent.keyDown(tabs()[5], { key: "ArrowDown" })
		expect(tabs()[0]).toHaveAttribute("aria-selected", "true")
		fireEvent.keyDown(tabs()[0], { key: "ArrowUp" })
		expect(tabs()[5]).toHaveAttribute("aria-selected", "true")
	})

	it("opens on the requested section", () => {
		mount(vi.fn(), "terminal")
		expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true")
	})

	it("no tab removes its focus outline", () => {
		mount()
		for (const tab of screen.getAllByRole("tab")) {
			expect(tab.className).not.toContain("outline-none")
		}
	})

	it("Done and Escape both leave Settings", () => {
		const onDone = mount()
		fireEvent.click(screen.getByRole("button", { name: "Done" }))
		expect(onDone).toHaveBeenCalledTimes(1)
		fireEvent.keyDown(document.body, { key: "Escape" })
		expect(onDone).toHaveBeenCalledTimes(2)
		expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument()
	})
})
