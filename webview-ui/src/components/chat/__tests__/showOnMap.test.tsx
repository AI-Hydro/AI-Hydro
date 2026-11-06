import type { MapLayer } from "@shared/proto/cline/map"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { successCall } from "../../../screens/fixtures/aihydro"
import { ClaimChip } from "../ClaimChip"
import { ScienceToolCard } from "../ScienceToolCard"

const postMessage = vi.hoisted(() => vi.fn())
vi.mock("@/config/platform.config", () => ({ PLATFORM_CONFIG: { postMessage } }))
vi.mock("../../../config/platform.config", () => ({ PLATFORM_CONFIG: { postMessage } }))

const state = vi.hoisted(() => ({ layers: [] as unknown[], claims: {} as Record<string, unknown> }))
vi.mock("../../../context/MapContext", () => ({ useOptionalMapLayers: () => state.layers }))
vi.mock("../../../context/LedgerContext", () => ({ useLedgerContext: () => ({ getClaim: (id: string) => state.claims[id] }) }))

const RUN = "dfetch.20261017.e2eproo.48d4b668"
const layer = (id: string, run: string) => ({ id, name: id, metadata: { _run_id: run } }) as unknown as MapLayer

const claim = (runIds: string[]) => ({
	claimId: "c1",
	status: "supported",
	statement: "Baseflow index exceeds 0.5",
	confidence: "medium",
	limitations: [],
	revisionDigest: "sha256:abc",
	evidenceSpans: [
		...runIds.map((r) => ({ sourceType: "run", sourceId: r, metricRef: "", description: "" })),
		{ sourceType: "paper", sourceId: "10.1/x", metricRef: "", description: "" },
	],
})

const toolCard = () =>
	render(
		<ScienceToolCard
			annotations={successCall.annotations}
			argsJson={successCall.argsJson}
			resultText={successCall.resultText}
			serverName="ai-hydro"
			toolMeta={successCall.meta}
			toolName={successCall.toolName}
		/>,
	)

beforeEach(() => {
	postMessage.mockClear()
	state.layers = []
	state.claims = {}
})

describe("On map, from a tool card", () => {
	it("offers On map (N) when layers on the map came from the run, and asks the host to show them", () => {
		state.layers = [layer("a", RUN), layer("b", RUN), layer("c", "other-run")]
		toolCard()
		fireEvent.click(screen.getByRole("button", { name: "On map (2)" }))
		expect(postMessage).toHaveBeenCalledWith({ type: "aihydro-show-on-map", run_ids: [RUN] })
	})

	it("offers nothing when no layer came from the run", () => {
		state.layers = [layer("c", "other-run")]
		toolCard()
		expect(screen.queryByRole("button", { name: /On map/ })).toBeNull()
	})
})

describe("Show on map, from a claim", () => {
	const open = () => {
		render(<ClaimChip claimId="c1" />)
		fireEvent.click(screen.getByRole("button", { name: /^c1/ }))
	}

	it("a claim whose evidence run has layers gets the button, and only run evidence counts", () => {
		state.claims.c1 = claim(["run-1"])
		state.layers = [layer("a", "run-1")]
		open()
		// Two ways in: the globe on the chip (no expanding) and the button in the popover.
		const buttons = screen.getAllByRole("button", { name: /Show on map \(1\)/ })
		expect(buttons).toHaveLength(2)
		fireEvent.click(buttons[1])
		expect(postMessage).toHaveBeenCalledWith({ type: "aihydro-show-on-map", run_ids: ["run-1"] })
	})

	it("the globe on the chip shows the layers without opening the claim", () => {
		state.claims.c1 = claim(["run-1"])
		state.layers = [layer("a", "run-1")]
		render(<ClaimChip claimId="c1" />)
		fireEvent.click(screen.getByTestId("chip-show-on-map"))
		expect(postMessage).toHaveBeenCalledWith({ type: "aihydro-show-on-map", run_ids: ["run-1"] })
		expect(screen.queryByText("Evidence:")).toBeNull()
	})

	it("a claim with no run on the map, or no run evidence, gets no button", () => {
		state.claims.c1 = claim(["run-1"])
		state.layers = [layer("a", "run-2")]
		open()
		expect(screen.queryByRole("button", { name: /Show on map/ })).toBeNull()
		expect(screen.queryByTestId("chip-show-on-map")).toBeNull()
		// The absence is stated where the action would be.
		expect(screen.getByTestId("chip-no-map-layer")).toHaveTextContent("No map layer from this claim's run.")
	})

	it("a claim whose evidence names no run says so instead of promising a layer", () => {
		state.claims.c1 = claim([])
		state.layers = []
		open()
		expect(screen.getByTestId("chip-no-map-layer")).toHaveTextContent("names no run")
	})
})
