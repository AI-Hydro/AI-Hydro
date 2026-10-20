import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page, test } from "@playwright/test"
import { allowArtifactExecution, E2ETestHelper, e2e, writeUserSettings } from "./utils/helpers"

const runtimeE2E = e2e.extend<{ workspaceDir: string; e2eTrustedPaths: string[] }>({
	// The executable fixtures stand in for trusted modules. index.html, untrusted-runcode.html
	// and quarto-fidelity are deliberately NOT listed, so they stay static documents.
	e2eTrustedPaths: async ({ workspaceDir }, use) => {
		await use([
			path.join(workspaceDir, "phase0", "golden-course"),
			path.join(workspaceDir, "phase0", "standalone-module.html"),
			path.join(workspaceDir, "phase0", "interrupt-module.html"),
			path.join(workspaceDir, "phase0", "trusted-forge.html"),
		])
	},
	workspaceDir: async ({ userDataDir }, use) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase0-workspace-"))
		const workspaceDir = path.join(root, "workspace")
		const baseWorkspace = path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace")
		const phase0Fixtures = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "fixtures", "html-preview")
		cpSync(baseWorkspace, workspaceDir, { recursive: true })
		mkdirSync(path.join(workspaceDir, "phase0"), { recursive: true })
		cpSync(path.join(phase0Fixtures, "golden-course"), path.join(workspaceDir, "phase0", "golden-course"), {
			recursive: true,
		})
		cpSync(path.join(phase0Fixtures, "standalone-module.html"), path.join(workspaceDir, "phase0", "standalone-module.html"))
		cpSync(path.join(phase0Fixtures, "interrupt-module.html"), path.join(workspaceDir, "phase0", "interrupt-module.html"))
		cpSync(path.join(phase0Fixtures, "untrusted-runcode.html"), path.join(workspaceDir, "phase0", "untrusted-runcode.html"))
		cpSync(path.join(phase0Fixtures, "trusted-forge.html"), path.join(workspaceDir, "phase0", "trusted-forge.html"))
		cpSync(path.join(phase0Fixtures, "quarto-fidelity"), path.join(workspaceDir, "phase0", "quarto-fidelity"), {
			recursive: true,
		})

		const pythonInterpreter = process.env.AIHYDRO_E2E_PYTHON
		if (!pythonInterpreter) {
			throw new Error("AIHYDRO_E2E_PYTHON must point to the deterministic test interpreter")
		}
		// Kernel interpreter/execution settings are machine scope: a repository's
		// .vscode/settings.json cannot set them, so they go in the user profile.
		writeUserSettings(userDataDir, {
			"aihydro.htmlPreview.pythonExecution": "always",
			"aihydro.htmlPreview.pythonInterpreter": pythonInterpreter,
			"aihydro.htmlPreview.pythonTimeoutSeconds": 60,
		})
		try {
			await use(workspaceDir)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
})

runtimeE2E.describe.configure({ mode: "serial" })
runtimeE2E.setTimeout(180_000)
runtimeE2E.skip(
	!process.env.AIHYDRO_E2E_PYTHON,
	"Phase 0 runtime tests require AIHYDRO_E2E_PYTHON to select the deterministic test interpreter",
)

/**
 * Open a quick-input (Quick Open or the command palette) and wait until it lists `rowText`
 * for the typed `text`.
 *
 * Neither step is a deterministic one-shot on a loaded hosted runner: the
 * shortcut is dropped while the workbench (or the just-focused sidebar
 * webview, which forwards keys to the host asynchronously) is not yet taking
 * key bindings, and the picker can open before the workspace file index
 * answers, leaving an empty list. Both are retried against the real signal
 * (widget visible / matching row visible) instead of one long blind wait.
 */
async function openQuickInputWithRow(page: Page, shortcut: string, text: string, rowText: string): Promise<Locator> {
	const quickOpenInput = page.locator(".quick-input-widget input:visible").last()
	const file = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: rowText }).first()
	let lastError: unknown
	for (let attempt = 1; attempt <= 4; attempt++) {
		// After the sidebar is focused through the extension host, keyboard focus sits inside a
		// webview guest frame, which only forwards key bindings to the workbench once its own
		// content is ready. Hand focus back to the workbench document before pressing.
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
		await page.keyboard.press(shortcut)
		try {
			await quickOpenInput.waitFor({ state: "visible", timeout: 10_000 })
			await quickOpenInput.fill(text)
			await expect(file).toBeVisible({ timeout: 15_000 })
			if (attempt > 1) {
				// Keep flake frequency visible in CI instead of silently absorbing it.
				const description = `quick input "${text}" needed ${attempt} attempts (${shortcut})`
				test.info().annotations.push({ type: "quick-input-retry", description })
				console.warn(`quick-input-retry: ${description}`)
			}
			return quickOpenInput
		} catch (error) {
			lastError = error
			// Close whatever half-open state remains so the next attempt starts clean.
			await page.keyboard.press("Escape")
			await expect(quickOpenInput)
				.not.toBeVisible({ timeout: 5_000 })
				.catch(() => undefined)
		}
	}
	throw lastError
}

/** True once the frame's current document has finished loading (scripts parsed and run). */
async function isDocumentComplete(frame: Frame): Promise<boolean> {
	return (await frame.evaluate(() => document.readyState)) === "complete"
}

async function openWorkspaceFile(page: Page, relativePath: string, confirmPlainHtml = false): Promise<void> {
	await page.waitForLoadState("domcontentloaded")
	await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 20_000 })
	await E2ETestHelper.openAiHydroSidebar(page)
	await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
	const quickOpenInput = await openQuickInputWithRow(
		page,
		process.platform === "darwin" ? "Meta+P" : "Control+P",
		relativePath,
		path.basename(relativePath),
	)
	// Keyboard acceptance is the stable Quick Open contract across hosted
	// platforms. A synthetic row click can select the result without opening
	// the document on Windows, so the extension never observes the HTML file.
	await page.keyboard.press("Enter")
	await expect(quickOpenInput).not.toBeVisible({ timeout: 10_000 })
	if (confirmPlainHtml) {
		const commandInput = await openQuickInputWithRow(
			page,
			"F1",
			">Add to AI-Hydro HTML Preview",
			"Add to AI-Hydro HTML Preview",
		)
		await page.keyboard.press("Enter")
		await expect(commandInput).not.toBeVisible({ timeout: 10_000 })
	}
}

async function waitForFrame(page: Page, predicate: (frame: Frame) => Promise<boolean>, timeout = 30_000): Promise<Frame> {
	let match: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if (frame.isDetached()) {
						continue
					}
					try {
						if (await predicate(frame)) {
							match = frame
							return true
						}
					} catch {
						// Frames can be replaced while the preview shell refreshes.
					}
				}
				return false
			},
			{ timeout },
		)
		.toBe(true)
	return match as Frame
}

async function waitForShell(page: Page): Promise<Frame> {
	return waitForFrame(page, async (frame) => (await frame.title()) === "AI-Hydro HTML Preview")
}

async function waitForShellWithSrcdoc(page: Page, marker: string, timeout = 30_000): Promise<Frame> {
	return waitForFrame(
		page,
		async (frame) => {
			if ((await frame.title()) !== "AI-Hydro HTML Preview") {
				return false
			}
			const srcdoc = await frame.locator("iframe").first().getAttribute("srcdoc")
			return srcdoc?.includes(marker) ?? false
		},
		timeout,
	)
}

async function countCourseOptions(page: Page): Promise<number> {
	for (const frame of page.frames()) {
		if (frame.isDetached()) {
			continue
		}
		try {
			if ((await frame.title()) === "AI-Hydro HTML Preview") {
				return frame.getByTitle("Course options").count()
			}
		} catch {
			// The provider replaces its frame while switching artifacts.
		}
	}
	return 0
}

async function waitForCourseShell(page: Page): Promise<Frame> {
	return waitForFrame(page, async (frame) => {
		if ((await frame.title()) !== "AI-Hydro HTML Preview") {
			return false
		}
		if ((await frame.getByTitle("Course options").count()) !== 1) {
			return false
		}
		const srcdoc = await frame.locator("iframe").first().getAttribute("srcdoc")
		return srcdoc?.includes("application/vnd.aihydro.module+json") ?? false
	})
}

async function waitForCellFrame(page: Page, cellId: string): Promise<Frame> {
	// Executable documents need an explicit per-document allowance (trust bar) before
	// the kernel bridge is injected; the iframe reloads once it is granted.
	await allowArtifactExecution(page, cellId)
	// The Run button is created by scripts that run while the document parses,
	// so a cell node alone does not mean the bridge exists yet: wait for load.
	return waitForFrame(
		page,
		async (frame) =>
			(await frame.locator(`[data-aihydro-cell-id="${cellId}"]`).count()) === 1 && (await isDocumentComplete(frame)),
	)
}

async function runCell(frame: Frame, cellId: string): Promise<void> {
	const cell = frame.locator(`[data-aihydro-cell-id="${cellId}"]`)
	const run = cell.locator(".aihydro-run")
	await expect(run).toBeVisible({ timeout: 30_000 })
	await expect(run).toHaveAttribute("data-aihydro-wired", "1", { timeout: 30_000 })
	// VS Code's built-in Chat pane and startup toasts can overlap a narrow
	// preview group on hosted macOS. Invoke the wired DOM control directly so
	// layout overlays cannot swallow the event while preserving the real bridge.
	await run.evaluate((element: HTMLElement) => element.click())
}

async function expectPngOutput(cell: Locator): Promise<void> {
	const image = cell.locator('.aihydro-output-images img[src^="data:image/png;base64,"]').first()
	await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/, { timeout: 60_000 })
	const source = await image.getAttribute("src")
	expect(source?.length ?? 0).toBeGreaterThan(1_000)
}

runtimeE2E("HTML Preview executes the golden runtime matrix @phase0-full", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())

	await openWorkspaceFile(page, "phase0/golden-course/01-runtime-contract/module.html")
	let shell = await waitForCourseShell(page)
	// CSS ownership boundary (PR 4): a genuine AI-Hydro module gets the
	// branded design-system fonts (requests to fonts.googleapis.com are
	// aborted above, purely to keep this test network-independent — the
	// assertion is on the injected srcdoc string, not on the request landing).
	expect(await shell.locator("iframe").first().getAttribute("srcdoc")).toContain("fonts.googleapis.com")

	let artifact = await waitForCellFrame(page, "fixture-state-create")
	await runCell(artifact, "fixture-state-create")
	const stateOutput = artifact.locator('[data-aihydro-cell-id="fixture-state-create"] .aihydro-output')
	await expect(stateOutput).toContainText("ending_storage=110.0 mm", { timeout: 60_000 })
	await expect(stateOutput).toContainText("110.0")

	await runCell(artifact, "fixture-state-read-plot")
	const plotCell = artifact.locator('[data-aihydro-cell-id="fixture-state-read-plot"]')
	await expectPngOutput(plotCell)

	await runCell(artifact, "fixture-error")
	await expect(artifact.locator('[data-aihydro-cell-id="fixture-error"] .aihydro-output')).toContainText(
		"intentional runtime-contract fixture error",
		{ timeout: 30_000 },
	)
	await expect(shell.locator("iframe")).toBeVisible()

	await shell.getByTitle("More actions").click()
	await shell.getByRole("menuitem", { name: "Restart kernel" }).click()
	await runCell(artifact, "fixture-state-read-plot")
	await expect(plotCell.locator(".aihydro-output")).toContainText(/storage_next|not defined/, { timeout: 30_000 })
	await runCell(artifact, "fixture-state-create")
	await expect(stateOutput).toContainText("ending_storage=110.0 mm", { timeout: 30_000 })
	await runCell(artifact, "fixture-state-read-plot")
	await expectPngOutput(plotCell)

	await openWorkspaceFile(page, "phase0/interrupt-module.html")
	shell = await waitForShell(page)
	artifact = await waitForCellFrame(page, "interrupt-ready")
	await runCell(artifact, "interrupt-ready")
	await expect(artifact.locator('[data-aihydro-cell-id="interrupt-ready"] .aihydro-output')).toContainText(
		"interrupt_kernel_ready",
		{ timeout: 60_000 },
	)
	await runCell(artifact, "interrupt-sleep")
	const runningShell = await waitForFrame(page, async (frame) => (await frame.getByTitle("Interrupt execution").count()) === 1)
	const stop = runningShell.getByTitle("Interrupt execution")
	await expect(stop).toBeEnabled({ timeout: 30_000 })
	await stop.click()
	await expect(artifact.locator('[data-aihydro-cell-id="interrupt-sleep"] .aihydro-output')).toContainText(
		"Interrupted by user",
		{ timeout: 30_000 },
	)

	await openWorkspaceFile(page, "index.html", true)
	await waitForFrame(page, async (frame) => (await frame.getByRole("heading", { name: "Test Workspace" }).count()) === 1)
	await expect.poll(async () => countCourseOptions(page), { timeout: 30_000 }).toBe(0)
	// A plain static doc (no executable module manifest) shows the
	// static-document explanation in the shell (PR 3 / brief §8.2). The notice
	// lives in the React shell frame, not the artifact iframe.
	const staticShell = await waitForShell(page)
	await expect(staticShell.getByText("This is a static document.", { exact: false })).toBeVisible({ timeout: 15_000 })
	// CSS ownership boundary (PR 4): a plain document that never references
	// .aihydro-* classes gets no branded fonts — it shouldn't pay for the
	// network request the executable module above legitimately needs.
	expect(await staticShell.locator("iframe").first().getAttribute("srcdoc")).not.toContain("fonts.googleapis.com")
	// The badge states what is enforced: a static document has no kernel bridge at all and
	// offers no way to allow one.
	await expect(staticShell.getByTestId("artifact-trust-badge")).toHaveText("Static document")
	await expect(staticShell.getByTestId("artifact-trust-allow")).toHaveCount(0)
	expect(await staticShell.locator("iframe").first().getAttribute("srcdoc")).not.toContain("artifact/cellRegistry")

	await openWorkspaceFile(page, "phase0/standalone-module.html")
	artifact = await waitForCellFrame(page, "standalone-python")
	await waitForShellWithSrcdoc(page, "standalone-runtime-fixture")
	await expect.poll(async () => countCourseOptions(page), { timeout: 30_000 }).toBe(0)
	await runCell(artifact, "standalone-python")
	const standaloneOutput = artifact.locator('[data-aihydro-cell-id="standalone-python"] .aihydro-output')
	await expect(standaloneOutput).toContainText("standalone_execution=ok", { timeout: 30_000 })
	await expect(standaloneOutput).toContainText("42")
})

runtimeE2E("HTML Preview starts and executes a standalone module @phase0-smoke", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())
	await openWorkspaceFile(page, "phase0/standalone-module.html")
	const artifact = await waitForCellFrame(page, "standalone-python")
	await waitForShellWithSrcdoc(page, "standalone-runtime-fixture")
	await expect.poll(async () => countCourseOptions(page), { timeout: 30_000 }).toBe(0)
	await runCell(artifact, "standalone-python")
	const output = artifact.locator('[data-aihydro-cell-id="standalone-python"] .aihydro-output')
	await expect(output).toContainText("standalone_execution=ok", { timeout: 60_000 })
	await expect(output).toContainText("42")
})

runtimeE2E("AI-Hydro: Show Studio opens the panel with the Studio tab label @phase0-smoke", async ({ page }) => {
	await page.waitForLoadState("domcontentloaded")
	await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 20_000 })
	// Activate the development extension before querying its contributed
	// command. Hosted runners can display the workbench before extension
	// contributions have reached the command palette.
	await E2ETestHelper.openAiHydroSidebar(page)
	await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))

	const commandInput = await openQuickInputWithRow(page, "F1", ">AI-Hydro: Show Studio", "AI-Hydro: Show Studio")
	await page.keyboard.press("Enter")
	await expect(commandInput).not.toBeVisible({ timeout: 10_000 })

	// The command is a display-title alias for the same reveal-or-create
	// handler as the "HTML Preview" toolbar button — verify it actually
	// opens the panel. waitForShell's poll already tolerates system-load
	// variance under a full serial suite run; check that first so a slow
	// but successful launch doesn't fail on the tab-label assertion alone.
	await waitForShell(page)
	await expect(page.getByRole("tab", { name: "AI-Hydro Studio", exact: false })).toBeVisible({ timeout: 30_000 })
})

runtimeE2E("HTML Preview injects a correct base href for a multi-file Quarto site @phase0-smoke", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())
	await openWorkspaceFile(page, "phase0/quarto-fidelity/labs/relative-assets.html", true)
	// This is the first interaction in an isolated run of this test (cold
	// matplotlib font-cache build + extension-host activation both land in
	// this window), unlike the shared-fixture tests above that reach this
	// point warmed up — give it double the default poll budget.
	const shell = await waitForShellWithSrcdoc(page, "quarto-fidelity-fixture", 60_000)

	// The generalized base-href injection must produce a trailing-slash base
	// pointed at the artifact's own directory (not one level too high — see
	// artifactBaseHref.ts's trailing-slash rule).
	const srcdoc = await shell.locator("iframe").first().getAttribute("srcdoc")
	const baseMatch = srcdoc?.match(/<base href="([^"]+)">/)
	expect(baseMatch, "srcdoc must contain an injected <base href>").toBeTruthy()
	expect(baseMatch?.[1].endsWith("/")).toBe(true)
	expect(baseMatch?.[1].endsWith("/labs/")).toBe(true)

	// The sibling stylesheet (../site_libs/…) must actually apply. A nested
	// srcdoc iframe cannot fetch a resolved cross-origin vscode-resource:
	// sibling asset at all (verified empirically — even a same-directory
	// sibling 404s regardless of localResourceRoots coverage, and a
	// `src`-navigated nested iframe pointed at the resource scheme directly
	// hits VS Code's own frame protections instead). So the extension inlines
	// the referenced stylesheet into the document text itself
	// (inlineRelativeAssets.ts) — no separate fetch, nothing to block.
	const artifact = await waitForFrame(page, async (frame) => (await frame.locator("h1#title").count()) === 1)
	expect(srcdoc).toContain('data-aihydro-inlined-from="../site_libs/quarto-test/page.css"')
	await expect(artifact.locator("h1#title")).toHaveCSS("color", "rgb(7, 130, 193)")

	// Fragment links must stay in-document under the injected <base>: without
	// the document-level guard, a bare <base> turns "#section-two" into a
	// navigation away from the srcdoc document instead of an in-page scroll.
	// Nested srcdoc geometry is not reported consistently by hosted browsers.
	// Observe the guard's target resolution directly while preserving its
	// intentional invariant: it scrolls the target without mutating the
	// cross-origin location hash or navigating away from the document.
	const fragmentTargetWasScrolled = await artifact.locator("#toc-link").evaluate((link: HTMLAnchorElement) => {
		const target = document.getElementById("section-two")
		if (!target) {
			return false
		}
		let called = false
		const originalScrollIntoView = target.scrollIntoView
		target.scrollIntoView = () => {
			called = true
		}
		try {
			link.click()
			return called
		} finally {
			target.scrollIntoView = originalScrollIntoView
		}
	})
	expect(fragmentTargetWasScrolled).toBe(true)
	expect(await artifact.evaluate(() => window.location.hash)).toBe("")
	await expect(artifact.locator("h1#title")).toHaveCount(1)
})

runtimeE2E("Studio denies kernel and agent requests from an untrusted document @phase0-smoke", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())
	await openWorkspaceFile(page, "phase0/untrusted-runcode.html")
	const shell = await waitForShellWithSrcdoc(page, "untrusted-runcode-fixture", 60_000)
	await expect(shell.getByTestId("artifact-trust-badge")).toHaveText("Static document")
	await expect(shell.getByTestId("artifact-trust-allow")).toHaveCount(0)
	// A manifest and cells in the document grant nothing: no bridge is injected.
	expect(await shell.locator("iframe").first().getAttribute("srcdoc")).not.toContain("artifact/cellRegistry")

	// Wait for the document to finish loading so its click handlers (registered by an inline
	// script that runs during parsing) exist before the test clicks.
	const artifact = await waitForFrame(
		page,
		async (frame) => (await frame.locator("#untrusted-heading").count()) === 1 && (await isDocumentComplete(frame)),
	)
	await artifact.locator("#ask-kernel").evaluate((element: HTMLElement) => element.click())
	await expect(artifact.locator("#run-result")).toHaveAttribute("data-state", "denied", { timeout: 15_000 })
	await expect(artifact.locator("#run-result")).not.toContainText("should-never-run")

	// A document-initiated agent hand-off is refused outright: no prompt, only a notice.
	await artifact.locator("#ask-agent").evaluate((element: HTMLElement) => element.click())
	await expect(shell.getByTestId("agent-handoff-notice")).toBeVisible({ timeout: 15_000 })
	await expect(shell.getByTestId("agent-handoff-prompt")).toHaveCount(0)
})

runtimeE2E("Studio stages a document's agent request for a user click and revokes on demand @phase0-smoke", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())
	await openWorkspaceFile(page, "phase0/standalone-module.html")
	const artifact = await waitForCellFrame(page, "standalone-python")
	const shell = await waitForShellWithSrcdoc(page, "standalone-runtime-fixture")
	await expect(shell.getByTestId("artifact-trust-badge")).toHaveText("Execution allowed")

	// The document asks the agent to start a task. Nothing is sent until the user
	// reads the prompt and clicks; here we only assert it is staged and visible.
	await artifact.evaluate(() => {
		parent.postMessage(
			{ type: "aihydro-preview-event", kind: "user.batch_changes", payloadJson: JSON.stringify({ changes: [{}] }) },
			"*",
		)
	})
	await expect(shell.getByTestId("agent-handoff-prompt-text")).toContainText("The user has submitted 1 change", {
		timeout: 15_000,
	})
	await shell.getByTestId("agent-handoff-dismiss").click()
	await expect(shell.getByTestId("agent-handoff-prompt")).toHaveCount(0)

	// Revoke: the badge flips, the bridge is removed on reload, and the document can no longer run.
	await shell.getByTestId("artifact-trust-revoke").click()
	await expect(shell.getByTestId("artifact-trust-allow")).toBeVisible({ timeout: 15_000 })
	await expect(shell.getByTestId("artifact-trust-badge")).toHaveText("Trusted, execution off")
	await expect
		.poll(async () => (await shell.locator("iframe").first().getAttribute("srcdoc"))?.includes("artifact/cellRegistry"), {
			timeout: 15_000,
		})
		.toBe(false)
})

runtimeE2E("A document script cannot grant itself execution or reach the shell @phase0-smoke", async ({ page }) => {
	await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort())
	await openWorkspaceFile(page, "phase0/trusted-forge.html")
	const shell = await waitForShellWithSrcdoc(page, "trusted-forge-fixture", 60_000)
	await expect(shell.getByTestId("artifact-trust-badge")).toHaveText("Trusted, execution off")
	// The attack handler is registered by an inline script that runs while the document parses; a
	// click before the document has loaded would be lost and leave the result "idle".
	const artifact = await waitForFrame(
		page,
		async (frame) => (await frame.locator("#forge-heading").count()) === 1 && (await isDocumentComplete(frame)),
	)

	await artifact.locator("#attack").evaluate((element: HTMLElement) => element.click())
	await expect(artifact.locator("#forge-result")).toHaveAttribute("data-state", "done", { timeout: 15_000 })
	// The iframe is an opaque origin: every route into the shell's DOM or globals is a SecurityError.
	const reached = JSON.parse((await artifact.locator("#forge-result").textContent()) ?? "{}") as Record<string, string>
	expect(reached.parentDom).toBe("SecurityError")
	expect(reached.parentProps).toBe("SecurityError")
	expect(reached.top).toBe("SecurityError")
	expect(reached.error, "attack script must not have thrown").toBeUndefined()
	// Popups (one closed at once, one with a severed opener) forged host-only replies too. Whether the
	// host window lets them open is environment-dependent, so only record it; what must hold is below.
	expect(Array.isArray((reached as unknown as { popups?: unknown[] }).popups)).toBe(true)
	// Give any popup time to post and close before asserting that nothing moved.
	await page.waitForTimeout(2_000)
	// The host stamps every reply the shell acts on with a per-panel secret the document cannot read.
	const panelToken = await shell.evaluate(() => (window as unknown as { __aihydroPanelToken?: string }).__aihydroPanelToken)
	expect(typeof panelToken === "string" && panelToken.length >= 32).toBe(true)

	// Nothing took effect: still not allowed, no bridge, no staged agent prompt, no progress.
	// (The fixture also forges host-only replies and navigation; the shell's rejection of those
	// is covered by webview-ui hostMessage.test.ts, where the sender window can be controlled.)
	await expect(shell.getByTestId("artifact-trust-badge")).toHaveText("Trusted, execution off")
	await expect(shell.getByTestId("artifact-trust-allow")).toBeVisible()
	await expect(shell.getByTestId("artifact-trust-revoke")).toHaveCount(0)
	expect(await shell.locator("iframe").first().getAttribute("srcdoc")).not.toContain("artifact/cellRegistry")
	await expect(shell.getByTestId("agent-handoff-prompt")).toHaveCount(0)
	await expect(shell.getByTestId("agent-handoff-notice")).toBeVisible({ timeout: 15_000 })
})
