import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import TaskHeader from "../TaskHeader"

let expanded = true
const setExpanded = vi.fn((v: boolean) => {
	expanded = v
})

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: { apiProvider: "anthropic" },
		currentTaskItem: { id: "t1", size: 10 },
		checkpointManagerErrorMessage: undefined,
		aihydroMessages: [],
		navigateToSettings: vi.fn(),
		useAutoCondense: false,
		mode: "act",
		expandTaskHeader: expanded,
		setExpandTaskHeader: setExpanded,
		environment: "production",
		studyBinding: {
			chatId: "c",
			status: "bound",
			studyId: "usgs_01031500_hydro_data",
			canChoose: true,
		},
	}),
}))
vi.mock("@/components/settings/utils/providerUtils", () => ({
	normalizeApiConfiguration: () => ({ selectedModelInfo: { contextWindow: 1000 } }),
	getModeSpecificFields: () => ({ apiProvider: "anthropic" }),
}))
vi.mock("../ContextWindow", () => ({ default: () => null }))
vi.mock("../TaskTimeline", () => ({ default: () => null }))
vi.mock("../FocusChain", () => ({ FocusChain: () => null }))
vi.mock("../CheckpointError", () => ({ CheckpointError: () => null }))
vi.mock("../StudyPicker", () => ({ default: () => null }))

afterEach(() => {
	cleanup()
	expanded = true
	setExpanded.mockClear()
})

const renderHeader = () =>
	render(
		<TaskHeader
			doesModelSupportPromptCache={false}
			onClose={vi.fn()}
			task={{ ts: 1, type: "say", say: "task", text: "Explain" }}
			tokensIn={1}
			tokensOut={1}
			totalCost={0.2555}
		/>,
	)

describe("TaskHeader (N4)", () => {
	it("the expand toggle is a real button with aria-expanded", () => {
		renderHeader()
		const toggle = screen.getByRole("button", { name: "Hide task details" })
		expect(toggle.tagName).toBe("BUTTON")
		expect(toggle.getAttribute("aria-expanded")).toBe("true")
		fireEvent.click(toggle)
		expect(setExpanded).toHaveBeenCalledWith(false)
	})

	it("lays out chips and buttons in a wrapping row, with no 10 px height clamp on the controls", () => {
		renderHeader()
		const row = screen.getByTestId("task-header-row")
		expect(row.className).toContain("flex-wrap")
		for (const name of ["Copy", "Delete Task"]) {
			const b = screen.getByRole("button", { name })
			expect(b.className).not.toContain("max-h-3")
			expect(b.className).toContain("min-h-[24px]")
		}
		expect(screen.getByRole("button", { name: /New task/ }).className).toContain("min-h-[24px]")
		expect(document.getElementById("price-tag")?.className).toContain("shrink-0")
		expect(screen.getByText("$0.2555")).toBeTruthy()
	})
})
