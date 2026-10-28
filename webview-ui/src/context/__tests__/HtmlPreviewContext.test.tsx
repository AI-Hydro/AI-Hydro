import { type HtmlPreviewItem, HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { HtmlPreviewContextProvider, useHtmlPreviewContext } from "../HtmlPreviewContext"

// Helper to build a fully-typed HtmlPreviewItem for tests.
const mk = (id: string, title: string): HtmlPreviewItem => ({
	id,
	title,
	htmlContent: "",
	filePath: `/abs/${id}.html`,
	interactive: false,
	metadata: {},
	webviewUri: `https://example.vscode-cdn.net/file/abs/${id}.html?h=00000000`,
	dirUri: "https://example.vscode-cdn.net/file/abs",
	contentHash: "00000000deadbeef",
	resolvedMode: HtmlPreviewMode.SAFE,
})

const mkOp = (id: string, op: "clear" | "remove"): HtmlPreviewItem => ({
	id,
	title: "",
	htmlContent: "",
	filePath: "",
	interactive: false,
	metadata: { __operation: op },
	webviewUri: "",
	dirUri: "",
	contentHash: "",
	resolvedMode: HtmlPreviewMode.SAFE,
})

// Mock the gRPC client
const mockGetHtmlPreviewState = vi.fn()
const mockRemoveHtmlPreviewItem = vi.fn()
const mockSubscribeToHtmlPreviews = vi.fn()

vi.mock("../../services/grpc-client", () => ({
	HtmlPreviewServiceClient: {
		getHtmlPreviewState: (...args: any[]) => mockGetHtmlPreviewState(...args),
		removeHtmlPreviewItem: (...args: any[]) => mockRemoveHtmlPreviewItem(...args),
		subscribeToHtmlPreviews: (...args: any[]) => mockSubscribeToHtmlPreviews(...args),
	},
}))

// Stub useExtensionState — the context reads `htmlPreviewVersion` and the host's activation signal.
let mockExtensionState: Record<string, unknown> = { htmlPreviewVersion: 0 }
vi.mock("../ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Test component that consumes the context
const TestConsumer: React.FC = () => {
	const { items, activeItemId, removeItem, setActiveItemId } = useHtmlPreviewContext()

	return (
		<div>
			<div data-testid="item-count">{items.length}</div>
			<div data-testid="active-id">{activeItemId ?? "none"}</div>
			{items.map((item) => (
				<div data-testid={`item-${item.id}`} key={item.id}>
					{item.title}
				</div>
			))}
			<button data-testid="remove-btn" onClick={() => removeItem("html_1")}>
				Remove
			</button>
			<button data-testid="set-active-btn" onClick={() => setActiveItemId("html_1")}>
				Set Active
			</button>
		</div>
	)
}

describe("HtmlPreviewContext", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockExtensionState = { htmlPreviewVersion: 0 }
	})

	it("shows a document the host just opened without a shell reload, once per activation", async () => {
		const items: HtmlPreviewItem[] = [mk("html_1", "Preview 1"), mk("html_2", "Preview 2")]
		mockGetHtmlPreviewState.mockResolvedValue({ items })
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})
		// A fresh element each time: re-rendering the identical element would bail out before the hook re-reads state.
		const tree = () => (
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>
		)
		const { rerender } = render(tree())
		await waitFor(() => expect(screen.getByTestId("active-id").textContent).to.equal("html_2"))

		// The user is looking at html_1 when the host opens html_2 (activation 1): the shell switches.
		act(() => {
			screen.getByTestId("set-active-btn").click()
		})
		expect(screen.getByTestId("active-id").textContent).to.equal("html_1")
		mockExtensionState = { htmlPreviewVersion: 1, htmlPreviewActiveId: "html_2", htmlPreviewActivationSeq: 1 }
		rerender(tree())
		await waitFor(() => expect(screen.getByTestId("active-id").textContent).to.equal("html_2"))

		// The user goes back to html_1; an unrelated state push (same activation) must not undo that.
		act(() => {
			screen.getByTestId("set-active-btn").click()
		})
		mockExtensionState = { htmlPreviewVersion: 2, htmlPreviewActiveId: "html_2", htmlPreviewActivationSeq: 1 }
		rerender(tree())
		expect(screen.getByTestId("active-id").textContent).to.equal("html_1")
	})

	it("provides initial empty state", async () => {
		mockGetHtmlPreviewState.mockResolvedValue({ items: [] })
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("0")
			expect(screen.getByTestId("active-id").textContent).to.equal("none")
		})
	})

	it("fetches and displays items from backend", async () => {
		const items: HtmlPreviewItem[] = [mk("html_1", "Preview 1"), mk("html_2", "Preview 2")]
		mockGetHtmlPreviewState.mockResolvedValue({ items })
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("2")
			expect(screen.getByTestId("item-html_1")).toBeInTheDocument()
			expect(screen.getByTestId("item-html_2")).toBeInTheDocument()
		})

		// Should auto-select the last item
		expect(screen.getByTestId("active-id").textContent).to.equal("html_2")
	})

	it("calls removeHtmlPreviewItem on backend when removeItem is invoked", async () => {
		mockGetHtmlPreviewState.mockResolvedValue({ items: [mk("html_1", "Preview 1")] })
		mockRemoveHtmlPreviewItem.mockResolvedValue({})
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-html_1")).toBeInTheDocument()
		})

		fireEvent.click(screen.getByTestId("remove-btn"))

		await waitFor(() => {
			expect(mockRemoveHtmlPreviewItem).toHaveBeenCalled()
		})
	})

	it("updates active item when setActiveItemId is called", async () => {
		mockGetHtmlPreviewState.mockResolvedValue({
			items: [mk("html_1", "Preview 1"), mk("html_2", "Preview 2")],
		})
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("active-id").textContent).to.equal("html_2")
		})

		// Click to change active from html_2 to html_1
		fireEvent.click(screen.getByTestId("set-active-btn"))

		await waitFor(() => {
			expect(screen.getByTestId("active-id").textContent).to.equal("html_1")
		})
	})

	it("handles clear operation from subscription", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined

		mockGetHtmlPreviewState.mockResolvedValue({ items: [mk("html_1", "Preview 1")] })
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-html_1")).toBeInTheDocument()
		})

		if (onResponseHandler) {
			onResponseHandler(mkOp("__clear", "clear"))
		}

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("0")
			expect(screen.getByTestId("active-id").textContent).to.equal("none")
		})
	})

	it("handles remove operation from subscription", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined

		mockGetHtmlPreviewState.mockResolvedValue({
			items: [mk("html_1", "Preview 1"), mk("html_2", "Preview 2")],
		})
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("2")
		})

		if (onResponseHandler) {
			onResponseHandler(mkOp("html_1", "remove"))
		}

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("1")
			expect(screen.queryByTestId("item-html_1")).not.toBeInTheDocument()
			expect(screen.getByTestId("item-html_2")).toBeInTheDocument()
		})
	})

	it("keeps a streamed preview when an older empty snapshot arrives after it", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined
		let resolveSnapshot: ((value: { items: HtmlPreviewItem[] }) => void) | undefined
		// The host answered the state request before the preview existed, but the reply is
		// delivered only after the host has already streamed the preview.
		mockGetHtmlPreviewState.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSnapshot = resolve
				}),
		)
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)
		await waitFor(() => expect(onResponseHandler).toBeDefined())
		await waitFor(() => expect(resolveSnapshot).toBeDefined())

		await act(async () => {
			onResponseHandler?.(mk("html_1", "Streamed"))
		})
		await waitFor(() => expect(screen.getByTestId("item-count").textContent).to.equal("1"))

		await act(async () => {
			resolveSnapshot?.({ items: [] })
		})

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("1")
			expect(screen.getByTestId("item-html_1")).toBeInTheDocument()
		})
	})

	it("does not resurrect a preview removed while a snapshot was in flight", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined
		let resolveSnapshot: ((value: { items: HtmlPreviewItem[] }) => void) | undefined
		mockGetHtmlPreviewState.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSnapshot = resolve
				}),
		)
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)
		await waitFor(() => expect(resolveSnapshot).toBeDefined())
		await act(async () => {
			onResponseHandler?.(mkOp("html_1", "remove"))
		})
		await act(async () => {
			resolveSnapshot?.({ items: [mk("html_1", "Stale"), mk("html_2", "Kept")] })
		})

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("1")
			expect(screen.queryByTestId("item-html_1")).not.toBeInTheDocument()
		})
	})

	const withAllowance = (id: string, allowed: boolean): HtmlPreviewItem => ({
		...mk(id, id),
		metadata: { trustSource: "learning-pack", executionAllowed: allowed ? "true" : "false" },
	})
	const AllowanceConsumer: React.FC = () => {
		const { items, refreshItems } = useHtmlPreviewContext()
		return (
			<div>
				<div data-testid="allowed">{items.map((i) => i.metadata?.executionAllowed ?? "-").join(",") || "empty"}</div>
				<button data-testid="refresh" onClick={() => void refreshItems()}>
					refresh
				</button>
			</div>
		)
	}

	it("ignores an older snapshot reply that arrives after a newer one", async () => {
		const resolvers: Array<(value: { items: HtmlPreviewItem[] }) => void> = []
		mockGetHtmlPreviewState.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)))
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<AllowanceConsumer />
			</HtmlPreviewContextProvider>,
		)
		await waitFor(() => expect(resolvers.length).toBe(1))
		fireEvent.click(screen.getByTestId("refresh"))
		await waitFor(() => expect(resolvers.length).toBe(2))

		// Newer reply (revoked) lands first, then the older one (allowed) is delivered late.
		await act(async () => {
			resolvers[1]({ items: [withAllowance("html_1", false)] })
		})
		await waitFor(() => expect(screen.getByTestId("allowed").textContent).to.equal("false"))
		await act(async () => {
			resolvers[0]({ items: [withAllowance("html_1", true)] })
		})
		expect(screen.getByTestId("allowed").textContent).to.equal("false")
	})

	it("does not let a replayed stream upsert re-allow an item the snapshot shows revoked", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined
		let resolveSnapshot: ((value: { items: HtmlPreviewItem[] }) => void) | undefined
		mockGetHtmlPreviewState.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSnapshot = resolve
				}),
		)
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})

		render(
			<HtmlPreviewContextProvider>
				<AllowanceConsumer />
			</HtmlPreviewContextProvider>,
		)
		await waitFor(() => expect(resolveSnapshot).toBeDefined())
		// An older "allowed" item streams in before the (newer) revoked snapshot arrives.
		await act(async () => {
			onResponseHandler?.(withAllowance("html_1", true))
		})
		await act(async () => {
			resolveSnapshot?.({ items: [withAllowance("html_1", false)] })
		})
		expect(screen.getByTestId("allowed").textContent).to.equal("false")
	})

	it("still shows a live re-allow streamed after the list has settled", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined
		mockGetHtmlPreviewState.mockResolvedValue({ items: [withAllowance("html_1", false)] })
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})
		render(
			<HtmlPreviewContextProvider>
				<AllowanceConsumer />
			</HtmlPreviewContextProvider>,
		)
		await waitFor(() => expect(screen.getByTestId("allowed").textContent).to.equal("false"))
		await act(async () => {
			onResponseHandler?.(withAllowance("html_1", true))
		})
		expect(screen.getByTestId("allowed").textContent).to.equal("true")
	})
})
