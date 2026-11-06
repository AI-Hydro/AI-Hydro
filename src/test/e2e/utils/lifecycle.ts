import { cpSync, readdirSync, readFileSync } from "node:fs"
import * as path from "node:path"
import type { Page, TestInfo } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper } from "./helpers"

export interface LifecycleSession {
	launch: () => Promise<{ app: ElectronApplication; page: Page }>
	close: () => Promise<number | null>
}

/**
 * Order of shell loads seen by the window, as event kinds with seconds since launch (no text content):
 * "shell-mount <instance>" for each Studio React mount, "shell-ready" for each host-side ready message,
 * "doc-push" for each document streamed to the shell.
 */
const shellLoadSequence: string[] = []

function recordShellLoads(page: Page): void {
	const started = Date.now()
	page.on("console", (message) => {
		const text = message.text()
		const at = ((Date.now() - started) / 1000).toFixed(1)
		const mount = text.match(/\[HtmlPreviewContext:([a-z0-9]+)\] mount:/)
		if (mount) shellLoadSequence.push(`${at}s shell-mount ${mount[1]}`)
		else if (text.includes("Shell ready: re-pushing")) shellLoadSequence.push(`${at}s shell-ready`)
		else if (text.includes("Ignored shell-ready from a stale document")) shellLoadSequence.push(`${at}s shell-ready-stale`)
		else if (text.includes("[subscribeToHtmlPreviews] Streaming preview")) shellLoadSequence.push(`${at}s doc-push`)
		if (shellLoadSequence.length > 400) shellLoadSequence.shift()
	})
}

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/**
 * On failure, print what each open frame contains: title, number of cells, bridge presence, document size.
 * Structure only (no text content), so the output is safe in the log of a private caller.
 */
async function describeOpenFrames(app: ElectronApplication | null): Promise<void> {
	if (!app) {
		return
	}
	console.error("[lifecycle-diagnostics] shell-load-sequence", JSON.stringify(shellLoadSequence.slice(-120)))
	try {
		for (const page of app.windows()) {
			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue
				}
				try {
					const info = await frame.evaluate(() => ({
						title: document.title,
						cells: document.querySelectorAll("[data-aihydro-cell-id]").length,
						firstCells: Array.from(document.querySelectorAll("[data-aihydro-cell-id]"))
							.slice(0, 3)
							.map((element) => element.getAttribute("data-aihydro-cell-id")),
						wiredRunButtons: document.querySelectorAll('.aihydro-run[data-aihydro-wired="1"]').length,
						cellStatus: Array.from(document.querySelectorAll("[data-aihydro-cell-id]")).map((element) => ({
							id: element.getAttribute("data-aihydro-cell-id")?.split(".").slice(-1)[0],
							status: element.getAttribute("data-aihydro-cell-status"),
							outputChars: element.querySelector(".aihydro-output")?.textContent?.length ?? -1,
							awaiting: element.querySelector(".aihydro-output")?.getAttribute("data-aihydro-awaiting") ?? null,
						})),
						trustAllow: document.querySelectorAll('[data-testid="artifact-trust-allow"]').length,
						trustRevoke: document.querySelectorAll('[data-testid="artifact-trust-revoke"]').length,
						courseHeader: document.querySelectorAll('[title="Course options"]').length,
						iframes: document.querySelectorAll("iframe").length,
						bridge: typeof (window as unknown as { aihydro?: unknown }).aihydro,
						documentChars: document.documentElement.outerHTML.length,
					}))
					console.error("[lifecycle-diagnostics] frame", JSON.stringify(info))
				} catch {
					// frame navigated or is cross-origin
				}
			}
		}
	} catch {
		// Diagnostics must never fail a test.
	}
}

/** Print the last error/warning lines of the extension-host logs (capped; these hold paths, not course text). */
async function describeHostLogProblems(userDataDir: string): Promise<void> {
	try {
		const lines: string[] = []
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) {
					walk(full)
				} else if (entry.name.endsWith(".log")) {
					for (const line of readFileSync(full, "utf8").split("\n")) {
						if (/\b(error|warn|exception|died|crash)/i.test(line)) {
							lines.push(`${path.relative(userDataDir, full)}: ${line.slice(0, 240)}`)
						}
					}
				}
			}
		}
		walk(path.join(userDataDir, "logs"))
		for (const line of lines.slice(-40)) {
			console.error("[lifecycle-diagnostics] host-log", line)
		}
	} catch {
		// Diagnostics must never fail a test.
	}
}

/**
 * `lifecycle` fixture: launches the real VS Code, can close it, and launches it again on the same
 * user-data, extensions and HOME directories, so a test can restart the application for real. The
 * directories are removed only when the test ends.
 */
export const lifecycleFixture = {
	lifecycle: async (
		{
			openVSCode,
			workspaceDir,
			userDataDir,
			extensionsDir,
			homeDir,
		}: {
			openVSCode: (workspacePath: string) => Promise<ElectronApplication>
			workspaceDir: string
			userDataDir: string
			extensionsDir: string
			homeDir: string
		},
		use: (session: LifecycleSession) => Promise<void>,
		testInfo: TestInfo,
	) => {
		let current: ElectronApplication | null = null
		const close = async () => {
			if (!current) return null
			const app = current
			current = null
			const pid = app.process().pid
			await E2ETestHelper.closeElectronApp(app)
			try {
				await E2ETestHelper.waitUntil(() => !processIsRunning(pid), 15_000)
			} catch {
				if (processIsRunning(pid)) app.process().kill()
				await E2ETestHelper.waitUntil(() => !processIsRunning(pid), 15_000)
			}
			return pid
		}
		let testFailure: unknown
		try {
			await use({
				launch: async () => {
					await close()
					current = await openVSCode(workspaceDir)
					const page = await current.firstWindow()
					recordShellLoads(page)
					await page.waitForLoadState("domcontentloaded")
					await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 20_000 })
					return { app: current, page }
				},
				close,
			})
		} catch (error) {
			testFailure = error
		}
		const cleanupFailures: unknown[] = []
		// Playwright does not rethrow a test's failure into a fixture's `use()`, so read the status.
		if (testFailure !== undefined || testInfo.status !== testInfo.expectedStatus) {
			await describeOpenFrames(current)
			await describeHostLogProblems(userDataDir)
			// Extension-host and window logs live under the profile, which is deleted below; keep a copy of
			// the text logs (failures only), as the `page` fixture does, so a CI failure can be diagnosed.
			try {
				cpSync(path.join(userDataDir, "logs"), testInfo.outputPath("host-logs"), {
					recursive: true,
					filter: (source) => !path.extname(source) || path.extname(source) === ".log",
				})
			} catch {
				// Diagnostics must never fail a test.
			}
		}
		try {
			await close()
		} catch (error) {
			cleanupFailures.push(error)
		}
		const cleanupResults = await Promise.allSettled([
			E2ETestHelper.rmForRetries(userDataDir, { recursive: true, force: true }),
			E2ETestHelper.rmForRetries(extensionsDir, { recursive: true, force: true }),
			E2ETestHelper.rmForRetries(homeDir, { recursive: true, force: true }),
		])
		for (const result of cleanupResults) {
			if (result.status === "rejected") cleanupFailures.push(result.reason)
		}
		if (cleanupFailures.length > 0) {
			if (testFailure !== undefined) cleanupFailures.unshift(testFailure)
			throw new AggregateError(cleanupFailures, "Learning Pack real-panel teardown failed")
		}
		if (testFailure !== undefined) throw testFailure
	},
}
