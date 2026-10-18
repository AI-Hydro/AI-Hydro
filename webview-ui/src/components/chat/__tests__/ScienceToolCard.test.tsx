import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	areaFailCall,
	argRepairRefusal,
	provisionalCall,
	type RecordedCall,
	refusalCall,
	signaturesCall,
	successCall,
} from "../../../screens/fixtures/aihydro"
import { ScienceToolCard } from "../ScienceToolCard"

const postMessage = vi.hoisted(() => vi.fn())
vi.mock("@/config/platform.config", () => ({ PLATFORM_CONFIG: { postMessage } }))

const card = (c: RecordedCall, extra: Partial<React.ComponentProps<typeof ScienceToolCard>> = {}) =>
	render(
		<ScienceToolCard
			annotations={c.annotations}
			argsJson={c.argsJson}
			resultText={c.resultText}
			serverName="ai-hydro"
			toolMeta={c.meta}
			toolName={c.toolName}
			{...extra}
		/>,
	)

beforeEach(() => postMessage.mockClear())

describe("ScienceToolCard: success", () => {
	it("shows purpose, typed args, place, source and run, and hides raw JSON by default", () => {
		const { container } = card(successCall)
		const text = container.textContent ?? ""
		expect(text).toContain("Fetch a single hydrology variable for one geometry / time window.")
		expect(text).toContain("USGS-01013500")
		expect(text).toContain("Fish River near Fort Kent, Maine")
		expect(text).toContain("usgs_waterdata")
		expect(text).toContain("dfetch.20261017.e2eproo.48d4b668")
		// raw JSON is not in the DOM until the disclosure is opened
		expect(container.querySelector("pre")).toBeNull()
		expect(text).not.toContain('"approval_counts"')
		expect(text).not.toContain("{")
		fireEvent.click(screen.getByRole("button", { name: /Raw arguments and result/ }))
		expect(container.querySelector("pre")?.textContent).toContain('"variable": "streamflow"')
	})

	it("shows the gauge-resolution chip with the log-area ratio on hover and no warning on pass", () => {
		const { container } = card(successCall)
		const chip = screen.getByRole("group", { name: /Gauge resolution/ })
		expect(chip.textContent).toBe("explicit_id · distance not reported · area check pass")
		expect(chip.getAttribute("title")).toContain("log area ratio 0.0003789")
		expect(container.textContent).not.toContain("Area check failed")
	})

	it("says 'not reported' for the information class and never invents one", () => {
		const { container } = card(successCall)
		expect(container.textContent).toContain("Class not reported")
		expect(container.querySelector("[data-evidence-state=observed],[data-evidence-state=modelled]")).toBeNull()
	})

	it("shows 'provisional 0/7305' for a fully approved series", () => {
		const { container } = card(successCall)
		expect(container.textContent).toContain("provisional 0/7305")
	})
})

describe("ScienceToolCard: run link", () => {
	it("opens Replay with the session from the call's arguments", () => {
		card(successCall, { fallbackSessionId: "ignored-session" })
		fireEvent.click(screen.getByRole("button", { name: "Open in Replay" }))
		expect(postMessage).toHaveBeenCalledWith({
			type: "open_replay",
			session_id: "e2e-proof-3-01013500-20261017T171951Z",
			run_id: "dfetch.20261017.e2eproo.48d4b668",
		})
	})

	it("falls back to the ledger session when the call carries none", () => {
		const args = JSON.stringify({ variable: "streamflow" })
		card(provisionalCall, { argsJson: args, fallbackSessionId: "ledger-session" })
		fireEvent.click(screen.getByRole("button", { name: "Open in Replay" }))
		expect(postMessage).toHaveBeenCalledWith({ type: "open_replay", session_id: "ledger-session", run_id: "fx-run-0101" })
	})

	it("does not offer a link it cannot honour when no session id is known", () => {
		const { container } = card(provisionalCall, { argsJson: "{}" })
		expect(screen.queryByRole("button", { name: "Open in Replay" })).toBeNull()
		expect(container.textContent).toContain("fx-run-0101")
		expect(container.textContent).toContain("Replay needs a session id")
	})

	it("offers no link at all when the result has no run id", () => {
		const { container } = card(refusalCall)
		expect(screen.queryByRole("button", { name: "Open in Replay" })).toBeNull()
		expect(container.textContent).not.toContain("Replay needs a session id")
	})

	it("is a link, not a verification: no green token, no 'verified' or 'approved' wording", () => {
		for (const c of [successCall, provisionalCall, areaFailCall, refusalCall, signaturesCall]) {
			const { container, unmount } = card(c)
			expect(container.innerHTML).not.toContain("testing-iconPassed")
			expect(container.querySelector("[data-evidence-state=approved],[data-evidence-state=verified]")).toBeNull()
			expect(container.textContent?.toLowerCase()).not.toMatch(/verified|approved/)
			unmount()
		}
	})
})

describe("ScienceToolCard: area check failure", () => {
	it("shows a visible warning with the ratio and the server's warning text", () => {
		const { container } = card(areaFailCall)
		const chip = screen.getByRole("group", { name: /Gauge resolution/ })
		expect(chip.textContent).toBe("explicit_id · distance not reported · area check fail")
		expect(container.textContent).toContain("Area check failed.")
		expect(container.textContent).toContain("area_check=fail: gauge total area")
		expect(container.querySelector(".codicon-warning")).not.toBeNull()
	})
})

describe("ScienceToolCard: provisional quality", () => {
	it("shows 'provisional n/N (dates)'", () => {
		const { container } = card(provisionalCall)
		expect(container.textContent).toContain("provisional 43/120 (2026-09-04 to 2026-10-16)")
	})
})

describe("ScienceToolCard: refusal", () => {
	it("renders 'Stopped: <code>' with recovery as text and no retry or fallback control", () => {
		const { container } = card(refusalCall)
		expect(container.textContent).toContain("Stopped: GAUGE_REQUIRED")
		expect(container.textContent).toContain("no gauge id, usgs alias or outlet was supplied")
		const recovery = screen.getByText(/^pass gauge_id=/)
		expect(recovery.tagName).toBe("LI")
		const buttons = within(container).queryAllByRole("button")
		expect(buttons.map((b) => b.textContent)).toEqual(["Raw arguments and result (JSON)"])
		expect(container.textContent?.toLowerCase()).not.toMatch(/retry now|try again|use modelled/)
		expect(container.querySelector(".aih-toolcard--stopped")).not.toBeNull()
	})

	it("marks a missing code as not reported and shows the example call as inert text", () => {
		const { container } = card(argRepairRefusal)
		expect(container.textContent).toContain("Stopped: code not reported")
		const pre = container.querySelector("pre")
		expect(pre?.textContent).toContain('"tool":"compute_spectral_index"')
		expect(within(container).queryAllByRole("button")).toHaveLength(1)
	})
})

describe("ScienceToolCard: missing fields", () => {
	it("renders 'not reported' for every field the result lacks", () => {
		const { container } = card(signaturesCall)
		const rows = Array.from(container.querySelectorAll("dl.aih-kv")).flatMap((dl) => Array.from(dl.children))
		const byLabel = Object.fromEntries(
			rows.map((r) => [r.querySelector("dt")?.textContent, r.querySelector("dd")?.textContent]),
		)
		expect(byLabel["Data source"]).toBe("not reported")
		expect(byLabel.Quality).toBe("not reported")
		expect(byLabel["Information class"]).toBe("Class not reported")
		expect(byLabel.Place).toBe("01013500")
		for (const dd of container.querySelectorAll("dl.aih-kv dd")) {
			expect((dd.textContent ?? "").trim()).not.toBe("")
		}
	})

	it("shows 'Running…' while waiting and a neutral note when no result was recorded", () => {
		const { container, rerender } = render(
			<ScienceToolCard argsJson="{}" running serverName="ai-hydro" toolName="some_tool" />,
		)
		expect(container.textContent).toContain("Running…")
		rerender(<ScienceToolCard argsJson="{}" serverName="ai-hydro" toolName="some_tool" />)
		expect(container.textContent).toContain("No result recorded yet.")
		expect(container.textContent).toContain("Purpose: not reported")
	})

	it("shows images returned by the tool", () => {
		const { container } = render(
			<ScienceToolCard
				argsJson="{}"
				resultText={`${JSON.stringify({ _run_id: "r" })}\n\ndata:image/png;base64,AAAA`}
				serverName="ai-hydro"
				toolName="some_tool"
			/>,
		)
		expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA")
	})
})
