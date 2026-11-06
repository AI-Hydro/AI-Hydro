import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { type CDPSession, expect, type Frame, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import {
	createLearningPackTestArchive,
	createValidLearningPackFiles,
} from "../../services/learning-pack/__tests__/learningPackTestFixture"
import { E2ETestHelper, e2e } from "./utils/helpers"

/**
 * Opens a 12-module course of about 1.9 MB documents (the size of the Hydrologic Modeling book's modules)
 * one after another through the real Studio panel, and bounds what that costs.
 *
 * What it guards: every module lives in its own directory, and the Studio shell used to treat each new
 * directory as a new webview resource root. Each one reloaded the whole shell and replayed every document
 * opened so far to it, so the payload moved between the extension host and the webview grew with the square
 * of the number of modules. On a small machine that starved the VS Code window ("CodeWindow: recovered from
 * unresponsive") and the document being opened was replaced mid-test, which showed up as an empty output, a
 * missing cell frame or a missing Run bridge at module 4 to 10 depending on the run.
 *
 * The documents are synthetic filler (no course text). The bounds are on counters that do not depend on the
 * machine (shell mounts, documents pushed to the webview, live frames) plus loose guards on window
 * responsiveness and memory that a stuck or leaking panel exceeds by a wide margin.
 */

const EXTENSION_VERSION = (
	JSON.parse(readFileSync(path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "package.json"), "utf8")) as { version: string }
).version

const MODULE_COUNT = Number(process.env.LARGE_COURSE_MODULES ?? 12)
const MODULE_BYTES = 1_900_000
const MODULE_IDS = [
	"hmfp.orientation.00",
	...Array.from({ length: MODULE_COUNT - 1 }, (_, i) => `hmfp.large-module.${String(i + 1).padStart(2, "0")}`),
]

/** Deterministic filler so the document is large and not trivially repetitive. */
function largeModuleHtml(id: string, index: number): Uint8Array {
	const head = `<!doctype html><html><head><meta charset="utf-8"><title>${id}</title><script type="application/vnd.aihydro.module+json">${JSON.stringify(
		{
			id,
			title: id,
			version: "0.1.0",
			authors: [{ name: "Synthetic Test" }],
			license: "CC-BY-4.0",
			requires: { executable: false, python: [] },
		},
	)}</script></head><body data-large-module="${index}"><h1>${id}</h1>`
	const tail = "</body></html>"
	let seed = 12345 + index
	const next = () => {
		seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
		return seed
	}
	const rows: string[] = []
	let size = head.length + tail.length
	while (size < MODULE_BYTES) {
		const row = `<p data-row="${rows.length}">${Array.from({ length: 12 }, () => next().toString(36)).join(" ")}</p>\n`
		rows.push(row)
		size += row.length
	}
	return Buffer.from(head + rows.join("") + tail, "utf8")
}

const largeCourseE2E = e2e.extend<{ workspaceDir: string }>({
	workspaceDir: async ({}, use) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-large-course-workspace-"))
		const workspace = path.join(root, "workspace")
		cpSync(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"), workspace, { recursive: true })
		const { files } = createValidLearningPackFiles({
			aiHydroRange: `^${EXTENSION_VERSION}`,
			moduleIds: MODULE_IDS,
			moduleBytes: largeModuleHtml,
		})
		writeFileSync(path.join(workspace, "large.aihydropack"), createLearningPackTestArchive(files))
		try {
			await use(workspace)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	},
})
largeCourseE2E.setTimeout(300_000)

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
						// Frames are replaced while the panel loads.
					}
				}
				return false
			},
			{ timeout },
		)
		.toBe(true)
	return result as Frame
}

const studioShell = (page: Page) =>
	findFrame(
		page,
		async (frame) => (await frame.title()) === "AI-Hydro Studio" && (await frame.getByTitle("Course options").count()) === 1,
	)

const moduleFrame = (page: Page, index: number) =>
	findFrame(page, async (frame) => (await frame.locator(`body[data-large-module="${index}"]`).count()) === 1)

/** Working set by process type (window, GPU, renderers = window and webviews, utility = extension host), in MB. */
async function workingSetByType(app: ElectronApplication): Promise<Record<string, number>> {
	const metrics = await app.evaluate(({ app: electronApp }) =>
		electronApp.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })),
	)
	const byType: Record<string, number> = {}
	for (const m of metrics) byType[m.type] = (byType[m.type] ?? 0) + Math.round(m.kb / 1024)
	return byType
}

/**
 * JavaScript heap retained after a forced collection, summed over the window and every webview frame, in MB.
 * Unlike a process working set this does not depend on when the garbage collector last ran or on how much
 * memory the machine has, so its slope over the modules opened says whether anything is being retained.
 */
async function retainedHeapMb(page: Page): Promise<number> {
	let total = 0
	const seen = new Set<string>()
	for (const frame of page.frames()) {
		if (frame.isDetached()) continue
		let session: CDPSession | undefined
		try {
			session = await page.context().newCDPSession(frame)
			await session.send("HeapProfiler.collectGarbage")
			const usage = (await session.send("Runtime.getHeapUsage")) as { usedSize: number }
			// Frames of one process share a heap; count each heap once (same used size and total to the byte).
			const key = String(usage.usedSize)
			if (!seen.has(key)) {
				seen.add(key)
				total += usage.usedSize
			}
		} catch {
			// A frame can be replaced while sampling; the next module samples again.
		} finally {
			await session?.detach().catch(() => undefined)
		}
	}
	return Math.round(total / 1024 / 1024)
}

/** Least-squares slope of `values` against their index (MB per module). */
function leastSquaresSlope(values: number[]): number {
	const n = values.length
	const meanX = (n - 1) / 2
	const meanY = values.reduce((sum, v) => sum + v, 0) / n
	let num = 0
	let den = 0
	values.forEach((v, i) => {
		num += (i - meanX) * (v - meanY)
		den += (i - meanX) ** 2
	})
	return den === 0 ? 0 : num / den
}

largeCourseE2E(
	"opens twelve 1.9 MB modules in sequence without reloading the shell or replaying documents @phase1-large-course",
	async ({ app, page, workspaceDir }) => {
		// Counters from the console, which forwards the extension host's log and the shell's debug lines.
		const shellInstances = new Set<string>()
		let documentPushes = 0
		let snapshots = 0
		let snapshotBytes = 0
		const rootChanges: string[] = []
		page.on("console", (message) => {
			const text = message.text()
			const instance = text.match(/\[HtmlPreviewContext:([a-z0-9]+)\]/)
			if (instance) shellInstances.add(instance[1])
			if (text.includes("[subscribeToHtmlPreviews] Streaming preview to client")) documentPushes++
			if (text.includes("[getHtmlPreviewStateSince] sent")) {
				snapshots++
				snapshotBytes += Number(text.match(/contentBytes=(\d+)/)?.[1] ?? 0)
			}
			if (text.includes("resource roots changed"))
				rootChanges.push(text.slice(text.indexOf("added:"), text.indexOf("added:") + 400))
		})

		// Longest stall of the VS Code window's main thread while the walk runs. The window is what Electron
		// reports as "unresponsive"; a healthy walk keeps it far below that.
		await page.evaluate(() => {
			const probe = { maxStallMs: 0, last: performance.now() }
			;(window as unknown as { __stall: typeof probe }).__stall = probe
			setInterval(() => {
				const now = performance.now()
				probe.maxStallMs = Math.max(probe.maxStallMs, now - probe.last - 100)
				probe.last = now
			}, 100)
		})

		await E2ETestHelper.openAiHydroSidebar(page)
		await findFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"), 30_000)
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
								options: { archivePath: path.join(workspaceDir, "large.aihydropack"), approval: "install-once" },
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
		expect(((await response!.json()) as { result?: { status?: string } }).result?.status).toBe("installed")

		const samples: {
			module: number
			memoryMb: number
			byType: Record<string, number>
			heapMb: number
			frames: number
			pushes: number
			shells: number
			ms: number
		}[] = []
		await moduleFrame(page, 0)
		for (let index = 0; index < MODULE_COUNT; index++) {
			const startedAt = Date.now()
			if (index > 0) {
				const shell = await studioShell(page)
				const complete = shell.getByTitle("Mark complete & continue to next module")
				await expect(complete).toBeVisible({ timeout: 30_000 })
				await complete.evaluate((element: HTMLElement) => element.click())
				const next = shell.getByTitle(`Next: ${MODULE_IDS[index]}`)
				await expect(next).toBeEnabled({ timeout: 30_000 })
				await next.evaluate((element: HTMLElement) => element.click())
				await moduleFrame(page, index)
			}
			// Let garbage collection and the panel settle so the sample is retained memory, not a transient.
			await page.waitForTimeout(1_500)
			const byType = await workingSetByType(app)
			samples.push({
				module: index,
				memoryMb: Object.values(byType).reduce((sum, mb) => sum + mb, 0),
				byType,
				heapMb: await retainedHeapMb(page),
				frames: page.frames().filter((frame) => !frame.isDetached()).length,
				pushes: documentPushes,
				shells: shellInstances.size,
				ms: Date.now() - startedAt,
			})
		}
		const maxStallMs = Math.round(
			await page.evaluate(() => (window as unknown as { __stall: { maxStallMs: number } }).__stall.maxStallMs),
		)
		console.log(
			"[large-course]",
			JSON.stringify({
				samples,
				maxStallMs,
				snapshots,
				snapshotBytes,
				documentPushes,
				shellInstances: shellInstances.size,
				rootChanges: rootChanges.slice(0, 4),
			}),
		)

		// Webviews are reused, not accumulated: the live frame count is flat while the course advances.
		const frameCounts = samples.map((sample) => sample.frames)
		expect(Math.max(...frameCounts) - Math.min(...frameCounts)).toBeLessThanOrEqual(3)

		// One shell for the whole walk. A second mount is allowed for the first resource-root change when the
		// pack is registered; one mount per module is the failure this test exists to catch.
		expect(shellInstances.size).toBeLessThanOrEqual(3)
		// Floors: the counters must have seen the walk, or the upper bounds above would pass on silence.
		expect(shellInstances.size).toBeGreaterThanOrEqual(1)
		expect(documentPushes).toBeGreaterThanOrEqual(MODULE_COUNT)
		// Snapshots still carry every document opened so far (a known quadratic term, tracked as a follow-up),
		// so their count is bounded: about five per module today. This stops it growing unnoticed.
		expect(snapshots).toBeGreaterThanOrEqual(MODULE_COUNT)
		expect(snapshots).toBeLessThanOrEqual(MODULE_COUNT * 7 + 10)
		expect(snapshotBytes).toBeGreaterThan(0)

		// Documents pushed to the webview grow with the modules opened, not with their square. Opening a
		// module registers it once and allowing or completing it pushes it again, so allow a few per module
		// plus the initial snapshot; replaying all documents on every module would be several hundred.
		expect(documentPushes).toBeLessThanOrEqual(MODULE_COUNT * 5 + 10)

		// Snapshot payload is linear in the modules opened. Every snapshot used to carry the HTML of every document
		// opened so far (about five snapshots per module, each k documents); now a document the shell already
		// holds is not sent again, so the whole walk moves a small multiple of the documents' own size.
		expect(snapshotBytes).toBeLessThanOrEqual(MODULE_COUNT * MODULE_BYTES * 3)

		// Retained memory grows by about one document per module, not by a multiple of it: the JavaScript heap
		// left after a forced collection, summed over the window and the webviews, is compared across the walk
		// as a slope, which does not depend on the machine or on when its garbage collector last ran. (Process
		// working sets are reported in the samples but not bounded: they follow the allocator and the OS.)
		const heap = samples.map((sample) => sample.heapMb)
		const slope = leastSquaresSlope(heap)
		expect(slope).toBeLessThan((MODULE_BYTES / 1024 / 1024) * 3)

		// The window stayed responsive (Electron marks a window unresponsive after a multi-second stall).
		expect(maxStallMs).toBeLessThan(5_000)
	},
)
