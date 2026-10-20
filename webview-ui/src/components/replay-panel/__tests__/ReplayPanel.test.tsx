import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ReplayPanel } from "../ReplayPanel"

vi.mock("@/config/platform.config", () => ({ PLATFORM_CONFIG: { postMessage: vi.fn() } }))
afterEach(cleanup)

function showRun(evidence: Record<string, unknown>, timestamp = "2026-01-01T12:00:00+05:30") {
	render(<ReplayPanel />)
	act(() =>
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "replay_data",
					session_id: "synthetic",
					source: "session",
					entries: [
						{
							run_id: "actual-run-id",
							session_id: "synthetic",
							tool_name: "evaluate",
							timestamp,
							key_outputs: { nse: 0.8 },
							evidence,
							inputs: { period: "2000-2001" },
						},
					],
				},
			}),
		),
	)
}

describe("Replay recorded evidence", () => {
	it("shows unchecked instead of passing when no checks were recorded", () => {
		showRun({ quality_flags: [] })
		expect(screen.getByText("not checked")).toBeInTheDocument()
		expect(screen.queryByText("recorded checks passed")).not.toBeInTheDocument()
		expect(screen.getByText(/analyses are not recomputed/)).toBeInTheDocument()
	})

	it("uses stored failed checks and exposes input and uncertainty evidence", () => {
		showRun({
			quality_flags: [{ validator: "mass_balance", status: "fail" }],
			uncertainty: { nse: { value: 0.8, ci_low: 0.7, ci_high: 0.9 } },
		})
		expect(screen.getByText("failed")).toBeInTheDocument()
		expect(screen.getByText("Recorded inputs")).toBeInTheDocument()
		expect(screen.getByText("Recorded uncertainty")).toBeInTheDocument()
		expect(screen.getByText(/"ci_low": 0.7/)).toBeInTheDocument()
		expect(screen.getByText("2026-01-01 06:30:00 UTC")).toBeInTheDocument()
	})

	it("marks recorded execution errors as failed even without validator flags", () => {
		showRun({ error: true, quality_flags: [] })
		expect(screen.getByText("failed")).toBeInTheDocument()
	})

	it("does not assign a timezone to a naive recorded timestamp", () => {
		showRun({ quality_flags: [{ validator: "fixture", status: "pass" }] }, "2026-01-01T12:00:00")
		expect(screen.getByText("recorded checks passed")).toBeInTheDocument()
		expect(screen.getByText(/timezone not recorded/)).toBeInTheDocument()
	})

	it("shows missing-history diagnostics rather than invented runs", () => {
		render(<ReplayPanel />)
		act(() =>
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "replay_data",
						session_id: "empty",
						entries: [],
						warnings: ["No retained run log is available; current results are not historical runs."],
					},
				}),
			),
		)
		expect(screen.getByText(/No retained run log/)).toBeInTheDocument()
		expect(screen.queryByText("recorded checks passed")).not.toBeInTheDocument()
	})
})

describe("Replay minimal rows", () => {
	function showRows() {
		render(<ReplayPanel />)
		const row = (run_id: string, extra: Record<string, unknown>) => ({
			run_id,
			session_id: "synthetic",
			tool_name: `tool_${run_id}`,
			timestamp: "2026-01-01T12:00:00Z",
			key_outputs: {},
			...extra,
		})
		act(() =>
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "replay_data",
						session_id: "synthetic",
						source: "session",
						entries: [
							row("full1", { key_outputs: { nse: 0.8 } }),
							row("min1", { minimal: true }),
							row("min2", { minimal: true, record_error: "output_digest_missing" }),
						],
					},
				}),
			),
		)
	}

	it("hides minimal rows by default and offers a counted toggle", () => {
		showRows()
		expect(screen.getAllByText("tool_full1").length).toBeGreaterThan(0)
		expect(screen.queryByText("tool_min1")).not.toBeInTheDocument()
		expect(screen.getByTestId("toggle-minimal-runs").textContent).toBe("Show 2 recorded calls (1 with record errors)")
	})

	it("counts hidden minimal rows with record_error as failed", () => {
		showRows()
		expect(screen.queryByText("tool_min2")).not.toBeInTheDocument()
		expect(screen.getByText("1 failed")).toBeInTheDocument()
	})

	it("reveals minimal rows on toggle and labels them as recorded calls", () => {
		showRows()
		fireEvent.click(screen.getByTestId("toggle-minimal-runs"))
		expect(screen.getAllByText("tool_min1").length).toBeGreaterThan(0)
		expect(screen.getAllByText("recorded call").length).toBe(2)
		expect(screen.getByTestId("toggle-minimal-runs").textContent).toBe("Hide 2 recorded calls (1 with record errors)")
	})
})

describe("Replay: green means approved", () => {
	const GREEN = "testing-iconPassed"

	function showEntries(entries: Array<Record<string, unknown>>) {
		const view = render(<ReplayPanel />)
		act(() =>
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "replay_data", session_id: "synthetic", source: "session", entries },
				}),
			),
		)
		return view
	}
	const run = (run_id: string, evidence: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
		run_id,
		session_id: "synthetic",
		tool_name: `tool_${run_id}`,
		timestamp: "2026-01-01T12:00:00Z",
		key_outputs: { nse: 0.8 },
		evidence,
		...extra,
	})

	it("renders 'recorded checks passed' and a pass chip without the success token", () => {
		const { container } = showEntries([run("a", { quality_flags: [{ validator: "mass_balance", status: "pass" }] })])
		expect(screen.getAllByText("recorded checks passed").length).toBeGreaterThan(0)
		expect(container.innerHTML).not.toContain(GREEN)
	})

	it("renders '0 need review' and '0 failed' neutral", () => {
		const { container } = showEntries([run("a", { quality_flags: [{ validator: "mass_balance", status: "pass" }] })])
		expect(screen.getByTestId("need-review-count").textContent).toContain("0 need review")
		expect(screen.getByTestId("failed-count").textContent).toContain("0 failed")
		expect(container.innerHTML).not.toContain(GREEN)
	})

	it("keeps warnings and failures in their own colours", () => {
		const { container } = showEntries([run("a", { quality_flags: [{ validator: "mass_balance", status: "fail" }] })])
		expect(container.innerHTML).toContain("testing-iconFailed")
		expect(container.innerHTML).not.toContain(GREEN)
	})

	it("has no Demo control", () => {
		showEntries([])
		expect(screen.queryByRole("button", { name: "Demo" })).not.toBeInTheDocument()
		expect(document.body.textContent).not.toMatch(/demo/i)
	})
})

describe("Replay: arrow keys are scoped to the run timeline", () => {
	function showTwoRuns() {
		render(<ReplayPanel />)
		const row = (run_id: string) => ({
			run_id,
			session_id: "synthetic",
			tool_name: `tool_${run_id}`,
			timestamp: "2026-01-01T12:00:00Z",
			key_outputs: { nse: 0.8 },
		})
		act(() =>
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "replay_data", session_id: "synthetic", source: "session", entries: [row("r1"), row("r2")] },
				}),
			),
		)
	}
	const selectedTitle = () => screen.getAllByTitle(/^r\d$/).at(0)?.getAttribute("title")

	it("moves the selection when ArrowDown is pressed inside the timeline", () => {
		showTwoRuns()
		expect(selectedTitle()).toBe("r1")
		const notPrevented = fireEvent.keyDown(screen.getByTestId("run-timeline"), { key: "ArrowDown" })
		expect(notPrevented).toBe(false) // preventDefault was called: the timeline consumed it
		expect(selectedTitle()).toBe("r2")
	})

	it("leaves arrow keys alone in the session input and the filter input", () => {
		showTwoRuns()
		for (const input of [
			screen.getByPlaceholderText("session_id or capsule path"),
			screen.getByPlaceholderText(/Filter by tool/),
		]) {
			const notPrevented = fireEvent.keyDown(input, { key: "ArrowDown" })
			expect(notPrevented).toBe(true) // not prevented: the input keeps its caret / datalist behaviour
		}
		expect(selectedTitle()).toBe("r1")
	})

	it("does not capture arrow keys on the window", () => {
		showTwoRuns()
		const notPrevented = fireEvent.keyDown(window, { key: "ArrowDown" })
		expect(notPrevented).toBe(true)
		expect(selectedTitle()).toBe("r1")
	})

	it("does not clear the selection with Escape pressed in the filter input", () => {
		showTwoRuns()
		fireEvent.keyDown(screen.getByPlaceholderText(/Filter by tool/), { key: "Escape" })
		expect(selectedTitle()).toBe("r1")
	})
})
