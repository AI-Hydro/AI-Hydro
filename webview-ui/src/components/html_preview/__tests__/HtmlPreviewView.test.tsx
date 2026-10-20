import { StringRequest } from "@shared/proto/cline/common"
import { type HtmlPreviewItem, HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import HtmlPreviewView, { sanitizeFrameDiag } from "../HtmlPreviewView"

const copyToClipboardMock = vi.fn().mockResolvedValue({})
const openUrlMock = vi.fn().mockResolvedValue({})
const openFileMock = vi.fn().mockResolvedValue({})
const runArtifactCodeMock = vi.fn().mockResolvedValue({
	stdout: "42\n",
	stderr: "",
	status: "ok",
	error: "",
	resultRepr: "",
})
const getArtifactKernelInfoMock = vi.fn().mockResolvedValue({
	artifactId: "html_test",
	interpreterPath: "/usr/bin/python3",
	state: 3,
	cwd: "/tmp",
	lastError: "",
	workspaceTrusted: true,
	kernelDirty: false,
	executionCount: 0,
})
const restartArtifactKernelMock = vi.fn().mockResolvedValue({})
const interruptArtifactKernelMock = vi.fn().mockResolvedValue({ recovered: true, error: "" })
const listPythonEnvironmentsMock = vi.fn().mockResolvedValue({
	environments: [{ profileId: "profile_1", interpreterPath: "/usr/bin/python3", label: "PATH: python3", cwd: "/tmp" }],
	activeProfileId: "profile_1",
})
const setExecutionAllowanceMock = vi.fn().mockResolvedValue({ allowed: true })
const startPreviewAgentTaskMock = vi.fn().mockResolvedValue({ ok: true })
const setArtifactKernelProfileMock = vi.fn().mockResolvedValue({})
const probePythonEnvironmentMock = vi.fn().mockResolvedValue({ stdout: '{"ok":true}', status: "ok", stderr: "", error: "" })

vi.mock("../previewBridge", async (importOriginal) => ({
	...(await importOriginal<typeof import("../previewBridge")>()),
	startPreviewAgentTask: (...args: unknown[]) => startPreviewAgentTaskMock(...args),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		copyToClipboard: (...args: unknown[]) => copyToClipboardMock(...args),
		openFile: (...args: unknown[]) => openFileMock(...args),
	},
	UiServiceClient: {
		openUrl: (...args: unknown[]) => openUrlMock(...args),
	},
	HtmlPreviewServiceClient: {
		setArtifactExecutionAllowance: (...args: unknown[]) => setExecutionAllowanceMock(...args),
		runArtifactCode: (...args: unknown[]) => runArtifactCodeMock(...args),
		getArtifactKernelInfo: (...args: unknown[]) => getArtifactKernelInfoMock(...args),
		restartArtifactKernel: (...args: unknown[]) => restartArtifactKernelMock(...args),
		listPythonEnvironments: (...args: unknown[]) => listPythonEnvironmentsMock(...args),
		setArtifactKernelProfile: (...args: unknown[]) => setArtifactKernelProfileMock(...args),
		probePythonEnvironment: (...args: unknown[]) => probePythonEnvironmentMock(...args),
		interruptArtifactKernel: (...args: unknown[]) => interruptArtifactKernelMock(...args),
	},
}))

const baseItem: HtmlPreviewItem = {
	id: "html_test",
	title: "Test Preview",
	htmlContent: "",
	filePath: "/abs/path/to/test.html",
	interactive: false,
	metadata: { source: "file" },
	webviewUri: "https://example.vscode-cdn.net/file/abs/path/to/test.html?h=abc12345",
	dirUri: "https://example.vscode-cdn.net/file/abs/path/to",
	contentHash: "abc12345deadbeef",
	resolvedMode: HtmlPreviewMode.INTERACTIVE,
}

const inlineItem: HtmlPreviewItem = {
	...baseItem,
	id: "html_test_inline",
	htmlContent: "<!doctype html><html><body><h1>hello</h1></body></html>",
}

// Host-assigned trust metadata (the webview only displays it; the host enforces).
const trustedAllowedItem: HtmlPreviewItem = {
	...inlineItem,
	id: "html_trusted",
	metadata: { ...inlineItem.metadata, trustSource: "learning-pack", executionAllowed: "true" },
}
const trustedNotAllowedItem: HtmlPreviewItem = {
	...trustedAllowedItem,
	metadata: { ...inlineItem.metadata, trustSource: "learning-pack", executionAllowed: "false" },
}
const unsignedItem: HtmlPreviewItem = {
	...inlineItem,
	id: "html_unsigned",
	// A spoofed allowance on an untrusted source must not enable anything.
	metadata: { ...inlineItem.metadata, trustSource: "unsigned-module", executionAllowed: "true" },
}

function postFromIframe(iframe: HTMLIFrameElement, data: Record<string, unknown>) {
	const postMessage = vi.fn()
	Object.defineProperty(iframe, "contentWindow", { value: { postMessage }, configurable: true })
	const event = new MessageEvent("message", { data })
	Object.defineProperty(event, "source", { value: iframe.contentWindow, configurable: true })
	window.dispatchEvent(event)
	return postMessage
}

// Low-frequency toolbar actions (diagnostics, copy path, open in editor/browser,
// reload, restart kernel, remove) live behind the "More actions" kebab menu
// (see HtmlPreviewToolbar.tsx's kebabItems) rather than as directly-titled
// buttons. Items render as visible text, not a `title` attribute.
function openKebabMenu() {
	fireEvent.click(screen.getByTitle("More actions"))
}

describe("HtmlPreviewView", () => {
	it("renders empty state when no item is provided", () => {
		render(<HtmlPreviewView />)
		expect(screen.getByText("No document open in AI-Hydro Studio")).toBeInTheDocument()
	})

	it("falls back to src=item.webviewUri when htmlContent is empty", () => {
		render(<HtmlPreviewView item={baseItem} />)
		const iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe).toBeInTheDocument()
		expect(iframe.getAttribute("src")).to.equal(baseItem.webviewUri)
		expect(iframe.getAttribute("srcdoc")).to.equal(null)
	})

	it("prefers srcdoc when htmlContent is present", () => {
		render(<HtmlPreviewView item={inlineItem} />)
		const iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("srcdoc")).to.contain("<h1>hello</h1>")
		expect(iframe.getAttribute("src")).to.equal(null)
	})

	it("applies the host-owned CSP only to installed Learning Pack srcdoc", () => {
		const authored =
			'<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>pack</body></html>'
		const packItem = {
			...inlineItem,
			htmlContent: authored,
			metadata: { ...inlineItem.metadata, artifactKind: "learning-pack-v1" },
		}
		const { rerender } = render(<HtmlPreviewView item={packItem} />)
		let iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		const securedSrcdoc = iframe.getAttribute("srcdoc") ?? ""
		expect(securedSrcdoc).to.contain("default-src 'none'")
		expect(securedSrcdoc).not.to.contain("default-src *")
		expect(securedSrcdoc.indexOf("Content-Security-Policy")).to.be.lessThan(securedSrcdoc.indexOf("<script"))

		rerender(<HtmlPreviewView item={{ ...inlineItem, htmlContent: authored }} />)
		iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("srcdoc")).to.contain("default-src *")
	})

	it("skips the Google Fonts network request for a generic artifact and for an installed pack", () => {
		// CSS ownership boundary (PR 4): a plain report or Folium map never
		// references .aihydro-* classes, and an installed pack is offline-
		// capable — neither should pay for the font <link> network request.
		const plainReport = { ...inlineItem, htmlContent: "<html><head></head><body><h1>Report</h1></body></html>" }
		const { rerender } = render(<HtmlPreviewView item={plainReport} />)
		let iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("srcdoc")).not.to.contain("fonts.googleapis.com")

		const packItem = {
			...inlineItem,
			htmlContent: '<html><body class="aihydro-module">pack content</body></html>',
			metadata: { ...inlineItem.metadata, artifactKind: "learning-pack-v1" },
		}
		rerender(<HtmlPreviewView item={packItem} />)
		iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("srcdoc")).not.to.contain("fonts.googleapis.com")

		// A genuine, non-pack AI-Hydro module DOES get the branded fonts.
		const module = { ...inlineItem, htmlContent: '<html><body class="aihydro-module">module content</body></html>' }
		rerender(<HtmlPreviewView item={module} />)
		iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("srcdoc")).to.contain("fonts.googleapis.com")
	})

	it("uses a single sandboxed profile: scripts allowed, never same-origin with the shell", () => {
		render(<HtmlPreviewView item={baseItem} />)
		const iframe = screen.getByTitle("Test Preview") as HTMLIFrameElement
		expect(iframe.getAttribute("sandbox")).to.equal("allow-scripts allow-popups allow-forms allow-modals")
		expect(iframe.getAttribute("sandbox")).not.to.contain("allow-same-origin")
	})

	it("does not expose safe/interactive mode toggles", () => {
		render(<HtmlPreviewView item={baseItem} />)
		expect(screen.queryByText("Safe")).not.toBeInTheDocument()
		expect(screen.queryByText("Interactive")).not.toBeInTheDocument()
		expect(screen.queryByTitle(/Switch to (safe|interactive) mode/i)).not.toBeInTheDocument()
	})

	it("shows technical diagnostics only when Details is clicked", () => {
		render(<HtmlPreviewView item={inlineItem} />)
		expect(screen.queryByText(/PREVIEW/)).not.toBeInTheDocument()
		openKebabMenu()
		fireEvent.click(screen.getByText("Show diagnostics"))
		expect(screen.getByText(/PREVIEW/)).toBeInTheDocument()
	})

	it("displays title in the toolbar", () => {
		render(<HtmlPreviewView item={baseItem} />)
		expect(screen.getAllByText("Test Preview").length).toBeGreaterThan(0)
	})

	it("copies the file path via the extension clipboard API", async () => {
		copyToClipboardMock.mockClear()
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Copy file path"))
		expect(copyToClipboardMock).toHaveBeenCalled()
		const req = copyToClipboardMock.mock.calls[0][0] as ReturnType<typeof StringRequest.create>
		expect(req.value).to.equal(baseItem.filePath)
		openKebabMenu()
		expect(await screen.findByText("Path copied!")).toBeInTheDocument()
	})

	it("opens the source file in the default browser via the extension", () => {
		openUrlMock.mockClear()
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Open in external browser"))
		expect(openUrlMock).toHaveBeenCalled()
		const req = openUrlMock.mock.calls[0][0] as ReturnType<typeof StringRequest.create>
		expect(req.value).to.equal(baseItem.filePath)
	})

	it("opens the source file in VS Code", () => {
		openFileMock.mockClear()
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Open source in editor"))
		expect(openFileMock).toHaveBeenCalled()
	})

	it("dispatches htmlPreviewClear on Clear click", () => {
		const spy = vi.spyOn(window, "dispatchEvent")
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		fireEvent.click(screen.getByText("Remove this preview"))
		const evt = spy.mock.calls[spy.mock.calls.length - 1][0] as CustomEvent
		expect(evt.type).to.equal("htmlPreviewClear")
		expect(evt.detail).to.deep.equal({ id: "html_test" })
		spy.mockRestore()
	})

	it("remounts the iframe with a new key after Refresh", () => {
		render(<HtmlPreviewView item={baseItem} />)
		const before = screen.getByTitle("Test Preview")
		openKebabMenu()
		fireEvent.click(screen.getByText("Reload preview iframe"))
		const after = screen.getByTitle("Test Preview")
		expect(after).toBeInTheDocument()
		expect(after).not.to.equal(before)
	})

	it("shows a helpful message when webviewUri is missing", () => {
		const item: HtmlPreviewItem = { ...baseItem, webviewUri: "", htmlContent: "" }
		render(<HtmlPreviewView item={item} />)
		expect(screen.getByText("The extension has not yet supplied a webview URI for this artifact.")).toBeInTheDocument()
	})

	it("forwards artifact/runCode postMessage to gRPC and replies to the iframe", async () => {
		runArtifactCodeMock.mockClear()
		const { container } = render(<HtmlPreviewView item={trustedAllowedItem} />)
		const iframe = container.querySelector("iframe") as HTMLIFrameElement
		expect(iframe).toBeTruthy()

		const postMessage = vi.fn()
		Object.defineProperty(iframe, "contentWindow", {
			value: { postMessage },
			configurable: true,
		})

		const event = new MessageEvent("message", {
			data: {
				source: "aihydro-artifact",
				type: "artifact/runCode",
				language: "python",
				code: "print(42)",
			},
		})
		Object.defineProperty(event, "source", { value: iframe.contentWindow, configurable: true })
		window.dispatchEvent(event)

		await vi.waitFor(() => {
			expect(runArtifactCodeMock).toHaveBeenCalled()
		})

		await vi.waitFor(() => {
			expect(postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "artifact/runCodeResult",
					stdout: "42\n",
					status: "ok",
				}),
				"*",
			)
		})
	})

	it("shows kernel restart in the toolbar", () => {
		render(<HtmlPreviewView item={baseItem} />)
		openKebabMenu()
		expect(screen.getByText("Restart kernel")).toBeInTheDocument()
	})

	it("shows Run Cell control in the toolbar", () => {
		render(<HtmlPreviewView item={baseItem} />)
		expect(screen.getAllByTitle(/Run focused cell \(or first cell\)|No Python cells detected/).length).toBeGreaterThan(0)
	})

	describe("execution trust gate", () => {
		const runCodeMessage = { source: "aihydro-artifact", type: "artifact/runCode", language: "python", code: "print(1)" }

		it("injects no kernel bridge into a static document", () => {
			render(<HtmlPreviewView item={inlineItem} />)
			const srcdoc = (screen.getByTitle("Test Preview") as HTMLIFrameElement).getAttribute("srcdoc") ?? ""
			expect(srcdoc).not.to.contain("artifact/runCode")
			expect(screen.getByTestId("artifact-trust-badge")).toHaveTextContent("Static document")
			expect(screen.getByText(/This is a static document\./)).toBeInTheDocument()
		})

		it("injects the kernel bridge only once a trusted document is allowed", () => {
			const { rerender } = render(<HtmlPreviewView item={trustedNotAllowedItem} />)
			let srcdoc = (screen.getByTitle("Test Preview") as HTMLIFrameElement).getAttribute("srcdoc") ?? ""
			expect(srcdoc).not.to.contain("artifact/runCode")
			rerender(<HtmlPreviewView item={trustedAllowedItem} />)
			srcdoc = (screen.getByTitle("Test Preview") as HTMLIFrameElement).getAttribute("srcdoc") ?? ""
			expect(srcdoc).to.contain("artifact/runCode")
		})

		it("never forwards runCode from a static document, even if the document posts it", async () => {
			runArtifactCodeMock.mockClear()
			const { container } = render(<HtmlPreviewView item={inlineItem} />)
			const reply = postFromIframe(container.querySelector("iframe") as HTMLIFrameElement, runCodeMessage)
			await vi.waitFor(() =>
				expect(reply).toHaveBeenCalledWith(
					expect.objectContaining({ type: "artifact/runCodeResult", status: "denied" }),
					"*",
				),
			)
			expect(runArtifactCodeMock).not.toHaveBeenCalled()
		})

		it("never forwards runCode from an unsigned module, labels it unsigned, and ignores a spoofed allowance", async () => {
			runArtifactCodeMock.mockClear()
			const { container } = render(<HtmlPreviewView item={unsignedItem} />)
			expect(screen.getByTestId("artifact-trust-badge")).toHaveTextContent("Unsigned module")
			expect(screen.queryByTestId("artifact-trust-allow")).not.toBeInTheDocument()
			expect(screen.queryByTestId("artifact-trust-revoke")).not.toBeInTheDocument()
			postFromIframe(container.querySelector("iframe") as HTMLIFrameElement, runCodeMessage)
			await Promise.resolve()
			expect(runArtifactCodeMock).not.toHaveBeenCalled()
		})

		it("does not forward runCode from a trusted document the user has not allowed", async () => {
			runArtifactCodeMock.mockClear()
			const { container } = render(<HtmlPreviewView item={trustedNotAllowedItem} />)
			postFromIframe(container.querySelector("iframe") as HTMLIFrameElement, runCodeMessage)
			await Promise.resolve()
			expect(runArtifactCodeMock).not.toHaveBeenCalled()
		})

		it("shows Allow for a trusted document and asks the host to allow it on click", async () => {
			setExecutionAllowanceMock.mockClear()
			render(<HtmlPreviewView item={trustedNotAllowedItem} />)
			expect(screen.getByTestId("artifact-trust-badge")).toHaveTextContent("Trusted, execution off")
			fireEvent.click(screen.getByTestId("artifact-trust-allow"))
			await vi.waitFor(() => expect(setExecutionAllowanceMock).toHaveBeenCalled())
			const req = setExecutionAllowanceMock.mock.calls[0][0] as { artifactId: string; allowed: boolean }
			expect(req).toMatchObject({ artifactId: "html_trusted", allowed: true })
		})

		it("shows a visible badge and a Revoke action once allowed", async () => {
			setExecutionAllowanceMock.mockClear()
			render(<HtmlPreviewView item={trustedAllowedItem} />)
			expect(screen.getByTestId("artifact-trust-badge")).toHaveTextContent("Execution allowed")
			fireEvent.click(screen.getByTestId("artifact-trust-revoke"))
			await vi.waitFor(() => expect(setExecutionAllowanceMock).toHaveBeenCalled())
			expect(setExecutionAllowanceMock.mock.calls[0][0]).toMatchObject({ artifactId: "html_trusted", allowed: false })
		})

		describe("agent hand-off", () => {
			const batchMessage = {
				type: "aihydro-preview-event",
				kind: "user.batch_changes",
				payloadJson: JSON.stringify({ changes: [{}, {}] }),
			}

			it("does not start an agent task from a document; it stages the prompt for a user click", async () => {
				startPreviewAgentTaskMock.mockClear()
				const { container } = render(<HtmlPreviewView item={trustedAllowedItem} />)
				postFromIframe(container.querySelector("iframe") as HTMLIFrameElement, batchMessage)
				const prompt = await screen.findByTestId("agent-handoff-prompt-text")
				expect(prompt).toHaveTextContent("The user has submitted 2 changes")
				expect(startPreviewAgentTaskMock).not.toHaveBeenCalled()

				fireEvent.click(screen.getByTestId("agent-handoff-send"))
				await vi.waitFor(() => expect(startPreviewAgentTaskMock).toHaveBeenCalledTimes(1))
				expect(startPreviewAgentTaskMock.mock.calls[0][0]).toContain("The user has submitted 2 changes")
				// The host re-checks trust per document, so the artifact id travels with the request.
				expect(startPreviewAgentTaskMock.mock.calls[0][1]).toBe("html_trusted")
			})

			it("dismissing the staged prompt sends nothing", async () => {
				startPreviewAgentTaskMock.mockClear()
				const { container } = render(<HtmlPreviewView item={trustedAllowedItem} />)
				postFromIframe(container.querySelector("iframe") as HTMLIFrameElement, batchMessage)
				await screen.findByTestId("agent-handoff-prompt")
				fireEvent.click(screen.getByTestId("agent-handoff-dismiss"))
				expect(screen.queryByTestId("agent-handoff-prompt")).not.toBeInTheDocument()
				expect(startPreviewAgentTaskMock).not.toHaveBeenCalled()
			})

			it("offers no prompt at all for a static document", async () => {
				startPreviewAgentTaskMock.mockClear()
				const { container } = render(<HtmlPreviewView item={inlineItem} />)
				postFromIframe(container.querySelector("iframe") as HTMLIFrameElement, batchMessage)
				expect(await screen.findByTestId("agent-handoff-notice")).toBeInTheDocument()
				expect(screen.queryByTestId("agent-handoff-prompt")).not.toBeInTheDocument()
				expect(startPreviewAgentTaskMock).not.toHaveBeenCalled()
			})

			it("does not stage a prompt for a trusted document that is not allowed", async () => {
				const { container } = render(<HtmlPreviewView item={trustedNotAllowedItem} />)
				postFromIframe(container.querySelector("iframe") as HTMLIFrameElement, batchMessage)
				expect(await screen.findByTestId("agent-handoff-notice")).toBeInTheDocument()
				expect(screen.queryByTestId("agent-handoff-prompt")).not.toBeInTheDocument()
			})
		})
	})
})

describe("frame diagnostics over postMessage", () => {
	it("coerces a hostile or malformed reply into clamped plain data", () => {
		const hostile = sanitizeFrameDiag({
			scriptCount: "many",
			scriptSrcs: ["a".repeat(5000), 7, { toString: () => "x" }],
			bodySize: Number.POSITIVE_INFINITY,
			errors: new Array(50).fill("e"),
			diagInstalled: "yes",
			leafletPresent: 1,
		})
		expect(hostile.scriptCount).to.equal(0)
		expect(hostile.scriptSrcs).to.have.length(1)
		expect(hostile.scriptSrcs[0]).to.have.length(400)
		expect(hostile.bodySize).to.equal(0)
		expect(hostile.errors).to.have.length(6)
		expect(hostile.diagInstalled).to.equal(false)
		expect(hostile.leafletPresent).to.equal(false)
	})

	it("treats a non-object reply as an error state", () => {
		expect(sanitizeFrameDiag(null).errors[0]).to.match(/malformed/)
	})
})
