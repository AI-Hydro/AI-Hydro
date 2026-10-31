import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import SkillsView from "./SkillsView"

// A host that answers with an empty message (no `items`): the proto default.
vi.mock("@/services/grpc-client", () => ({
	SkillsServiceClient: { listInstalledSkills: async () => ({}), refreshSkillsMarketplace: async () => ({}) },
}))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ environment: "production" }) }))

afterEach(cleanup)

describe("SkillsView with an empty host reply", () => {
	it("shows zero skills instead of crashing", async () => {
		render(<SkillsView onDone={() => {}} />)
		await waitFor(() => expect(screen.getByText("0 skills installed")).toBeInTheDocument())
	})
})
