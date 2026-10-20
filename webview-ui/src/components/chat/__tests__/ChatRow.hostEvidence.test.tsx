import type { AiHydroMessage } from "@shared/ExtensionMessage"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		mcpMarketplaceCatalog: { items: [] },
		onRelinquishControl: () => () => {},
		vscodeTerminalExecutionMode: "vscodeTerminal",
		aihydroMessages: [],
		autoApprovalSettings: { enabled: false, actions: {} },
	}),
}))
vi.mock("@/context/HtmlPreviewContext", () => ({ useHtmlPreviewContext: () => ({ items: [] }) }))
vi.mock("@/services/grpc-client", () => ({ FileServiceClient: {}, TaskServiceClient: {}, UiServiceClient: {} }))
vi.mock("../../../context/LedgerContext", () => ({ useLedgerContext: () => ({ getClaim: () => undefined }) }))

function renderRow(message: AiHydroMessage) {
	return render(
		<ChatRowContent
			isExpanded={false}
			isLast={false}
			lastModifiedMessage={message}
			message={message}
			onSetQuote={() => {}}
			onToggleExpand={() => {}}
		/>,
	)
}

describe("host evidence renders without regressing (W2-0h)", () => {
	it("an old task's plain-string info still renders as one muted line, with no severity", () => {
		const { container } = renderRow({ ts: 1, type: "say", say: "info", text: "malformed tool call; retried" })
		const notice = container.querySelector('[data-testid="muted-notice"]')
		expect(notice?.textContent).toContain("malformed tool call; retried")
		expect(notice?.hasAttribute("data-severity")).toBe(false)
		expect(container.querySelector(".codicon-warning")).toBeNull()
	})

	it("a structured warning notice keeps its text and takes the warning icon", () => {
		const { container } = renderRow({
			ts: 2,
			type: "say",
			say: "info",
			text: "Context window exceeded: dropped 4 earlier messages from the model's context (6 of 10 kept) and retried.",
			infoNotice: { class: "context_truncated", severity: "warning", detail: { newlyDropped: 4 } },
		})
		const notice = container.querySelector('[data-testid="muted-notice"]')
		expect(notice?.textContent).toContain("dropped 4 earlier messages")
		expect(notice?.getAttribute("data-severity")).toBe("warning")
		expect(container.querySelector(".codicon-warning")).not.toBeNull()
	})

	it("MCP notifications: warning and above use the warning colour; old rows and info keep the default", () => {
		const bell = (m: Partial<AiHydroMessage>) =>
			renderRow({ ts: 3, type: "say", say: "mcp_notification", text: "[s] hello", ...m }).container.querySelector(
				".chat-row-mcp-notification-icon",
			) as HTMLElement
		expect(bell({ mcpLevel: "warning" }).style.color).toContain("editorWarning")
		expect(bell({ mcpLevel: "error" }).style.color).toContain("editorWarning")
		expect(bell({ mcpLevel: "info" }).style.color).toBe("")
		expect(bell({}).style.color).toBe("")
	})
})
