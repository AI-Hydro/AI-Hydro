import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "../ExtensionStateContext"

const host = vi.hoisted(() => ({ stateHandlers: undefined as any }))

vi.mock("@/services/grpc-client", async () => {
	const make = () =>
		new Proxy(
			{},
			{
				get: (_t, name: string) =>
					name.startsWith("subscribe")
						? (_req: unknown, handlers: unknown) => {
								if (name === "subscribeToState") host.stateHandlers = handlers
								return () => {}
							}
						: async () => ({}),
			},
		)
	return { McpServiceClient: make(), ModelsServiceClient: make(), StateServiceClient: make(), UiServiceClient: make() }
})

function View() {
	const { didHydrateState, showWelcome } = useExtensionState()
	return (
		<>
			<span data-testid="hydrated">{String(didHydrateState)}</span>
			<span data-testid="welcome">{String(showWelcome)}</span>
		</>
	)
}

const mount = () =>
	render(
		<ExtensionStateContextProvider>
			<View />
		</ExtensionStateContextProvider>,
	)
const stateJson = (welcomeViewCompleted: boolean) =>
	JSON.stringify({
		welcomeViewCompleted,
		aihydroMessages: [],
		taskHistory: [],
		autoApprovalSettings: { version: 1, actions: {}, enabled: false },
	})

beforeEach(() => {
	vi.useFakeTimers()
	host.stateHandlers = undefined
})
afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

describe("ExtensionStateContext hydration fallback", () => {
	it("keeps the first-run welcome view when state arrives before the fallback, even after the fallback delay", async () => {
		mount()
		await act(async () => {
			vi.advanceTimersByTime(100)
			host.stateHandlers.onResponse({ stateJson: stateJson(false) })
		})
		expect(screen.getByTestId("welcome").textContent).toBe("true")
		await act(async () => {
			vi.advanceTimersByTime(5000)
		})
		expect(screen.getByTestId("hydrated").textContent).toBe("true")
		expect(screen.getByTestId("welcome").textContent).toBe("true")
	})

	it("falls back to the chat view after 2s when no state ever arrives", async () => {
		mount()
		expect(screen.getByTestId("hydrated").textContent).toBe("false")
		await act(async () => {
			vi.advanceTimersByTime(1999)
		})
		expect(screen.getByTestId("hydrated").textContent).toBe("false")
		await act(async () => {
			vi.advanceTimersByTime(2)
		})
		expect(screen.getByTestId("hydrated").textContent).toBe("true")
		expect(screen.getByTestId("welcome").textContent).toBe("false")
	})

	it("does not let the fallback override a state error that already hydrated the view", async () => {
		mount()
		await act(async () => {
			host.stateHandlers.onError(new Error("subscription failed"))
		})
		expect(screen.getByTestId("hydrated").textContent).toBe("true")
		await act(async () => {
			vi.advanceTimersByTime(5000)
		})
		expect(screen.getByTestId("hydrated").textContent).toBe("true")
		expect(screen.getByTestId("welcome").textContent).toBe("false")
	})
})

describe("navigateToChat", () => {
	function Nav() {
		const { showSkills, navigateToSkills, navigateToChat } = useExtensionState()
		return (
			<>
				<span data-testid="skills">{String(showSkills)}</span>
				<button onClick={navigateToSkills} type="button">
					skills
				</button>
				<button onClick={navigateToChat} type="button">
					chat
				</button>
			</>
		)
	}

	it("closes the Skills view (the focus-pending-prompt command relies on it to reach the chat)", async () => {
		render(
			<ExtensionStateContextProvider>
				<Nav />
			</ExtensionStateContextProvider>,
		)
		await act(async () => {
			screen.getByText("skills").click()
		})
		expect(screen.getByTestId("skills").textContent).toBe("true")
		await act(async () => {
			screen.getByText("chat").click()
		})
		expect(screen.getByTestId("skills").textContent).toBe("false")
	})
})
