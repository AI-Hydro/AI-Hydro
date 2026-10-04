import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, type PathLike, type RmOptions, rmSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { type ElectronApplication, expect, type Frame, type Page, test } from "@playwright/test"
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import { _electron } from "playwright"
import { AiHydroApiServerMock } from "../fixtures/server"

interface E2ETestDirectories {
	workspaceDir: string
	multiRootWorkspaceDir: string
	userDataDir: string
	extensionsDir: string
	homeDir: string
}

const vscodeExecutablePathPromises = new Map<"stable" | "insiders", Promise<string>>()

function getVSCodeExecutablePath(channel: "stable" | "insiders"): Promise<string> {
	let executablePath = vscodeExecutablePathPromises.get(channel)
	if (!executablePath) {
		executablePath = downloadAndUnzipVSCode(channel, undefined, new SilentReporter()).catch((error) => {
			vscodeExecutablePathPromises.delete(channel)
			throw error
		})
		vscodeExecutablePathPromises.set(channel, executablePath)
	}
	return executablePath
}

export interface E2ETestConfigs {
	workspaceType: "single" | "multi"
	channel: "stable" | "insiders"
	workspaceTrust: "disabled" | "enabled"
}

export class E2ETestHelper {
	// Constants
	public static readonly CODEBASE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..")
	public static readonly E2E_TESTS_DIR = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "e2e")

	// Instance properties for caching
	private cachedFrame: Frame | null = null

	// Path utilities
	public static escapeToPath(text: string): string {
		return text.trim().toLowerCase().replaceAll(/\W/g, "_")
	}

	public static getResultsDir(testName = "", label?: string): string {
		const testDir = path.join(
			E2ETestHelper.CODEBASE_ROOT_DIR,
			"test-results",
			"playwright",
			E2ETestHelper.escapeToPath(testName),
		)
		return label ? path.join(testDir, label) : testDir
	}

	/**
	 * Generates a filename for gRPC recorder logs based on test information
	 * @param testTitle The title of the test
	 * @param projectName The name of the test project (optional)
	 * @returns A sanitized filename suitable for gRPC recorder logs
	 */
	public static generateTestFileName(testTitle: string, projectName?: string): string {
		// Create a base name from the test title
		const baseName = E2ETestHelper.escapeToPath(testTitle)

		// Add project name if provided and different from default
		const projectSuffix = projectName && projectName !== "e2e tests" ? `_${E2ETestHelper.escapeToPath(projectName)}` : ""

		return `${baseName}${projectSuffix}`
	}

	public static async waitUntil(predicate: () => boolean | Promise<boolean>, maxDelay = 10000): Promise<void> {
		let delay = 10
		const start = Date.now()

		while (!(await predicate())) {
			if (Date.now() - start > maxDelay) {
				throw new Error(`waitUntil timeout after ${maxDelay}ms`)
			}
			await new Promise((resolve) => setTimeout(resolve, delay))
			delay = Math.min(delay << 1, 1000) // Cap at 1s
		}
	}

	public async getSidebar(page: Page): Promise<Frame> {
		const findSidebarFrame = async (): Promise<Frame | null> => {
			// Check cached frame first
			if (this.cachedFrame && !this.cachedFrame.isDetached()) {
				return this.cachedFrame
			}

			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue
				}

				try {
					const title = await frame.title()
					if (title.startsWith("AI-Hydro")) {
						this.cachedFrame = frame
						return frame
					}
				} catch (error: any) {
					if (!error.message.includes("detached") && !error.message.includes("navigation")) {
						throw error
					}
				}
			}
			return null
		}

		await E2ETestHelper.waitUntil(async () => (await findSidebarFrame()) !== null, 30_000)
		return (await findSidebarFrame()) || page.mainFrame()
	}

	public static async rmForRetries(path: PathLike, options?: RmOptions): Promise<void> {
		const maxAttempts = 3 // Reduced from 5

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				rmSync(path, options)
				return
			} catch (error) {
				if (attempt === maxAttempts) {
					throw new Error(`Failed to rmSync ${path} after ${maxAttempts} attempts: ${error}`)
				}
				await new Promise((resolve) => setTimeout(resolve, 50 * attempt)) // Progressive delay
			}
		}
	}

	public static async useTemporaryDirectory(
		prefix: string,
		use: (directory: string) => Promise<void>,
		stableAbsenceMs = 1_000,
	): Promise<void> {
		const directory = mkdtempSync(path.join(os.tmpdir(), prefix))
		let useFailure: unknown
		try {
			await use(directory)
		} catch (error) {
			useFailure = error
		}

		let cleanupFailure: unknown
		try {
			for (let attempt = 1; attempt <= 3; attempt++) {
				if (existsSync(directory)) {
					await E2ETestHelper.rmForRetries(directory, { recursive: true, force: true })
				}
				// Electron child processes can finish flushing storage just after
				// the main process exits. Require a stable absent interval rather
				// than accepting a directory that is immediately recreated.
				await new Promise((resolve) => setTimeout(resolve, stableAbsenceMs))
				if (!existsSync(directory)) {
					break
				}
				if (attempt === 3) {
					throw new Error(`Temporary E2E directory was recreated after cleanup: ${directory}`)
				}
			}
		} catch (error) {
			cleanupFailure = error
		}

		if (useFailure) {
			throw useFailure
		}
		if (cleanupFailure) {
			throw cleanupFailure
		}
	}

	public static async closeElectronApp(app: ElectronApplication, timeoutMs = 15_000): Promise<void> {
		const process = app.process()
		const hasExited = () => process.exitCode !== null || process.signalCode !== null
		let timer: NodeJS.Timeout | undefined
		const closeCompleted = await Promise.race([
			app
				.close()
				.then(() => true)
				.catch(() => false),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs)
			}),
		])
		if (timer) {
			clearTimeout(timer)
		}

		if (closeCompleted && !hasExited()) {
			try {
				await E2ETestHelper.waitUntil(hasExited, Math.min(2_000, timeoutMs))
			} catch {
				// Fall through to the bounded forced shutdown below.
			}
		}
		if (!hasExited()) {
			process.kill()
		}
		await E2ETestHelper.waitUntil(hasExited, timeoutMs)
	}

	public async signin(webview: Frame): Promise<void> {
		const welcomeHeading = webview.getByRole("heading", { name: "Hi, I'm AI-Hydro" })
		const providerSelector = webview.getByTestId("provider-selector-input")
		await expect(welcomeHeading).toBeVisible()
		await expect(providerSelector).toBeVisible()

		// Configure the normal OpenAI-compatible handler atomically through the
		// E2E-only local control endpoint. The public provider form is covered by
		// auth.test.ts; execution tests must never reach a real provider.
		const applyLocalProvider = async (): Promise<number> => {
			try {
				const response = await fetch("http://127.0.0.1:9876/e2e/local-provider", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "{}",
				})
				return response.status
			} catch {
				return 0
			}
		}
		await expect.poll(applyLocalProvider, { timeout: 30_000 }).toBe(200)

		// Verify the welcome page is no longer visible
		await expect(welcomeHeading).not.toBeVisible()
		await expect(providerSelector).not.toBeVisible()

		// The welcome form writes whole provider snapshots through debounced
		// inputs. Reapply after it unmounts so an in-flight stale form write
		// cannot replace the loopback provider, then require the redacted
		// effective state to remain exact for a stable interval.
		await expect.poll(applyLocalProvider, { timeout: 30_000 }).toBe(200)

		let stableSince = 0
		await expect
			.poll(
				async () => {
					try {
						const response = await fetch("http://127.0.0.1:9876/e2e/local-provider-status")
						if (!response.ok) {
							stableSince = 0
							return false
						}
						const status = (await response.json()) as {
							planModeApiProvider?: string
							actModeApiProvider?: string
							openAiBaseUrl?: string
							openAiApiKeyConfigured?: boolean
							planModeOpenAiModelId?: string
							actModeOpenAiModelId?: string
							mode?: string
						}
						const matches =
							status.planModeApiProvider === "openai" &&
							status.actModeApiProvider === "openai" &&
							status.openAiBaseUrl === "http://127.0.0.1:7777/api/v1" &&
							status.openAiApiKeyConfigured === true &&
							status.planModeOpenAiModelId === "mock-model" &&
							status.actModeOpenAiModelId === "mock-model" &&
							status.mode === "act"
						if (!matches) {
							stableSince = 0
							await applyLocalProvider()
							return false
						}
						if (stableSince === 0) {
							stableSince = Date.now()
						}
						return Date.now() - stableSince >= 1_000
					} catch {
						stableSince = 0
						return false
					}
				},
				{ timeout: 30_000 },
			)
			.toBe(true)
	}

	public static async openAiHydroSidebar(page: Page): Promise<void> {
		// Focus through the extension host after activation instead of depending
		// on activity-bar icon timing or overflow layout on hosted runners.
		await expect
			.poll(
				async () => {
					try {
						const response = await fetch("http://127.0.0.1:9876/e2e/focus-sidebar", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: "{}",
						})
						return response.status
					} catch {
						return 0
					}
				},
				// The first extension host on a cold Windows runner can spend
				// more than 30 seconds installing and activating the VSIX. This
				// endpoint is the readiness probe, so give cold activation its
				// own bounded startup budget.
				{ timeout: 60_000 },
			)
			.toBe(200)

		await expect(page.getByRole("tab", { name: "AI-Hydro", exact: true })).toHaveAttribute("aria-selected", "true", {
			timeout: 30_000,
		})
	}

	public static async runCommandPalette(page: Page, command: string): Promise<void> {
		const editorMenu = page.locator("li").filter({ hasText: "[Extension Development Host]" }).first()
		await editorMenu.click({ delay: 100 })
		const editorSearchBar = page.getByRole("textbox", {
			name: "Search files by name (append",
		})
		await editorSearchBar.click({ delay: 100 }) // Ensure focus
		await editorSearchBar.fill(`>${command}`)
		await page.keyboard.press("Enter")
	}

	// Clear cached frame when needed
	public clearCachedFrame(): void {
		this.cachedFrame = null
	}
}

/**
 * NOTE: Use the `e2e` test fixture for all E2E tests to test the AI-Hydro extension.
 *
 * Extended Playwright test configuration for AI-Hydro E2E testing.
 *
 * This test configuration provides a comprehensive setup for end-to-end testing of the AI-Hydro VS Code extension,
 * including server mocking, temporary directories, VS Code instance management, and helper utilities.
 *
 * NOTE: Default to run in single-root workspace; use `e2eMultiRoot` for multi-root workspace tests.
 *
 * @extends test - Base Playwright test with multiple fixture extensions
 *
 * Fixtures provided:
 * - `server`: Per-worker AiHydroApiServerMock instance with deterministic teardown
 * - `workspaceDir`: Path to the test workspace directory
 * - `userDataDir`: Temporary directory for VS Code user data
 * - `extensionsDir`: Temporary directory for VS Code extensions
 * - `openVSCode`: Function that returns a Promise resolving to an ElectronApplication instance
 * - `app`: ElectronApplication instance with automatic cleanup
 * - `helper`: E2ETestHelper instance for test utilities
 * - `page`: Playwright Page object representing the main VS Code window with AI-Hydro sidebar opened
 * - `sidebar`: Playwright Frame object representing the AI-Hydro extension's sidebar iframe
 *
 * @returns Extended test object with all fixtures available for E2E test scenarios:
 * - **server**: Automatically starts and manages a AiHydroApiServerMock instance
 * - **workspaceDir**: Sets up a test workspace directory from fixtures
 * - **userDataDir**: Creates a temporary directory for VS Code user data
 * - **extensionsDir**: Creates a temporary directory for VS Code extensions
 * - **openVSCode**: Factory function that launches VS Code with proper configuration for testing
 * - **app**: Manages the VS Code ElectronApplication lifecycle with automatic cleanup
 * - **helper**: Provides E2ETestHelper utilities for test operations
 * - **page**: Configures the main VS Code window with notifications disabled and AI-Hydro sidebar open
 * - **sidebar**: Provides access to the AI-Hydro extension's sidebar frame
 *
 * @example
 * ```typescript
 * e2e('should perform basic operations', async ({ sidebar, helper }) => {
 *   // Test implementation using the configured sidebar and helper
 * });
 * ```
 *
 * @remarks
 * - Automatically handles VS Code download and setup
 * - Installs the AI-Hydro extension in development mode
 * - Records test videos for debugging
 * - Performs cleanup of temporary directories after each test
 * - Configures VS Code with disabled updates, workspace trust, and welcome screens
 */
export const e2e = test
	.extend<{}, { server: AiHydroApiServerMock | null }>({
		server: [
			async ({}, use) => {
				if (!AiHydroApiServerMock.globalSharedServer) {
					await AiHydroApiServerMock.startGlobalServer()
				}
				try {
					await use(AiHydroApiServerMock.globalSharedServer)
				} finally {
					await AiHydroApiServerMock.stopGlobalServer()
				}
			},
			{ scope: "worker" },
		],
	})
	.extend<E2ETestDirectories>({
		workspaceDir: async ({}, use) => {
			await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"))
		},
		multiRootWorkspaceDir: async ({}, use) => {
			// DOCS: https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces
			await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "multiroots.code-workspace"))
		},
		userDataDir: async ({}, use) => {
			await E2ETestHelper.useTemporaryDirectory("vsce", use)
		},
		extensionsDir: async ({}, use) => {
			await E2ETestHelper.useTemporaryDirectory("vsce", use)
		},
		homeDir: async ({}, use) => {
			// Python/MCP children may flush a tiny version cache shortly after
			// Electron exits. A longer HOME-only stability window catches and
			// removes that delayed synthetic write without slowing other roots.
			await E2ETestHelper.useTemporaryDirectory("aihydro-e2e-home-", use, 3_000)
		},
	})
	.extend<E2ETestConfigs>({
		workspaceType: "single",
		channel: "stable",
		workspaceTrust: "disabled",
	})
	.extend<{ openVSCode: (workspacePath: string) => Promise<ElectronApplication> }>({
		openVSCode: async ({ userDataDir, extensionsDir, homeDir, channel, workspaceTrust }, use, testInfo) => {
			const executablePath = await getVSCodeExecutablePath(channel)
			const matplotlibConfigDir = path.join(homeDir, ".cache", "matplotlib")
			mkdirSync(matplotlibConfigDir, { recursive: true })
			const pythonInterpreter = process.env.AIHYDRO_E2E_PYTHON
			if (pythonInterpreter) {
				execFileSync(pythonInterpreter, ["-c", "import matplotlib.pyplot"], {
					env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir, MPLCONFIGDIR: matplotlibConfigDir },
					timeout: 60_000,
				})
			}

			await use(async (workspacePath: string) => {
				const app = await _electron.launch({
					executablePath,
					env: {
						...process.env,
						HOME: homeDir,
						USERPROFILE: homeDir,
						MPLCONFIGDIR: matplotlibConfigDir,
						PYTHONHASHSEED: "0",
						TEMP_PROFILE: "true",
						E2E_TEST: "true",
						AIHYDRO_ENVIRONMENT: "local",
						GRPC_RECORDER_FILE_NAME: E2ETestHelper.generateTestFileName(testInfo.title, testInfo.project.name),
						// GRPC_RECORDER_ENABLED: "true",
						// GRPC_RECORDER_TESTS_FILTERS_ENABLED: "true"
						// IS_DEV: "true",
						// DEV_WORKSPACE_FOLDER: E2ETestHelper.CODEBASE_ROOT_DIR,
					},
					recordVideo: {
						dir: E2ETestHelper.getResultsDir(testInfo.title, "recordings"),
					},
					args: [
						"--no-sandbox",
						"--password-store=basic",
						"--use-inmemory-secretstorage",
						"--disable-updates",
						...(workspaceTrust === "disabled" ? ["--disable-workspace-trust"] : []),
						"--disable-extensions", // Run VS Code with all extensions disabled other than the one under test.
						"--skip-welcome",
						"--skip-release-notes",
						`--user-data-dir=${userDataDir}`,
						`--extensions-dir=${extensionsDir}`,
						`--install-extension=${path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "dist", "e2e.vsix")}`,
						`--extensionDevelopmentPath=${E2ETestHelper.CODEBASE_ROOT_DIR}`,
						workspacePath,
					],
				})
				await E2ETestHelper.waitUntil(() => app.windows().length > 0)
				return app
			})
		},
	})
	.extend<{ app: ElectronApplication }>({
		app: async ({ openVSCode, workspaceType, workspaceDir, multiRootWorkspaceDir }, use) => {
			const workspacePath = workspaceType === "single" ? workspaceDir : multiRootWorkspaceDir
			const app = await openVSCode(workspacePath)

			let testFailure: unknown
			try {
				await use(app)
			} catch (error) {
				testFailure = error
			}

			await E2ETestHelper.closeElectronApp(app)
			if (testFailure) {
				throw testFailure
			}
		},
	})
	.extend<{ helper: E2ETestHelper }>({
		helper: async ({}, use) => {
			const helper = new E2ETestHelper()
			await use(helper)
		},
	})
	.extend({
		page: async ({ app }, use) => {
			const page = await app.firstWindow()
			try {
				await use(page)
			} finally {
				// Ensure proper cleanup: Close the page if it's still open and not already closed by app.close()
				// This provides a common teardown mechanism for all e2e tests without requiring explicit page.close() calls
				if (!page.isClosed()) {
					await page.close()
				}
			}
		},
	})
	.extend<{ sidebar: Frame }>({
		sidebar: async ({ page, helper, server: _server }, use) => {
			await E2ETestHelper.openAiHydroSidebar(page)
			const sidebar = await helper.getSidebar(page)
			await use(sidebar)
		},
	})

export const E2E_WORKSPACE_TYPES = [
	{ title: "Single Root", workspaceType: "single" },
	{ title: "Multi-Roots", workspaceType: "multi" },
] as const
