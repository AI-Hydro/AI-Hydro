import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { StarterInvestigations } from "../StarterInvestigations"
import { starterInvestigations } from "../starterPrompts"

const mock = vi.hoisted(() => ({ newTask: vi.fn(async () => ({})) }))
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { newTask: mock.newTask } }))

afterEach(() => {
	cleanup()
	mock.newTask.mockClear()
})

describe("starter investigations", () => {
	it("offers three hydrology starters with unique ids", () => {
		expect(starterInvestigations).toHaveLength(3)
		expect(new Set(starterInvestigations.map((s) => s.id)).size).toBe(3)
	})

	it("prompts ask for a procedure and promise or encode no outcome", () => {
		for (const s of starterInvestigations) {
			expect(s.prompt, `${s.id} must not contain numbers`).not.toMatch(/\d/)
			expect(s.prompt, `${s.id} must not promise results`).not.toMatch(
				/\b(will (show|find|prove|confirm)|expect(ed)?|should be|is (high|low|good|bad)|improv|best)/i,
			)
			expect(s.prompt, `${s.id} must tell the agent to stop and ask on ambiguity`).toMatch(/stop and ask/i)
		}
	})

	it("every starter says what it fetches and that the network is needed", () => {
		for (const s of starterInvestigations) {
			expect(s.fetches.length).toBeGreaterThan(20)
			expect(s.needsNetwork).toBe(true)
		}
		render(<StarterInvestigations />)
		const cards = screen.getAllByRole("article")
		expect(cards).toHaveLength(3)
		for (const card of cards) {
			expect(within(card).getByText("Fetches")).toBeInTheDocument()
			expect(within(card).getByText("Network needed")).toBeInTheDocument()
		}
	})

	it("starts a task with exactly the starter's prompt via a real button", () => {
		render(<StarterInvestigations />)
		const first = starterInvestigations[0]
		fireEvent.click(screen.getByRole("button", { name: `Start: ${first.title}` }))
		expect(mock.newTask).toHaveBeenCalledOnce()
		expect((mock.newTask.mock.calls[0] as any[])[0].text).toBe(first.prompt)
	})
})
