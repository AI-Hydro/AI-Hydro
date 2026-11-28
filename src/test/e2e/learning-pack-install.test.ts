import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import {
	createLearningPackTestArchive,
	createValidLearningPackFiles,
	TEST_MODULE_IDS,
} from "../../services/learning-pack/__tests__/learningPackTestFixture"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { type LifecycleSession, lifecycleFixture } from "./utils/lifecycle"

// The real extension host validates the pack against its own package.json version, so the
// synthetic pack must declare compatibility with that version rather than a fixed release line.
const EXTENSION_VERSION = (
	JSON.parse(readFileSync(path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "package.json"), "utf8")) as { version: string }
).version

const installedPackE2E = e2e.extend<{ workspaceDir: string }>({
	workspaceDir: async ({}, use) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase1-pack-workspace-"))
		const workspace = path.join(root, "workspace")
		cpSync(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"), workspace, { recursive: true })
		const entryHtml = Buffer.from(`<!doctype html><html><head>
			<meta http-equiv="Content-Security-Policy" content="default-src *">
			<script type="application/vnd.aihydro.module+json">${JSON.stringify({
				id: TEST_MODULE_IDS[0],
				title: "Synthetic installed pack",
				version: "0.1.0",
				authors: [{ name: "Synthetic Test" }],
				license: "CC-BY-4.0",
				requires: { executable: false, python: [] },
			})}</script>
			<script>window.inlineBridgeRan=true</script>
			<script src="https://phase1-csp.invalid/external.js"></script>
		</head><body data-phase1-installed-pack="true">
			<h1>Installed Learning Pack</h1>
			<img id="embedded" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
			<img id="external" src="https://phase1-csp.invalid/external.png">
		</body></html>`)
		const { files } = createValidLearningPackFiles({ firstModuleBytes: entryHtml, aiHydroRange: `^${EXTENSION_VERSION}` })
		writeFileSync(path.join(workspace, "synthetic.aihydropack"), createLearningPackTestArchive(files))
		try {
			await use(workspace)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
})

const restartPackE2E = installedPackE2E.extend<{ lifecycle: LifecycleSession }>(lifecycleFixture)
restartPackE2E.setTimeout(180_000)

async function waitForPreviewShell(page: Page): Promise<Frame> {
	let result: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					try {
						if ((await frame.title()) === "AI-Hydro Studio") {
							result = frame
							return true
						}
					} catch {
						// Panel frames are replaced during initial registration.
					}
				}
				return false
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
	return result as Frame
}

installedPackE2E(
	"installs a local signed pack and enforces CSP through the real panel @phase1-pack",
	async ({ page, workspaceDir }) => {
		let externalRequests = 0
		await page.route("https://phase1-csp.invalid/**", async (route) => {
			externalRequests++
			await route.fulfill({ status: 200, contentType: "application/javascript", body: "window.externalScriptRan=true" })
		})
		await E2ETestHelper.openAiHydroSidebar(page)
		await expect
			.poll(
				async () => {
					for (const frame of page.frames()) {
						try {
							if ((await frame.title()).startsWith("AI-Hydro")) return true
						} catch {}
					}
					return false
				},
				{ timeout: 20_000 },
			)
			.toBe(true)
		await page.waitForTimeout(1_000)
		const activationFailure = page.getByText(/Activating extension .* failed:/).first()
		expect(await activationFailure.count()).toBe(0)
		let commandResponse: Response | undefined
		await expect
			.poll(
				async () => {
					try {
						commandResponse = await fetch("http://127.0.0.1:9876/learning-pack-command", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								command: "aihydro.learningPacks.install",
								options: {
									archivePath: path.join(workspaceDir, "synthetic.aihydropack"),
									approval: "install-once",
								},
							}),
						})
						return commandResponse.status
					} catch {
						return 0
					}
				},
				{ timeout: 30_000 },
			)
			.toBe(200)
		const commandResult = (await commandResponse!.json()) as { result?: { status?: string } }
		expect(commandResult.result?.status).toBe("installed")

		const shell = await waitForPreviewShell(page)
		const iframe = shell.locator("iframe").first()
		await expect(iframe).toHaveAttribute("srcdoc", /data-phase1-installed-pack="true"/, { timeout: 30_000 })
		const srcdoc = (await iframe.getAttribute("srcdoc")) ?? ""
		expect(srcdoc).toContain("default-src 'none'")
		expect(srcdoc).not.toContain("default-src *")
		expect(srcdoc.indexOf("Content-Security-Policy")).toBeLessThan(srcdoc.indexOf("<script"))
		await expect(shell.getByTitle("Course options")).toBeVisible()

		let artifact: Frame | undefined
		await expect
			.poll(
				async () => {
					// The document is sandboxed into an opaque origin, so its frame URL is not a reliable
					// handle; find it by its own content instead.
					artifact = undefined
					for (const frame of page.frames()) {
						if (frame === shell || frame.isDetached()) continue
						try {
							if ((await frame.locator('body[data-phase1-installed-pack="true"]').count()) === 1) artifact = frame
						} catch {
							// frame replaced while the panel settles
						}
					}
					return Boolean(artifact)
				},
				{ timeout: 30_000 },
			)
			.toBe(true)
		await expect
			.poll(() => artifact!.evaluate(() => (window as Window & { inlineBridgeRan?: boolean }).inlineBridgeRan))
			.toBe(true)
		expect(await artifact!.evaluate(() => (window as Window & { externalScriptRan?: boolean }).externalScriptRan)).not.toBe(
			true,
		)
		await expect.poll(() => artifact!.locator("#embedded").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
		expect(await artifact!.locator("#external").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(0)
		expect(externalRequests).toBe(0)
	},
)

async function runInstallCommand(workspaceDir: string): Promise<string | undefined> {
	return runPackCommand("aihydro.learningPacks.install", {
		archivePath: path.join(workspaceDir, "synthetic.aihydropack"),
		approval: "install-once",
	})
}

async function runPackCommand(command: string, options: Record<string, unknown>): Promise<string | undefined> {
	let response: Response | undefined
	await expect
		.poll(
			async () => {
				try {
					response = await fetch("http://127.0.0.1:9876/learning-pack-command", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ command, options }),
					})
					return response.status
				} catch {
					return 0
				}
			},
			{ timeout: 30_000 },
		)
		.toBe(200)
	return ((await response!.json()) as { result?: { status?: string } }).result?.status
}

async function courseShell(page: Page): Promise<Frame | undefined> {
	for (const frame of page.frames()) {
		if (frame.isDetached()) continue
		try {
			if ((await frame.title()) === "AI-Hydro Studio" && (await frame.getByTitle("Course options").count()) === 1)
				return frame
		} catch {
			// frame replaced while the panel settles
		}
	}
	return undefined
}

interface PersistedProgress {
	currentModuleId: string | null
	completed: Record<string, unknown>
}

/** The host-written progress record (one course per profile in this test); read-only, never written by the test. */
function readProgress(homeDir: string): PersistedProgress | undefined {
	const directory = path.join(homeDir, ".aihydro", "course_progress")
	if (!existsSync(directory)) return undefined
	const files = readdirSync(directory).filter((entry) => entry.endsWith(".json"))
	if (files.length !== 1) return undefined
	try {
		return JSON.parse(readFileSync(path.join(directory, files[0]), "utf8")) as PersistedProgress
	} catch {
		return undefined
	}
}

const completedIds = (homeDir: string) => Object.keys(readProgress(homeDir)?.completed ?? {}).sort()

// The second synthetic module's body is its own id (see createValidLearningPackFiles).
const SECOND_MODULE_BODY = new RegExp(`${TEST_MODULE_IDS[1].replace(/\./g, "\\.")}</body>`)

/**
 * What this covers, exactly: the installed pack survives a real application restart (the Electron process
 * is closed and a new one started on the same profile, extensions and HOME), and `aihydro.learningPacks.open`
 * reopens it with no reinstall at the module saved before the restart (the second one, after the first is
 * marked complete) with the completed tally unchanged. Re-running Install afterwards still reports `noop`
 * and reopens the same module. What it does not cover: Studio reopening the course with no command at all
 * (it does not), the QuickPick shown when several packs are installed (unit tested), and a click on the
 * empty-state button (webview unit tested). The open command is driven through the test endpoint.
 */
restartPackE2E(
	"keeps an installed pack across a real restart and reopens it at the saved module through the open command @phase1-pack",
	async ({ lifecycle, workspaceDir, homeDir }) => {
		let { page } = await lifecycle.launch()
		await E2ETestHelper.openAiHydroSidebar(page)
		expect(await runInstallCommand(workspaceDir)).toBe("installed")
		await expect.poll(async () => Boolean(await courseShell(page)), { timeout: 30_000 }).toBe(true)

		// Complete the first module so progress moves on to the second one.
		let shell = (await courseShell(page)) as Frame
		await shell.getByTitle("Mark complete & continue to next module").evaluate((element: HTMLElement) => element.click())
		await expect(shell.getByTitle("1 of 2 modules completed")).toBeVisible({ timeout: 30_000 })
		await expect
			.poll(() => ({ current: readProgress(homeDir)?.currentModuleId, completed: completedIds(homeDir) }), {
				timeout: 30_000,
			})
			.toEqual({ current: TEST_MODULE_IDS[1], completed: [TEST_MODULE_IDS[0]] })

		const firstPid = await lifecycle.close()
		expect(firstPid).not.toBeNull()
		const relaunched = await lifecycle.launch()
		page = relaunched.page
		expect(relaunched.app.process().pid).not.toBe(firstPid)
		await E2ETestHelper.openAiHydroSidebar(page)

		// Reopen through the open command: no reinstall, same module, same tally.
		expect(await runPackCommand("aihydro.learningPacks.open", {})).toBe("opened")
		await expect.poll(async () => Boolean(await courseShell(page)), { timeout: 30_000 }).toBe(true)
		shell = (await courseShell(page)) as Frame
		await expect(shell.locator("iframe").first()).toHaveAttribute("srcdoc", SECOND_MODULE_BODY, { timeout: 30_000 })
		await expect(shell.getByTitle("1 of 2 modules completed")).toBeVisible({ timeout: 30_000 })
		expect(readProgress(homeDir)?.currentModuleId).toBe(TEST_MODULE_IDS[1])
		expect(completedIds(homeDir)).toEqual([TEST_MODULE_IDS[0]])

		// Re-running Install is still a noop and reopens the same module.
		expect(await runInstallCommand(workspaceDir)).toBe("noop")
		await expect.poll(async () => Boolean(await courseShell(page)), { timeout: 30_000 }).toBe(true)
		shell = (await courseShell(page)) as Frame
		await expect(shell.locator("iframe").first()).toHaveAttribute("srcdoc", SECOND_MODULE_BODY, { timeout: 30_000 })
		expect(readProgress(homeDir)?.currentModuleId).toBe(TEST_MODULE_IDS[1])
		expect(completedIds(homeDir)).toEqual([TEST_MODULE_IDS[0]])
	},
)
