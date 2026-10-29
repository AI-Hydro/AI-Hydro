import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import HistoryView from "../HistoryView"

const mock = vi.hoisted(() => ({
	history: [] as any[],
	rows: [] as any[],
	renameChat: vi.fn(async (_req: any) => ({ ok: true, reason: "", detail: "" }) as any),
	startBulkTitling: vi.fn(async () => ({ status: "done", titled: 2, failed: 0, skipped: 0 })),
	cancelBulkTitling: vi.fn(async () => ({})),
	showTaskWithId: vi.fn(async () => ({})),
	state: { taskHistory: [] as any[], autoTitle: true as boolean | undefined, titleModel: "", totalTasksSize: 0 } as any,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: ({ data, itemContent }: any) => <div>{data.map((d: any, i: number) => itemContent(i, d))}</div>,
}))
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		getTaskHistory: async () => ({ tasks: mock.rows, totalCount: mock.rows.length }),
		getTotalTasksSize: async () => ({ value: 0 }),
		renameChat: (r: any) => mock.renameChat(r),
		startBulkTitling: () => mock.startBulkTitling(),
		cancelBulkTitling: () => mock.cancelBulkTitling(),
		showTaskWithId: () => mock.showTaskWithId(),
		toggleTaskFavorite: async () => ({}),
		deleteTasksWithIds: async () => ({}),
		deleteAllTaskHistory: async () => ({}),
		exportTaskWithId: async () => ({}),
	},
}))
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ ...mock.state, onRelinquishControl: () => () => {}, environment: "production" }),
}))

// Synthetic chats only.
const row = (id: string, over: any = {}) => ({
	id,
	task: `Raw first prompt for ${id}`,
	ts: Date.UTC(2026, 9, 1, 15, 30),
	isFavorited: false,
	size: 1000,
	totalCost: 0,
	tokensIn: 1,
	tokensOut: 1,
	cacheWrites: 0,
	cacheReads: 0,
	title: "",
	titleSource: "",
	description: "",
	...over,
})

function setup(rows: any[], state: Record<string, unknown> = {}) {
	mock.rows = rows
	mock.state = {
		taskHistory: rows.map((r) => ({ id: r.id, ts: r.ts, task: r.task, titleSource: r.titleSource || undefined })),
		autoTitle: true,
		titleModel: "",
		totalTasksSize: 0,
		...state,
	}
	return render(<HistoryView onDone={() => {}} />)
}

beforeEach(() => {
	window.localStorage.clear()
})
afterEach(() => {
	cleanup()
	for (const f of [mock.renameChat, mock.startBulkTitling, mock.cancelBulkTitling, mock.showTaskWithId]) {
		f.mockClear()
	}
})

describe("History: chat names", () => {
	it("shows the checked title, not the raw first prompt, and the description", async () => {
		setup([
			row("t1", { title: "Baseflow in two synthetic basins", titleSource: "auto", description: "Two synthetic basins." }),
		])
		expect(await screen.findByRole("button", { name: "Baseflow in two synthetic basins" })).toBeInTheDocument()
		expect(screen.getByText("Two synthetic basins.")).toBeInTheDocument()
		expect(document.body.textContent).not.toContain("Raw first prompt for t1")
	})

	it("F2 on the name opens an inline rename, Enter saves it through renameChat, focus returns to the name", async () => {
		setup([row("t1", { title: "Baseflow in two synthetic basins", titleSource: "auto" })])
		const name = await screen.findByRole("button", { name: "Baseflow in two synthetic basins" })
		name.focus()
		fireEvent.keyDown(name, { key: "F2" })
		const field = await screen.findByRole("textbox", { name: "Chat name" })
		expect(field).toHaveFocus()
		expect((field as HTMLInputElement).maxLength).toBe(60)
		fireEvent.change(field, { target: { value: "Kentucky low flows" } })
		fireEvent.submit(field.closest("form")!)
		await waitFor(() => expect(mock.renameChat).toHaveBeenCalledOnce())
		expect(mock.renameChat.mock.calls[0][0]).toMatchObject({ taskId: "t1", title: "Kentucky low flows" })
		await waitFor(() => expect(screen.queryByRole("textbox", { name: "Chat name" })).toBeNull())
	})

	it("Escape cancels without calling the host", async () => {
		setup([row("t1", { title: "Baseflow in two synthetic basins", titleSource: "auto" })])
		fireEvent.click(await screen.findByRole("button", { name: "Rename chat: Baseflow in two synthetic basins" }))
		const field = await screen.findByRole("textbox", { name: "Chat name" })
		fireEvent.change(field, { target: { value: "Something else" } })
		fireEvent.keyDown(field, { key: "Escape" })
		await waitFor(() => expect(screen.queryByRole("textbox", { name: "Chat name" })).toBeNull())
		expect(mock.renameChat).not.toHaveBeenCalled()
	})

	it("a refused name stays in the field with the reason read out", async () => {
		mock.renameChat.mockResolvedValueOnce({ ok: false, reason: "invalid", detail: "id" })
		setup([row("t1", { title: "Auto name", titleSource: "auto" })])
		fireEvent.click(await screen.findByRole("button", { name: "Rename chat: Auto name" }))
		const field = await screen.findByRole("textbox", { name: "Chat name" })
		fireEvent.change(field, { target: { value: "prj_abc12345" } })
		fireEvent.submit(field.closest("form")!)
		expect(await screen.findByRole("alert")).toHaveTextContent("A name cannot be only an id.")
		expect(screen.getByRole("textbox", { name: "Chat name" })).toHaveAttribute("aria-invalid", "true")
	})

	it("offers Reset to automatic only for a name the user set, and sends an empty title", async () => {
		setup([row("t1", { title: "Mine", titleSource: "user" }), row("t2", { title: "Auto name", titleSource: "auto" })])
		fireEvent.click(await screen.findByRole("button", { name: "Rename chat: Auto name" }))
		expect(screen.queryByRole("button", { name: "Reset to automatic" })).toBeNull()
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Chat name" }), { key: "Escape" })
		fireEvent.click(await screen.findByRole("button", { name: "Rename chat: Mine" }))
		fireEvent.click(await screen.findByRole("button", { name: "Reset to automatic" }))
		await waitFor(() => expect(mock.renameChat).toHaveBeenCalledOnce())
		expect(mock.renameChat.mock.calls[0][0]).toMatchObject({ taskId: "t1", title: "" })
	})
})

describe("History: opt-in bulk titling banner", () => {
	it("offers titles for chats no model has titled, with the count, the estimate and where it goes, and calls nothing by itself", async () => {
		setup([
			row("t1", { title: "Fallback one", titleSource: "fallback" }),
			row("t2"),
			row("t3", { title: "Mine", titleSource: "user" }),
			row("t4", { title: "Done", titleSource: "auto" }),
		])
		const banner = await screen.findByRole("region", { name: "Title earlier chats" })
		expect(within(banner).getByText(/2 earlier chats have only a short automatic name/)).toBeInTheDocument()
		expect(within(banner).getByText(/your chat model/)).toBeInTheDocument()
		expect(within(banner).getByText(/about 3k tokens/)).toBeInTheDocument()
		expect(within(banner).getByRole("button", { name: "Generate titles for 2 chats" })).toBeInTheDocument()
		// nothing is sent until the click
		await new Promise((r) => setTimeout(r, 30))
		expect(mock.startBulkTitling).not.toHaveBeenCalled()
	})

	it("the button is the consent: one click starts one run and the outcome is stated", async () => {
		setup([row("t1"), row("t2")])
		fireEvent.click(await screen.findByRole("button", { name: "Generate titles for 2 chats" }))
		await waitFor(() => expect(mock.startBulkTitling).toHaveBeenCalledOnce())
		expect(await screen.findByRole("status")).toHaveTextContent("2 chats titled.")
	})

	it("names the configured title model", async () => {
		setup([row("t1")], { titleModel: "small-model" })
		expect(await screen.findByText(/the model small-model/)).toBeInTheDocument()
	})

	it("is not shown with automatic titles off, nor when every chat is titled, and Not now hides it", async () => {
		const off = setup([row("t1")], { autoTitle: false })
		await screen.findByRole("button", { name: /Rename chat/ })
		expect(screen.queryByRole("region", { name: "Title earlier chats" })).toBeNull()
		off.unmount()
		const done = setup([row("t1", { title: "Done", titleSource: "auto" })])
		await screen.findByRole("button", { name: /Rename chat/ })
		expect(screen.queryByRole("region", { name: "Title earlier chats" })).toBeNull()
		done.unmount()
		setup([row("t1")])
		fireEvent.click(await screen.findByRole("button", { name: "Not now" }))
		expect(screen.queryByRole("region", { name: "Title earlier chats" })).toBeNull()
		expect(window.localStorage.getItem("aihydro.titleBannerDismissed")).toBe("1")
		expect(mock.startBulkTitling).not.toHaveBeenCalled()
	})
})
