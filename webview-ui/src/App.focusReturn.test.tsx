import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ctx = vi.hoisted(() => ({
	state: {} as Record<string, unknown>,
	focusEvents: 0,
}))

vi.mock("./context/ExtensionStateContext", () => ({ useExtensionState: () => ctx.state }))
vi.mock("./Providers", () => ({ Providers: ({ children }: any) => <>{children}</> }))
vi.mock("./services/grpc-client", () => ({
	UiServiceClient: { setSidebarView: async () => ({}), onDidShowAnnouncement: async () => ({ value: false }) },
}))
// The chat: when it is showing and a "Focus pending prompt" arrived, the approval group takes the focus.
vi.mock("./components/chat/ChatView", () => ({
	default: ({ isHidden }: { isHidden: boolean }) => (
		<button
			data-testid="approval"
			ref={(el) => (!isHidden && (window as any).__pending ? el?.focus() : undefined)}
			type="button">
			approval
		</button>
	),
}))
vi.mock("./components/connectors/ConnectorsView", () => ({ default: () => <div /> }))
vi.mock("./components/history/HistoryView", () => ({ default: () => <div /> }))
vi.mock("./components/html_preview/HtmlPreviewPanel", () => ({ default: () => <div /> }))
vi.mock("./components/mcp/configuration/McpConfigurationView", () => ({ default: () => <div /> }))
vi.mock("./components/settings/SettingsView", () => ({ default: () => <div /> }))
vi.mock("./components/skills/SkillsView", () => ({ default: () => <div /> }))
vi.mock("./components/welcome/WelcomeView", () => ({ default: () => <div /> }))

import App from "./App"

const base = {
	didHydrateState: true,
	showWelcome: false,
	shouldShowAnnouncement: false,
	showMcp: false,
	showSettings: false,
	showHistory: false,
	showMap: false,
	showConnectors: false,
	showSkills: false,
	showAnnouncement: false,
	setShowAnnouncement: () => {},
	setShouldShowAnnouncement: () => {},
	closeMcpView: () => {},
	navigateToHistory: () => {},
	hideSettings: () => {},
	hideHistory: () => {},
	hideMap: () => {},
	hideConnectors: () => {},
	hideSkills: () => {},
	hideAnnouncement: () => {},
	aihydroMessages: [] as any[],
}

const raf = async () => {
	await act(async () => {
		await new Promise((r) => setTimeout(r, 30))
	})
}

describe("returning from a sub-view to the chat (Nav-3)", () => {
	beforeEach(() => {
		ctx.focusEvents = 0
		;(window as any).__pending = false
		window.addEventListener("focusChatInput", () => ctx.focusEvents++)
	})
	afterEach(() => {
		cleanup()
		document.body.innerHTML = ""
	})

	it("focuses the composer when an idle chat comes back", async () => {
		ctx.state = { ...base, showHistory: true }
		const { rerender } = render(<App />)
		await raf()
		ctx.state = { ...base }
		rerender(<App />)
		await raf()
		expect(ctx.focusEvents).toBe(1)
	})

	it("does not while a run is in progress: Escape in the composer would stop it", async () => {
		const running = [{ say: "task" }, { say: "api_req_started" }]
		ctx.state = { ...base, showSettings: true, aihydroMessages: running }
		const { rerender } = render(<App />)
		await raf()
		ctx.state = { ...base, aihydroMessages: running }
		rerender(<App />)
		await raf()
		expect(ctx.focusEvents).toBe(0)
	})

	it("does not steal the focus the Focus pending prompt command has just placed from a sub-view", async () => {
		const asking = [{ say: "task" }, { ask: "completion_result" }]
		ctx.state = { ...base, showHistory: true, aihydroMessages: asking }
		const { rerender } = render(<App />)
		await raf()
		;(window as any).__pending = true
		ctx.state = { ...base, aihydroMessages: asking }
		rerender(<App />)
		await raf()
		expect(document.activeElement).toBe(document.querySelector("[data-testid=approval]"))
		expect(ctx.focusEvents).toBe(0)
	})
})
