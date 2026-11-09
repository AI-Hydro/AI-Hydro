import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import {
	createLearningPackTestArchive,
	createValidLearningPackFiles,
} from "../../services/learning-pack/__tests__/learningPackTestFixture"
import { allowArtifactExecution, E2ETestHelper, e2e, writeUserSettings } from "./utils/helpers"
import { type LifecycleSession, lifecycleFixture } from "./utils/lifecycle"

/**
 * Course-contract specs for the installed Studio: prerequisites, progress, executable cells, interruption
 * and ordinary (non-course) documents, driven through the real panel. They run against the development
 * host and, in studio-vsix-e2e.yml, against the packaged VSIX on Ubuntu, macOS and Windows.
 *
 * Content, stated exactly:
 *  - The prerequisite graph is the real book's: module IDs, titles and prerequisite lists copied from
 *    the Hydrologic Modeling book's course.yml (src/test/fixtures/learning-pack/hmfp-course-graph.json).
 *    The book repository is private, so the module bodies here are placeholders, not book text. The same
 *    assertion over the real book pack lives in learning-pack-artifact-integration.test.ts, which runs
 *    where the pinned book artifact exists.
 *  - The executable modules are the repository's golden-course and interrupt fixtures, packed as signed
 *    Learning Pack modules, so computation, figures, errors, recovery, kernel restart and interruption
 *    are exercised through an installed pack rather than a trusted workspace path.
 */

const EXTENSION_VERSION = (
	JSON.parse(readFileSync(path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "package.json"), "utf8")) as { version: string }
).version

const FIXTURES = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "fixtures")
const GRAPH = JSON.parse(readFileSync(path.join(FIXTURES, "learning-pack", "hmfp-course-graph.json"), "utf8")) as {
	courseId: string
	modules: { id: string; title: string; prerequisites: string[] }[]
}
const MODULE_IDS = GRAPH.modules.map((module) => module.id)
const TITLES = Object.fromEntries(GRAPH.modules.map((module) => [module.id, module.title]))
const PREREQUISITES = Object.fromEntries(GRAPH.modules.map((module) => [module.id, module.prerequisites]))

/** Placeholder module (not book text) that identifies itself by its index. */
function placeholderModule(id: string, index: number): Uint8Array {
	return Buffer.from(
		`<!doctype html><html><head><meta charset="utf-8"><title>${id}</title><script type="application/vnd.aihydro.module+json">${JSON.stringify(
			{
				id,
				title: TITLES[id],
				version: "0.1.0",
				authors: [{ name: "Synthetic Test" }],
				license: "CC-BY-4.0",
				requires: { executable: false, python: [] },
			},
		)}</script></head><body data-contract-module="${index}"><h1>${TITLES[id]}</h1></body></html>`,
		"utf8",
	)
}

function writeGraphPack(workspace: string): void {
	const { files } = createValidLearningPackFiles({
		aiHydroRange: `^${EXTENSION_VERSION}`,
		packId: GRAPH.courseId,
		courseId: GRAPH.courseId,
		moduleIds: MODULE_IDS,
		moduleTitles: TITLES,
		modulePrerequisites: PREREQUISITES,
		moduleBytes: placeholderModule,
	})
	writeFileSync(path.join(workspace, "graph.aihydropack"), createLearningPackTestArchive(files))
}

/**
 * Executable pack: the golden-course module (cells for computation, a figure, a deliberate error and a
 * quiz) and the interrupt module (a sleeping cell and a spinning cell), with the second module requiring
 * the first. Each fixture declares its own manifest ID, so the bytes are rewritten to the pack's ID.
 */
const EXEC_IDS = ["contract.compute.00", "contract.interrupt.01"] as const
function writeExecutablePack(workspace: string): void {
	const compute = readFileSync(
		path.join(FIXTURES, "html-preview", "golden-course", "01-runtime-contract", "module.html"),
		"utf8",
	)
	const interrupt = readFileSync(path.join(FIXTURES, "html-preview", "interrupt-module.html"), "utf8")
	const withId = (html: string, id: string) => {
		const manifest = /<script type="application\/vnd\.aihydro\.module\+json">([\s\S]*?)<\/script>/.exec(html)
		if (!manifest) throw new Error("fixture has no module manifest")
		const parsed = JSON.parse(manifest[1]) as Record<string, unknown>
		parsed.id = id
		return html.replace(manifest[1], JSON.stringify(parsed))
	}
	const { files } = createValidLearningPackFiles({
		aiHydroRange: `^${EXTENSION_VERSION}`,
		packId: "contract-exec",
		courseId: "contract-exec",
		moduleIds: EXEC_IDS,
		moduleTitles: { [EXEC_IDS[0]]: "Compute and plot", [EXEC_IDS[1]]: "Interrupt a busy cell" },
		modulePrerequisites: { [EXEC_IDS[1]]: [EXEC_IDS[0]] },
		moduleBytes: (id) => Buffer.from(withId(id === EXEC_IDS[0] ? compute : interrupt, id), "utf8"),
	})
	writeFileSync(path.join(workspace, "exec.aihydropack"), createLearningPackTestArchive(files))
}

const contractE2E = e2e
	.extend<{ workspaceDir: string }>({
		workspaceDir: async ({ userDataDir }, use) => {
			const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-course-contract-"))
			const workspace = path.join(root, "workspace")
			cpSync(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"), workspace, { recursive: true })
			cpSync(path.join(FIXTURES, "html-preview", "untrusted-runcode.html"), path.join(workspace, "untrusted-runcode.html"))
			writeGraphPack(workspace)
			writeExecutablePack(workspace)
			const python = process.env.AIHYDRO_E2E_PYTHON
			if (python) {
				// Machine-scope settings cannot come from the workspace; write the user profile.
				writeUserSettings(userDataDir, {
					"aihydro.htmlPreview.pythonExecution": "always",
					"aihydro.htmlPreview.pythonInterpreter": python,
					"aihydro.htmlPreview.pythonTimeoutSeconds": 60,
				})
			}
			try {
				await use(workspace)
			} finally {
				rmSync(root, { recursive: true, force: true })
			}
		},
	})
	.extend<{ lifecycle: LifecycleSession }>(lifecycleFixture)
contractE2E.setTimeout(240_000)

/**
 * The executable spec needs the deterministic interpreter. Where it is not provided (the general e2e job) the spec
 * skips, like the other Python-backed specs; studio-vsix-e2e.yml sets AIHYDRO_CONTRACT_REQUIRED=1 so there a missing
 * interpreter fails the run instead of skipping it.
 */
function requirePython(): void {
	if (process.env.AIHYDRO_CONTRACT_REQUIRED && !process.env.AIHYDRO_E2E_PYTHON) {
		throw new Error("AIHYDRO_E2E_PYTHON must be set when AIHYDRO_CONTRACT_REQUIRED is set")
	}
}
const pythonSkip = !process.env.AIHYDRO_E2E_PYTHON && !process.env.AIHYDRO_CONTRACT_REQUIRED

async function findFrame(page: Page, predicate: (frame: Frame) => Promise<boolean>, timeout = 60_000): Promise<Frame> {
	let result: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue
					try {
						if (await predicate(frame)) {
							result = frame
							return true
						}
					} catch {
						// Panel frames are replaced while the shell loads and documents switch.
					}
				}
				return false
			},
			{ timeout },
		)
		.toBe(true)
	return result as Frame
}

const courseShell = (page: Page) =>
	findFrame(
		page,
		async (frame) => (await frame.title()) === "AI-Hydro Studio" && (await frame.getByTitle("Course options").count()) === 1,
	)

const anyShell = (page: Page) => findFrame(page, async (frame) => (await frame.title()) === "AI-Hydro Studio")

const placeholderFrame = (page: Page, index: number, timeout = 60_000) =>
	findFrame(page, async (frame) => (await frame.locator(`body[data-contract-module="${index}"]`).count()) === 1, timeout)

async function openSidebar(page: Page): Promise<void> {
	await E2ETestHelper.openAiHydroSidebar(page)
	await findFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"), 30_000)
}

async function installPack(archive: string): Promise<string | undefined> {
	let response: Response | undefined
	await expect
		.poll(
			async () => {
				try {
					response = await fetch("http://127.0.0.1:9876/learning-pack-command", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							command: "aihydro.learningPacks.install",
							options: { archivePath: archive, approval: "install-once" },
						}),
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

interface PersistedProgress {
	currentModuleId: string | null
	completed: Record<string, unknown>
}

/** The host-written progress record (one course per profile in these tests); read-only, never written by the test. */
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

/** Titles the Studio shell puts on the Next button (CourseHeader NavBtn). */
/**
 * Mark the open module complete, check that the next module has unlocked (its Next button is enabled and
 * the tally moved), and open it. The shell may advance by itself shortly after the save; Next is clicked
 * only if it has not, so the walk neither skips a module nor stalls.
 */
async function completeAndOpenNext(page: Page, index: number, completedAfter: number, total: number): Promise<Frame> {
	const shell = await courseShell(page)
	await shell.getByTitle("Mark complete & continue to next module").evaluate((element: HTMLElement) => element.click())
	await expect(shell.getByTitle(`${completedAfter} of ${total} modules completed`)).toBeVisible({ timeout: 30_000 })
	await expect(shell.getByTitle(`Next: ${TITLES[MODULE_IDS[index + 1]]}`)).toBeEnabled({ timeout: 30_000 })
	await page.waitForTimeout(1_500)
	const advanced = await placeholderFrame(page, index + 1, 3_000).then(
		() => true,
		() => false,
	)
	if (!advanced) {
		const next = (await courseShell(page)).getByTitle(`Next: ${TITLES[MODULE_IDS[index + 1]]}`)
		await next.evaluate((element: HTMLElement) => element.click())
	}
	await placeholderFrame(page, index + 1)
	return courseShell(page)
}

// The shell pluralises "prerequisite" when the blocking title contains a comma (it counts commas, not
// modules), so a single prerequisite titled "Convert Depth, Volume, and Discharge" reads "prerequisites".
const lockedTitle = (prerequisiteTitle: string) =>
	new RegExp(`^Locked — complete prerequisites? first: ${prerequisiteTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)

contractE2E(
	"locks a module until its prerequisite is completed, unlocks it after completion and keeps progress across a restart, on the book's course graph @phase1-contract",
	async ({ lifecycle, workspaceDir, homeDir }) => {
		const total = MODULE_IDS.length
		const archive = path.join(workspaceDir, "graph.aihydropack")
		let { page } = await lifecycle.launch()
		await openSidebar(page)
		expect(await installPack(archive)).toBe("installed")

		// Entry module (no prerequisites): the next module is locked behind it and says why.
		await placeholderFrame(page, 0)
		let shell = await courseShell(page)
		await expect(shell.getByTitle(`0 of ${total} modules completed`)).toBeVisible({ timeout: 30_000 })
		const locked = shell.getByTitle(lockedTitle(TITLES[MODULE_IDS[0]]))
		await expect(locked).toBeVisible()
		await expect(locked).toBeDisabled({ timeout: 15_000 })
		expect(completedIds(homeDir)).toEqual([])

		// Completing the entry module unlocks the next one (its Next button becomes enabled) and opens it.
		shell = await completeAndOpenNext(page, 0, 1, total)
		await expect.poll(() => completedIds(homeDir), { timeout: 30_000 }).toEqual([MODULE_IDS[0]])

		// The module just opened is itself the prerequisite of the next one, so that one is locked until this
		// one is completed. Going back is allowed: its own prerequisites are met.
		const lockedAgain = shell.getByTitle(lockedTitle(TITLES[MODULE_IDS[1]]))
		await expect(lockedAgain).toBeDisabled({ timeout: 15_000 })
		await expect(shell.getByTitle(`Previous: ${TITLES[MODULE_IDS[0]]}`)).toBeEnabled({ timeout: 15_000 })

		shell = await completeAndOpenNext(page, 1, 2, total)
		await expect(shell.getByTitle(lockedTitle(TITLES[MODULE_IDS[2]]))).toBeDisabled({ timeout: 15_000 })
		const expected = [MODULE_IDS[0], MODULE_IDS[1]].sort()
		await expect.poll(() => completedIds(homeDir), { timeout: 30_000 }).toEqual(expected)
		await expect.poll(() => readProgress(homeDir)?.currentModuleId, { timeout: 30_000 }).toBe(MODULE_IDS[2])

		// Restart the application: progress and the unlocked state survive.
		const firstPid = await lifecycle.close()
		expect(firstPid).not.toBeNull()
		const relaunched = await lifecycle.launch()
		page = relaunched.page
		expect(relaunched.app.process().pid).not.toBe(firstPid)
		expect(completedIds(homeDir)).toEqual(expected)
		await openSidebar(page)
		expect(await installPack(archive)).toBe("noop")
		shell = await courseShell(page)
		await expect(shell.getByTitle(`2 of ${total} modules completed`)).toBeVisible({ timeout: 30_000 })
		// Module 2 reopens with its prerequisite (module 1) still counted, so Previous works and Next stays locked.
		await expect(shell.getByTitle(`Previous: ${TITLES[MODULE_IDS[1]]}`)).toBeEnabled({ timeout: 15_000 })
		await expect(shell.getByTitle(lockedTitle(TITLES[MODULE_IDS[2]]))).toBeDisabled({ timeout: 15_000 })
	},
)

/** A cell's frame once the per-document allowance is in effect and its Run button is wired. */
async function cellFrame(page: Page, cellId: string): Promise<Frame> {
	await allowArtifactExecution(page, cellId)
	return findFrame(page, async (frame) => (await frame.locator(`[data-aihydro-cell-id="${cellId}"]`).count()) === 1)
}

async function runCell(frame: Frame, cellId: string): Promise<void> {
	const run = frame.locator(`[data-aihydro-cell-id="${cellId}"] .aihydro-run`)
	await expect(run).toHaveAttribute("data-aihydro-wired", "1", { timeout: 30_000 })
	await run.evaluate((element: HTMLElement) => element.click())
}

const cellOutput = (frame: Frame, cellId: string) => frame.locator(`[data-aihydro-cell-id="${cellId}"] .aihydro-output`)

contractE2E.describe("executable cells in an installed pack", () => {
	contractE2E.skip(pythonSkip, "needs AIHYDRO_E2E_PYTHON")

	contractE2E(
		"computes, plots, reports an error, recovers after a kernel restart, completes a module to unlock the next and interrupts a busy cell @phase1-contract",
		async ({ lifecycle, workspaceDir }) => {
			requirePython()
			const { page } = await lifecycle.launch()
			await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort("blockedbyclient"))
			await openSidebar(page)
			expect(await installPack(path.join(workspaceDir, "exec.aihydropack"))).toBe("installed")

			let artifact = await cellFrame(page, "fixture-state-create")
			let shell = await courseShell(page)
			// The second module requires this one, so its Next button is locked until the first is completed.
			await expect(shell.getByTitle(lockedTitle("Compute and plot"))).toBeDisabled({ timeout: 15_000 })

			// Computation.
			await runCell(artifact, "fixture-state-create")
			await expect(cellOutput(artifact, "fixture-state-create")).toContainText("ending_storage=110.0 mm", {
				timeout: 60_000,
			})
			// Figure (a PNG produced by matplotlib in the kernel).
			await runCell(artifact, "fixture-state-read-plot")
			const image = artifact
				.locator(
					'[data-aihydro-cell-id="fixture-state-read-plot"] .aihydro-output-images img[src^="data:image/png;base64,"]',
				)
				.first()
			await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/, { timeout: 60_000 })
			expect(((await image.getAttribute("src")) ?? "").length).toBeGreaterThan(1_000)

			// Error, with the panel still usable afterwards.
			await runCell(artifact, "fixture-error")
			await expect(cellOutput(artifact, "fixture-error")).toContainText("intentional runtime-contract fixture error", {
				timeout: 30_000,
			})
			await expect(shell.getByTitle("More actions")).toBeVisible()

			// Recovery: restart the kernel, the state is gone, running the first cell again restores it.
			await shell.getByTitle("More actions").evaluate((element: HTMLElement) => element.click())
			await shell
				.locator('[role="menu"] button')
				.filter({ hasText: "Restart kernel" })
				.evaluate((element: HTMLElement) => element.click())
			await runCell(artifact, "fixture-state-read-plot")
			await expect(cellOutput(artifact, "fixture-state-read-plot")).toContainText(/storage_next|not defined/, {
				timeout: 30_000,
			})
			await runCell(artifact, "fixture-state-create")
			await expect(cellOutput(artifact, "fixture-state-create")).toContainText("ending_storage=110.0 mm", {
				timeout: 60_000,
			})

			// Completing the module unlocks the next one.
			shell = await courseShell(page)
			await shell.getByTitle("Mark complete & continue to next module").evaluate((element: HTMLElement) => element.click())
			await expect(shell.getByTitle("1 of 2 modules completed")).toBeVisible({ timeout: 30_000 })
			await expect(shell.getByTitle("Next: Interrupt a busy cell")).toBeEnabled({ timeout: 30_000 })
			await page.waitForTimeout(1_500)
			if (
				!(await findFrame(
					page,
					async (frame) => (await frame.locator('[data-aihydro-cell-id="interrupt-ready"]').count()) === 1,
					5_000,
				).then(
					() => true,
					() => false,
				))
			) {
				await (await courseShell(page))
					.getByTitle("Next: Interrupt a busy cell")
					.evaluate((element: HTMLElement) => element.click())
			}

			// Interruption: the cell writes a marker once it is running, so Stop is pressed while it executes.
			artifact = await cellFrame(page, "interrupt-ready")
			await runCell(artifact, "interrupt-ready")
			await expect(cellOutput(artifact, "interrupt-ready")).toContainText("interrupt_kernel_ready", { timeout: 60_000 })
			const marker = path.join(os.tmpdir(), "aihydro-interrupt-started-sleep")
			rmSync(marker, { force: true })
			await runCell(artifact, "interrupt-sleep")
			await expect.poll(() => existsSync(marker), { timeout: 60_000 }).toBe(true)
			const running = await findFrame(page, async (frame) => (await frame.getByTitle("Interrupt execution").count()) === 1)
			await running.getByTitle("Interrupt execution").click()
			await expect(cellOutput(artifact, "interrupt-sleep")).toContainText("KeyboardInterrupt", { timeout: 15_000 })
			await expect(cellOutput(artifact, "interrupt-sleep")).not.toContainText("interrupt_failed")
			rmSync(marker, { force: true })
			// The kernel and its variables survived the interrupt.
			await runCell(artifact, "interrupt-after")
			await expect(cellOutput(artifact, "interrupt-after")).toContainText("interrupt_state_kept=42", { timeout: 15_000 })
		},
	)
})

async function quickInput(page: Page, shortcut: string, text: string, row: string) {
	const input = page.locator(".quick-input-widget input:visible").last()
	const rowLocator = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: row }).first()
	let lastError: unknown
	for (let attempt = 1; attempt <= 4; attempt++) {
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
		await page.keyboard.press(shortcut)
		try {
			await input.waitFor({ state: "visible", timeout: 10_000 })
			await input.fill(text)
			await expect(rowLocator).toBeVisible({ timeout: 15_000 })
			return input
		} catch (error) {
			lastError = error
			await page.keyboard.press("Escape")
			await expect(input)
				.not.toBeVisible({ timeout: 5_000 })
				.catch(() => undefined)
		}
	}
	throw lastError
}

async function openWorkspaceDocument(page: Page, relativePath: string, addToStudio: boolean): Promise<void> {
	await openSidebar(page)
	const input = await quickInput(
		page,
		process.platform === "darwin" ? "Meta+P" : "Control+P",
		relativePath,
		path.basename(relativePath),
	)
	await page.keyboard.press("Enter")
	await expect(input).not.toBeVisible({ timeout: 10_000 })
	if (addToStudio) {
		const command = await quickInput(page, "F1", ">Add to AI-Hydro Studio", "Add to AI-Hydro Studio")
		await page.keyboard.press("Enter")
		await expect(command).not.toBeVisible({ timeout: 10_000 })
	}
}

contractE2E(
	"shows ordinary non-course documents as static documents with no course chrome and no execution path @phase1-contract",
	async ({ lifecycle }) => {
		const { page } = await lifecycle.launch()
		await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort("blockedbyclient"))

		// A plain HTML page that is not part of any course.
		await openWorkspaceDocument(page, "index.html", true)
		await findFrame(page, async (frame) => (await frame.getByRole("heading", { name: "Test Workspace" }).count()) === 1)
		let shell = await anyShell(page)
		await expect(shell.getByText("This is a static document.", { exact: false })).toBeVisible({ timeout: 15_000 })
		await expect(shell.getByTestId("artifact-trust-badge")).toHaveText("Static document")
		await expect(shell.getByTestId("artifact-trust-allow")).toHaveCount(0)
		await expect(shell.getByTitle("Course options")).toHaveCount(0)
		expect(await shell.locator("iframe").first().getAttribute("srcdoc")).not.toContain("artifact/cellRegistry")

		// A document that claims a module manifest and cells, and asks the kernel and the agent to act: refused.
		await openWorkspaceDocument(page, "untrusted-runcode.html", false)
		shell = await findFrame(page, async (frame) => {
			if ((await frame.title()) !== "AI-Hydro Studio") return false
			return ((await frame.locator("iframe").first().getAttribute("srcdoc")) ?? "").includes("untrusted-runcode-fixture")
		})
		await expect(shell.getByTestId("artifact-trust-badge")).toHaveText("Static document")
		await expect(shell.getByTitle("Course options")).toHaveCount(0)
		// Click only once the document has run its inline scripts, so its handlers exist.
		const artifact = await findFrame(
			page,
			async (frame) =>
				(await frame.locator("#untrusted-heading").count()) === 1 &&
				(await frame.evaluate(() => document.readyState)) === "complete",
		)
		await artifact.locator("#ask-kernel").evaluate((element: HTMLElement) => element.click())
		await expect(artifact.locator("#run-result")).toHaveAttribute("data-state", "denied", { timeout: 15_000 })
		await expect(artifact.locator("#run-result")).not.toContainText("should-never-run")
		await artifact.locator("#ask-agent").evaluate((element: HTMLElement) => element.click())
		await expect(shell.getByTestId("agent-handoff-notice")).toBeVisible({ timeout: 15_000 })
		await expect(shell.getByTestId("agent-handoff-prompt")).toHaveCount(0)
	},
)
