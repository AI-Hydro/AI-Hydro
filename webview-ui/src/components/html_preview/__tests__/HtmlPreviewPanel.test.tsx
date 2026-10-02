import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import { HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HtmlPreviewPanel } from "../HtmlPreviewPanel"

const panelState = vi.hoisted(() => ({ courseEnabled: false, packEnabled: false }))
const panelMocks = vi.hoisted(() => ({
	loadWorkspaceFile: vi.fn(async () => undefined),
	setCurrent: vi.fn(async (moduleId: string | null) => ({
		courseId: "course-1",
		startedAt: 1,
		lastVisitedAt: 2,
		currentModuleId: moduleId,
		completed: {},
	})),
	useCourseProgress: vi.fn(),
}))

const setActiveItemIdMock = vi.fn()
const removeItemMock = vi.fn()

const mkItem = (id: string, title: string, metadata: HtmlPreviewItem["metadata"] = {}): HtmlPreviewItem => ({
	id,
	title,
	htmlContent: "",
	filePath: `/abs/${id}.html`,
	interactive: true,
	metadata,
	webviewUri: `https://example.vscode-cdn.net/file/abs/${id}.html?h=00000000`,
	dirUri: "https://example.vscode-cdn.net/file/abs",
	contentHash: "00000000deadbeef",
	resolvedMode: HtmlPreviewMode.INTERACTIVE,
})

// Mock the HTML preview context to avoid gRPC dependencies
vi.mock("../../../context/HtmlPreviewContext", () => ({
	useHtmlPreviewContext: () => {
		const metadata: Record<string, string> = panelState.packEnabled
			? {
					artifactKind: "learning-pack-v1",
					learningPackId: "pack-1",
					learningPackCourseId: "course-1",
					learningPackEdition: "student",
					learningPackModuleId: "module-1",
				}
			: {}
		return {
			items: [mkItem("html_1", "Preview 1", metadata), mkItem("html_2", "Preview 2")],
			activeItemId: "html_1",
			setActiveItemId: setActiveItemIdMock,
			removeItem: removeItemMock,
			clearAllItems: vi.fn(),
			addItemFromContent: vi.fn(),
			loadWorkspaceFile: panelMocks.loadWorkspaceFile,
			manifestsById: {},
		}
	},
	HtmlPreviewContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("../useCourse", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../useCourse")>()
	return {
		...actual,
		useCourse: () =>
			panelState.courseEnabled
				? {
						course: {
							courseId: "course-1",
							title: "Course 1",
							modules: [
								{ id: "module-1", path: "module-1.html", title: "Module 1" },
								{ id: "module-2", path: "module-2.html", title: "Module 2" },
							],
						},
						courseRoot: "/abs/course",
						currentModuleId: "module-1",
						loading: false,
					}
				: { course: null, courseRoot: null, currentModuleId: null, loading: false },
	}
})

vi.mock("../useCourseProgress", () => ({
	useCourseProgress: (course: unknown, scope: unknown) => {
		panelMocks.useCourseProgress(course, scope)
		return {
			progress: { courseId: "course-1", startedAt: 1, lastVisitedAt: 1, currentModuleId: "module-1", completed: {} },
			loading: false,
			isCompleted: () => false,
			canAccess: () => true,
			missingPrerequisites: () => [],
			completionPct: 0,
			markComplete: vi.fn(async () => null),
			markUncomplete: vi.fn(async () => undefined),
			reset: vi.fn(async () => undefined),
			setCurrent: panelMocks.setCurrent,
			refresh: vi.fn(async () => undefined),
		}
	},
}))

// Mock the extension state context for workspaceHtmlFiles
vi.mock("../../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		workspaceHtmlFiles: [
			{ path: "public/index.html", name: "index.html" },
			{ path: "src/about.html", name: "about.html" },
		],
	}),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("HtmlPreviewPanel", () => {
	beforeEach(() => {
		panelState.courseEnabled = false
		panelState.packEnabled = false
		panelMocks.loadWorkspaceFile.mockClear()
		panelMocks.setCurrent.mockClear()
		panelMocks.useCourseProgress.mockClear()
	})

	it("renders sidebar with workspace files", () => {
		render(<HtmlPreviewPanel />)
		expect(screen.getByText("index.html")).toBeInTheDocument()
		expect(screen.getByText("about.html")).toBeInTheDocument()
	})

	it("renders tab bar when there are multiple items", () => {
		render(<HtmlPreviewPanel />)
		const tabs = screen.getAllByRole("tab")
		expect(tabs.length).toBe(2)
		expect(tabs[0]).toHaveTextContent("Preview 1")
		expect(tabs[1]).toHaveTextContent("Preview 2")
	})

	it("does not show legacy safe/interactive tab badges", () => {
		render(<HtmlPreviewPanel />)
		expect(screen.queryByText("S")).not.toBeInTheDocument()
		expect(screen.queryByText("JS")).not.toBeInTheDocument()
	})

	it("calls setActiveItemId when a tab is clicked", () => {
		render(<HtmlPreviewPanel />)
		const tabs = screen.getAllByRole("tab")
		fireEvent.click(tabs[1])
		expect(setActiveItemIdMock).toHaveBeenCalledWith("html_2")
	})

	it("calls removeItem when close button is clicked", () => {
		render(<HtmlPreviewPanel />)
		const closeButton = screen.getByLabelText("Close Preview 1")
		fireEvent.click(closeButton)
		expect(removeItemMock).toHaveBeenCalledWith("html_1")
	})

	it("renders active item in HtmlPreviewView", () => {
		render(<HtmlPreviewPanel />)
		const titles = screen.getAllByText("Preview 1")
		expect(titles.length).toBeGreaterThanOrEqual(1)
	})

	it("collapses and re-expands the file/modules side panel", () => {
		render(<HtmlPreviewPanel />)
		expect(screen.getByText("index.html")).toBeInTheDocument()
		fireEvent.click(screen.getByTitle("Close side panel"))
		expect(screen.queryByText("index.html")).not.toBeInTheDocument()
		fireEvent.click(screen.getByTitle("Open side panel"))
		expect(screen.getByText("index.html")).toBeInTheDocument()
	})

	it("uses the installed edition scope for sidebar course navigation", async () => {
		panelState.courseEnabled = true
		panelState.packEnabled = true
		render(<HtmlPreviewPanel />)

		fireEvent.click(screen.getByTitle("Module 2"))
		await waitFor(() => expect(panelMocks.loadWorkspaceFile).toHaveBeenCalledWith("/abs/course/module-2.html", "Module 2"))
		expect(panelMocks.setCurrent).toHaveBeenCalledWith("module-2")
		expect(panelMocks.useCourseProgress).toHaveBeenCalledWith(
			expect.objectContaining({ courseId: "course-1" }),
			expect.objectContaining({ packId: "pack-1", courseId: "course-1", edition: "student" }),
		)
	})
})
