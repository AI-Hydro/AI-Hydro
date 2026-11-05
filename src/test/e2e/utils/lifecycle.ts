import { cpSync } from "node:fs"
import * as path from "node:path"
import type { Page, TestInfo } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper } from "./helpers"

export interface LifecycleSession {
	launch: () => Promise<{ app: ElectronApplication; page: Page }>
	close: () => Promise<number | null>
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
		if (testFailure !== undefined) {
			await describeOpenFrames(current)
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
