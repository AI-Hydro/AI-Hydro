import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import AutoApproveBar from "../AutoApproveBar"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: {
			version: 1,
			enabled: true,
			actions: { readFiles: true },
			favorites: [],
			enableNotifications: false,
			maxRequests: 20,
		},
	}),
}))
vi.mock("@/hooks/useAutoApproveActions", () => ({
	useAutoApproveActions: () => ({ isChecked: () => false, isFavorited: () => false, updateAction: () => {} }),
}))
vi.mock("../AutoApproveModal", () => ({ default: () => null }))

afterEach(cleanup)

describe("AutoApproveBar", () => {
	it("is labelled Tool auto-run and states that it never covers claim approval", () => {
		render(<AutoApproveBar />)
		expect(screen.getByText("Tool auto-run")).toBeInTheDocument()
		expect(
			screen.getByText("Never covers claim approval. Claim approval is signed outside the agent (aihydro-approve)."),
		).toBeInTheDocument()
		expect(screen.queryByText(/^Auto-approve$/i)).toBeNull()
	})

	it("exposes the expand control as a named, expandable button", () => {
		render(<AutoApproveBar />)
		const toggle = screen.getByRole("button", { name: "Show tool auto-run options" })
		expect(toggle).toHaveAttribute("aria-expanded", "false")
	})
})
