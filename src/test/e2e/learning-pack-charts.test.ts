import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import {
	createLearningPackTestArchive,
	createValidLearningPackFiles,
	TEST_MODULE_IDS,
} from "../../services/learning-pack/__tests__/learningPackTestFixture"
import { allowArtifactExecution, E2ETestHelper, e2e } from "./utils/helpers"

const EXTENSION_VERSION = (
	JSON.parse(readFileSync(path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "package.json"), "utf8")) as { version: string }
).version

/** Hosts the bridge helpers used to load chart libraries from. No request to either may leave the panel. */
const CHART_CDN_PATTERNS = ["https://cdn.plot.ly/**", "https://cdn.jsdelivr.net/**"]

const chartPackE2E = e2e.extend<{ workspaceDir: string }>({
	workspaceDir: async ({}, use) => {
		const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-pack-charts-workspace-"))
		const workspace = path.join(root, "workspace")
		cpSync(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"), workspace, { recursive: true })
		// An executable module whose figures come from the two bridge helpers a lesson author reaches for:
		// aihydro.plot (Plotly) and aihydro.scene3d (three.js). The module itself carries no library code.
		const entryHtml = Buffer.from(`<!doctype html><html><head>
			<script type="application/vnd.aihydro.module+json">${JSON.stringify({
				id: TEST_MODULE_IDS[0],
				title: "Synthetic chart pack",
				version: "0.1.0",
				authors: [{ name: "Synthetic Test" }],
				license: "CC-BY-4.0",
				requires: { executable: true, python: ["matplotlib"] },
			})}</script>
		</head><body data-phase1-chart-pack="true">
			<h1>Chart pack</h1>
			<div id="chart" style="width:480px;height:240px"></div>
			<canvas id="terrain" data-aihydro-scene3d width="320" height="200"></canvas>
			<script>
			window.addEventListener("load", function () {
				aihydro.plot({ mount: "#chart", data: [{ x: [1, 2, 3], y: [2, 1, 3], type: "scatter" }] });
				aihydro.scene3d({ canvas: "#terrain" }).then(function (ctx) { window.__sceneResolved = ctx ? "context" : "null"; });
			});
			</script>
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

async function findChartFrame(page: Page): Promise<Frame | undefined> {
	for (const frame of page.frames()) {
		if (frame.isDetached()) continue
		try {
			if ((await frame.locator('body[data-phase1-chart-pack="true"]').count()) === 1) return frame
		} catch {
			// frame replaced while the panel settles
		}
	}
	return undefined
}

chartPackE2E(
	"installed pack Plotly and three.js helpers load from the extension, not a CDN @phase1-charts",
	async ({ page, workspaceDir }) => {
		const cdnRequests: string[] = []
		for (const pattern of CHART_CDN_PATTERNS) {
			await page.route(pattern, async (route) => {
				cdnRequests.push(route.request().url())
				await route.abort()
			})
		}
		await E2ETestHelper.openAiHydroSidebar(page)
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
		expect(((await commandResponse!.json()) as { result?: { status?: string } }).result?.status).toBe("installed")

		// The bridge (and so aihydro.plot / aihydro.scene3d) exists only once the user allows execution.
		await allowArtifactExecution(page)

		let chart: Frame | undefined
		await expect
			.poll(
				async () => {
					chart = await findChartFrame(page)
					return Boolean(chart)
				},
				{ timeout: 30_000 },
			)
			.toBe(true)

		// Rule out wiring: the helpers must exist, so a missing chart is the library failing to load.
		await expect
			.poll(() =>
				chart!.evaluate(() => {
					const a = (window as Window & { aihydro?: { plot?: unknown; scene3d?: unknown } }).aihydro
					return typeof a?.plot === "function" && typeof a?.scene3d === "function"
				}),
			)
			.toBe(true)

		// Plotly drew into the mount point: it adds a .js-plotly-plot container with an SVG.
		await expect(chart!.locator("#chart.js-plotly-plot svg.main-svg").first()).toBeAttached({ timeout: 30_000 })
		// three.js and its OrbitControls loaded and the helper settled (a WebGL context may be unavailable on a
		// hosted runner, in which case the helper resolves null; the library must still have loaded).
		await expect
			.poll(() =>
				chart!.evaluate(() => {
					const w = window as Window & { THREE?: { REVISION?: string; OrbitControls?: unknown } }
					return Boolean(w.THREE?.REVISION) && Boolean(w.THREE?.OrbitControls)
				}),
			)
			.toBe(true)
		await expect
			.poll(() => chart!.evaluate(() => (window as Window & { __sceneResolved?: string }).__sceneResolved), {
				timeout: 30_000,
			})
			.toBeDefined()
		expect(cdnRequests).toEqual([])
	},
)
