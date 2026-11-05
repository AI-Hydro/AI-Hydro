import type { Page } from "@playwright/test"
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
