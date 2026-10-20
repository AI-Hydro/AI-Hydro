import type { LearningModuleItem } from "@shared/proto/cline/html_preview"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import LearningModuleCard from "../marketplace/LearningModuleCard"
import ModulesMarketplaceView from "../marketplace/ModulesMarketplaceView"
import {
	LICENSE_NOT_DECLARED_LABEL,
	licenseLabel,
	provenanceLine,
	UNSIGNED_CATALOGUE_LABEL,
} from "../marketplace/provenanceLabels"

const rpc = vi.hoisted(() => ({ modules: vi.fn(), courses: vi.fn() }))
vi.mock("@/services/grpc-client", () => ({
	HtmlPreviewServiceClient: {
		refreshModulesMarketplace: rpc.modules,
		refreshCoursesMarketplace: rpc.courses,
		installModule: vi.fn(),
		installCourse: vi.fn(),
		starModule: vi.fn(),
	},
	MarketplaceServiceClient: {},
}))

describe("catalogue error state", () => {
	beforeEach(() => {
		rpc.modules.mockReset()
		rpc.courses.mockReset()
	})

	it("shows the error with Retry (not an empty list) when the fetch fails", async () => {
		rpc.modules.mockRejectedValue(new Error("Could not load the modules catalogue. Check your connection and retry."))
		rpc.courses.mockRejectedValue(new Error("Could not load the courses catalogue. Check your connection and retry."))
		render(<ModulesMarketplaceView />)
		await waitFor(() => expect(screen.getByText(/Could not load the modules catalogue/)).toBeInTheDocument())
		expect(screen.getByText("Retry")).toBeInTheDocument()
		expect(screen.queryByText(/No courses found/)).not.toBeInTheDocument()
	})

	it("retry refetches and renders the catalogue once the network is back", async () => {
		rpc.modules.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [] })
		rpc.courses.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [] })
		render(<ModulesMarketplaceView />)
		await waitFor(() => expect(screen.getByText("Retry")).toBeInTheDocument())
		fireEvent.click(screen.getByText("Retry"))
		await waitFor(() => expect(screen.getByText(/No courses found/)).toBeInTheDocument())
		expect(rpc.modules).toHaveBeenCalledTimes(2)
	})
})

describe("licence and integrity labels", () => {
	it("never invents a licence", () => {
		expect(licenseLabel("")).toBe(LICENSE_NOT_DECLARED_LABEL)
		expect(licenseLabel("   ")).toBe(LICENSE_NOT_DECLARED_LABEL)
		expect(licenseLabel(undefined)).toBe("License not declared")
		expect(licenseLabel("MIT")).toBe("MIT")
	})

	it("combines licence with the unsigned state", () => {
		expect(provenanceLine("")).toBe(`License not declared · ${UNSIGNED_CATALOGUE_LABEL}`)
		expect(provenanceLine("CC-BY-4.0")).toBe("CC-BY-4.0 · Unsigned catalogue module")
	})

	const item = (license: string) =>
		({
			moduleId: "m1",
			title: "Reading a Hydrograph",
			description: "",
			version: "0.1.0",
			author: "A",
			license,
			level: "intro",
			tags: [],
			estimatedMinutes: 10,
		}) as unknown as LearningModuleItem

	it("a module card shows 'License not declared' when none was declared", () => {
		render(<LearningModuleCard item={item("")} setError={vi.fn()} />)
		expect(screen.getByTestId("module-provenance")).toHaveTextContent("License not declared · Unsigned catalogue module")
		expect(screen.queryByText(/CC-BY-4.0/)).not.toBeInTheDocument()
	})

	it("a module card shows the declared licence", () => {
		render(<LearningModuleCard item={item("MIT")} setError={vi.fn()} />)
		expect(screen.getByTestId("module-provenance")).toHaveTextContent("MIT · Unsigned catalogue module")
	})
})
