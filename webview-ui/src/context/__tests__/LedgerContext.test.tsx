import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LedgerContextProvider, useLedgerContext } from "../LedgerContext"

const mocks = vi.hoisted(() => ({ load: vi.fn(), subscribe: vi.fn() }))
vi.mock("@/services/grpc-client", () => ({
	LedgerServiceClient: {
		getLedgerState: mocks.load,
		subscribeToClaimUpdates: mocks.subscribe,
	},
}))
afterEach(() => {
	cleanup()
	vi.resetAllMocks()
})

function Inspector() {
	const ledger = useLedgerContext()
	return (
		<div>
			<button onClick={() => void ledger.loadSession("new-study")}>Switch</button>
			<span data-testid="session">{ledger.sessionId}</span>
			<span data-testid="claims">{Object.keys(ledger.claims).join(",")}</span>
			<span>{ledger.error}</span>
		</div>
	)
}

describe("Ledger session isolation", () => {
	it("keeps a slow old snapshot from overwriting the newly selected study", async () => {
		let resolveOld!: (value: unknown) => void
		mocks.load
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOld = resolve
					}),
			)
			.mockResolvedValueOnce({ sessionId: "new-study", claims: [{ claimId: "new", sessionId: "new-study" }] })
		mocks.subscribe.mockReturnValue(() => {})
		render(
			<LedgerContextProvider>
				<Inspector />
			</LedgerContextProvider>,
		)
		fireEvent.click(screen.getByText("Switch"))
		await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("new-study"))
		await act(async () => resolveOld({ sessionId: "old-study", claims: [{ claimId: "old" }] }))
		expect(screen.getByTestId("session")).toHaveTextContent("new-study")
		expect(screen.getByTestId("claims")).toHaveTextContent("new")
		expect(screen.getByTestId("claims")).not.toHaveTextContent("old")
	})

	it("does not merge claim events from another study", async () => {
		let onResponse!: (event: unknown) => void
		mocks.load.mockResolvedValue({ sessionId: "selected", claims: [{ claimId: "kept", sessionId: "selected" }] })
		mocks.subscribe.mockImplementation((_request, handlers) => {
			onResponse = handlers.onResponse
			return () => {}
		})
		render(
			<LedgerContextProvider>
				<Inspector />
			</LedgerContextProvider>,
		)
		await waitFor(() => expect(screen.getByTestId("claims")).toHaveTextContent("kept"))
		act(() => onResponse({ changeType: "added", claim: { claimId: "foreign", sessionId: "other" } }))
		expect(screen.getByTestId("claims")).not.toHaveTextContent("foreign")
		act(() => onResponse({ changeType: "added", claim: { claimId: "local", sessionId: "selected" } }))
		expect(screen.getByTestId("claims")).toHaveTextContent("local")
	})

	it("shows backend errors instead of treating an unreadable store as empty", async () => {
		mocks.load.mockRejectedValue(new Error("RUN_LOG_UNREADABLE"))
		mocks.subscribe.mockReturnValue(() => {})
		render(
			<LedgerContextProvider>
				<Inspector />
			</LedgerContextProvider>,
		)
		expect(await screen.findByText("RUN_LOG_UNREADABLE")).toBeInTheDocument()
	})
})
