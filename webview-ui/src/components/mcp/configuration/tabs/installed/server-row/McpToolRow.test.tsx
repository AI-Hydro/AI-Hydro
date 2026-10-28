import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// A plain function (not vi.fn): vitest's call tracking would flag the rejected promise as unhandled.
let toggleImpl: () => Promise<unknown> = () => Promise.resolve({ mcpServers: [] })
vi.mock("@/services/grpc-client", () => ({ McpServiceClient: { toggleToolAutoApprove: () => toggleImpl() } }))
const setMcpServers = vi.fn()
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: { enabled: true, actions: { useMcp: true } },
		setMcpServers,
	}),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, disabled, onChange, title, children, ...rest }: any) => (
		<label title={title}>
			<input
				aria-describedby={rest["aria-describedby"]}
				checked={!!checked}
				disabled={disabled}
				onChange={onChange}
				type="checkbox"
			/>
			{children}
		</label>
	),
}))

import { formatAutoApproveRefusal } from "@shared/aihydro/alwaysAllowPolicy"
import McpToolRow from "./McpToolRow"

const READ = { name: "read_tool", annotations: { readOnlyHint: true, openWorldHint: false } }
const NUKE = { name: "nuke_tool", annotations: { destructiveHint: true } }
const BARE = { name: "bare_tool" }

const checkbox = (container: HTMLElement) => container.querySelector("input") as HTMLInputElement

describe("McpToolRow Always eligibility (W2-E1)", () => {
	beforeEach(() => {
		toggleImpl = () => Promise.resolve({ mcpServers: [] })
	})

	it("disables the add for an untrusted server and the reason names the trust requirement", () => {
		const { container } = render(<McpToolRow serverName="s" serverTools={[READ]} serverTrusted={false} tool={READ} />)
		expect(checkbox(container).disabled).toBe(true)
		expect(screen.getByTestId("auto-run-blocked-reason").textContent).toMatch(/not the registered first-party server/)
	})

	it("disables destructive and undeclared tools on a trusted server, but not read tools", () => {
		for (const [tool, blocked] of [
			[NUKE, true],
			[BARE, true],
			[READ, false],
		] as const) {
			const { container, unmount } = render(
				<McpToolRow serverName="s" serverTools={[READ, NUKE, BARE]} serverTrusted={true} tool={tool} />,
			)
			expect(checkbox(container).disabled, tool.name).toBe(blocked)
			unmount()
		}
	})

	it("never disables unchecking an existing grant", () => {
		const granted = { ...NUKE, autoApprove: true }
		const { container } = render(<McpToolRow serverName="s" serverTools={[granted]} serverTrusted={false} tool={granted} />)
		expect(checkbox(container).disabled).toBe(false)
	})

	it("shows a host refusal inline instead of only logging it", async () => {
		toggleImpl = () =>
			Promise.reject(
				new Error(formatAutoApproveRefusal({ server: "s", refused: [{ tool: "read_tool", reason: "destructive" }] })),
			)
		const { container } = render(<McpToolRow serverName="s" serverTools={[READ]} serverTrusted={true} tool={READ} />)
		fireEvent.click(checkbox(container))
		await waitFor(() => expect(screen.getByTestId("auto-run-refusal").textContent).toMatch(/Nothing was changed/))
	})
})

describe("McpToolRow blocked-reason association (N4)", () => {
	it("links the checkbox to the visible reason text with aria-describedby", () => {
		const { container } = render(<McpToolRow serverName="s" serverTools={[READ]} serverTrusted={false} tool={READ} />)
		const input = container.querySelector("input") as HTMLInputElement
		const reason = screen.getByTestId("auto-run-blocked-reason")
		expect(reason.id).toBeTruthy()
		expect(input.getAttribute("aria-describedby")).toBe(reason.id)
	})
})
