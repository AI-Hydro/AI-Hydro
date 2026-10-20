import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContextWindowSummary } from "../ContextWindowSummary"

// The owner's DeepSeek task (docs/vision-2040/findings/audit-agent-harness-2026-10-19.md section 5A.1), cumulative.
const OWNER = { tokensIn: 67_347, cacheReads: 255_488, cacheWrites: 0, tokensOut: 2_690, totalCost: 0.1107 }

describe("ContextWindowSummary", () => {
	it("headline separates per-request context from the cumulative task total", () => {
		render(<ContextWindowSummary {...OWNER} contextWindow={1_000_000} percentage={6.7} tokenUsed={67_278} />)
		expect(screen.getByTestId("usage-headline").textContent).toBe(
			"Context now: 67k of 1.0M · This task: 325k tokens (79% cached) · $0.11",
		)
	})

	it("labels misses as uncached input and never as cache writes when there are none", () => {
		const { container } = render(
			<ContextWindowSummary {...OWNER} contextWindow={1_000_000} percentage={6.7} tokenUsed={67_278} />,
		)
		fireEvent.click(screen.getByText("This task"))
		expect(container.textContent).toContain("Uncached input")
		expect(container.textContent).toContain("Cache reads (hits)")
		expect(container.textContent).not.toContain("Cache writes")
	})

	it("shows cache writes for providers that bill them", () => {
		const { container } = render(
			<ContextWindowSummary
				cacheReads={40_000}
				cacheWrites={8_000}
				contextWindow={1_000_000}
				percentage={5}
				tokenUsed={48_512}
				tokensIn={12}
				tokensOut={500}
			/>,
		)
		fireEvent.click(screen.getByText("This task"))
		expect(container.textContent).toContain("Cache writes")
	})
})
