import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import ToolsStatusChip, { ToolsStatusRow } from "../ToolsStatusChip"
import { fromProto } from "../useToolsEnvStatus"

const mock = vi.hoisted(() => ({
	run: vi.fn(async () => ({})),
	emit: undefined as undefined | ((p: Record<string, unknown>) => void),
}))
vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: {
		runToolsEnvAction: mock.run,
		subscribeToToolsEnvStatus: (_req: unknown, handlers: { onResponse: (p: Record<string, unknown>) => void }) => {
			mock.emit = handlers.onResponse
			return () => {}
		},
	},
}))

afterEach(() => {
	cleanup()
	mock.run.mockClear()
	mock.emit = undefined
})

const row = (p: Record<string, unknown>) => render(<ToolsStatusRow status={fromProto(p)} />)

describe("tools status chip", () => {
	it("ready and trusted: shows version, healthy and trusted", () => {
		row({ phase: "ready", healthy: true, version: "2.8.2", trust: "trusted" })
		expect(screen.getByText("Tools 2.8.2 · healthy · trusted")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Show log" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Repair" })).toBeNull()
	})

	it("installing: can be cancelled", () => {
		row({ phase: "installing", message: "Installing AI-Hydro tools" })
		expect(screen.getByText("Tools · installing")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(mock.run).toHaveBeenCalledWith(expect.objectContaining({ action: "cancel" }))
	})

	it("unhealthy: offers Repair and the failure reason", () => {
		row({ phase: "unhealthy", version: "2.8.1", message: "handshake failed" })
		expect(screen.getByText("Tools 2.8.1 · unhealthy · not registered")).toBeInTheDocument()
		expect(screen.getByText("handshake failed")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Repair" }))
		expect(mock.run).toHaveBeenCalledWith(expect.objectContaining({ action: "repair" }))
	})

	it("failed install stays visible with Retry", () => {
		row({ phase: "failed", message: "No Python 3.10 or newer was found.", errorCode: "NO_PYTHON" })
		expect(screen.getByText("No Python 3.10 or newer was found.")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Retry" }))
		expect(mock.run).toHaveBeenCalledWith(expect.objectContaining({ action: "retry" }))
	})

	it("untrusted: says so and asks the host to show the trust confirmation (the webview cannot trust by itself)", () => {
		row({ phase: "ready", healthy: true, version: "2.8.2", trust: "untrusted" })
		expect(screen.getByText("Tools 2.8.2 · healthy · not trusted")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Trust this launcher" }))
		expect(mock.run).toHaveBeenCalledWith(expect.objectContaining({ action: "trust" }))
	})

	it("renders nothing until the host reports, then follows the stream", async () => {
		const { container } = render(<ToolsStatusChip />)
		expect(container.firstChild).toBeNull()
		const { act } = await import("@testing-library/react")
		act(() => mock.emit?.({ phase: "missing" }))
		expect(screen.getByText("Tools · not installed")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument()
	})

	it("falls back to 'checking' for an unknown phase instead of crashing", () => {
		expect(fromProto({ phase: "from-the-future" }).phase).toBe("checking")
	})
})
