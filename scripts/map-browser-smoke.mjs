/** Actual MapView/WebGL smoke test with synthetic data and mocked host/network boundaries. */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "../webview-ui/node_modules/vite/dist/node/index.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const webview = resolve(root, "webview-ui")
const clients = [...readFileSync(resolve(webview, "src/services/grpc-client.ts"), "utf8").matchAll(/export class (\w+)/g)].map(
	(match) => match[1],
)
const fixture = [
	{
		id: "smoke-stations",
		name: "Synthetic smoke stations",
		layerType: "geojson",
		visible: true,
		geojson: JSON.stringify({
			type: "FeatureCollection",
			features: [{ type: "Feature", geometry: { type: "Point", coordinates: [80, 25] }, properties: { fixture: true } }],
		}),
		style: { fillColor: "#ff0000" },
		metadata: { source_status: "synthetic", units: "not applicable" },
	},
]
const server = await createServer({
	configFile: false,
	root: webview,
	logLevel: "warn",
	server: { host: "127.0.0.1", port: 0 },
	esbuild: { jsx: "automatic" },
	define: { __PLATFORM__: JSON.stringify("vscode") },
	resolve: {
		alias: {
			"@shared": resolve(root, "src/shared"),
			"@": resolve(webview, "src"),
			"@components": resolve(webview, "src/components"),
			"@context": resolve(webview, "src/context"),
			"@utils": resolve(webview, "src/utils"),
		},
	},
	plugins: [
		{
			name: "map-smoke-fixtures",
			enforce: "pre",
			resolveId(id) {
				if (id.endsWith("services/grpc-client")) return "\0smoke-grpc"
				if (id.endsWith("context/MapContext")) return "\0smoke-context"
				if (id === "/smoke-entry.jsx") return "\0smoke-entry"
			},
			load(id) {
				if (id === "\0smoke-grpc")
					return `const client = new Proxy({}, {get: (_, name) => name === "prepareMapExport" ? async () => ({accepted: true, basePath: "/synthetic-smoke-no-disk-write"}) : name === "saveMapExport" ? async request => {window.__savedMapExport = request; return {ok: true, outputs: []}} : name.startsWith("subscribe") ? () => () => {} : async request => {if (name === "reportMapEvent") (window.__mapEvents ??= []).push(request?.event?.type); return {}}}); ${clients.map((name) => `export const ${name} = client;`).join("\n")}`
				if (id === "\0smoke-context")
					return `const state = {layers: ${JSON.stringify(fixture)}, connectionStatus: "connected", restoreState: {hydrating: false, olderCount: 0}, restoreOlderLayers: async () => 0, reconnect: () => {}}; export const useMapContext = () => state;`
				if (id === "\0smoke-entry")
					return `import "/src/index.css"; import React from "react"; import {createRoot} from "react-dom/client"; import {MapView} from "/src/components/map/MapView.tsx"; import {BrushContextProvider} from "/src/context/BrushContext.tsx"; createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode, null, React.createElement(BrushContextProvider, null, React.createElement(MapView))));`
			},
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if (req.url !== "/") return next()
					res.setHeader("Content-Type", "text/html")
					res.end(
						'<html><body style="margin:0;background:#171717;color:white;font-family:Arial"><div id="root" style="width:1100px;height:750px"></div><script type="module" src="/smoke-entry.jsx"></script></body></html>',
					)
				})
			},
		},
	],
})
let browser
try {
	await server.listen()
	browser = await chromium.launch({
		headless: true,
		args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
	})
	const page = await browser.newPage({ viewport: { width: 1100, height: 750 } })
	await page.addInitScript(() => {
		window.__PLATFORM__ = "vscode"
		window.acquireVsCodeApi = () => ({
			postMessage() {},
			getState() {
				return {}
			},
			setState() {},
		})
	})
	// Seed a saved transect and an annotation so every overlay layer is live (the renderer crash needs them).
	await page.addInitScript(() => {
		const now = new Date().toISOString()
		localStorage.setItem(
			"aihydro.map.transects.v1",
			JSON.stringify([
				{
					id: "smoke_transect",
					name: "Smoke profile",
					notes: "",
					aiPrompt: "",
					geometry: {
						type: "LineString",
						coordinates: [
							[79.9, 24.9],
							[80.1, 25.1],
						],
					},
					color: "#f97316",
					tags: [],
					collectionIds: [],
					status: "open",
					priority: null,
					createdAt: now,
					updatedAt: now,
				},
			]),
		)
		localStorage.setItem(
			"aihydro.map.annotations.v2",
			JSON.stringify([
				{
					id: "smoke_annotation",
					name: "Smoke annotation",
					notes: "",
					aiPrompt: "",
					color: "#3b82f6",
					type: "point",
					geometry: { type: "Point", coordinates: [80.05, 25.02] },
					tags: [],
					images: [],
					collectionIds: [],
					status: "open",
					priority: "low",
					createdAt: now,
					updatedAt: now,
				},
			]),
		)
	})
	const errors = []
	page.on("pageerror", (error) => {
		errors.push(error.message)
		console.error("Browser error:", error.message)
	})

	const png = await page.evaluate(() => {
		const canvas = document.createElement("canvas")
		canvas.width = canvas.height = 16
		const ctx = canvas.getContext("2d")
		ctx.fillStyle = "#324454"
		ctx.fillRect(0, 0, 16, 16)
		return canvas.toDataURL().split(",")[1]
	})
	let failing = true
	// Every external request is logged (to assert zoom/extent limits) and answered locally; no real provider
	// requests or credentials.
	const requested = []
	const requestedAt = []
	await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
		requested.push(route.request().url())
		requestedAt.push(Date.now())
		return route.fulfill(
			failing
				? { status: 403, body: "intentional smoke failure" }
				: {
						status: 200,
						contentType: "image/png",
						headers: { "Access-Control-Allow-Origin": "*" },
						body: Buffer.from(png, "base64"),
					},
		)
	})
	await page.goto(server.resolvedUrls.local[0], { waitUntil: "networkidle", timeout: 120000 })
	await page.locator("canvas#ai-hydro-research-map").waitFor({ timeout: 30000 })
	await page.getByRole("alert").filter({ hasText: "HTTP 403" }).waitFor({ timeout: 30000 })
	// Renderer lifecycle: Retry (still failing, three times), a forced WebGL context restore and swipe mode all
	// remount a Deck. Each must hand it fresh layer instances (no "deck.gl: assertion failed" renderer error).
	const noRendererError = async (label) => {
		await page.waitForTimeout(700)
		const alerts = (await page.getByRole("alert").allTextContents()).join(" | ")
		assert.equal(
			await page.getByText("Map renderer", { exact: false }).count(),
			0,
			`${label}: renderer error shown: ${alerts}`,
		)
		assert.equal(await page.getByText("assertion", { exact: false }).count(), 0, `${label}: assertion text shown`)
		assert.deepEqual(errors, [], `${label}: uncaught browser errors`)
	}
	for (let i = 1; i <= 3; i++) {
		await page.getByRole("button", { name: "Retry imagery", exact: true }).click()
		await page.getByRole("alert").filter({ hasText: "HTTP 403" }).waitFor({ timeout: 30000 })
		await noRendererError(`retry ${i}`)
	}
	await page
		.locator("canvas#ai-hydro-research-map")
		.evaluate((canvas) => canvas.dispatchEvent(new Event("webglcontextrestored")))
	await page.locator("canvas#ai-hydro-research-map").waitFor({ timeout: 30000 })
	await noRendererError("context restore")
	// Rare tools live in the More menu on the 40 px rail (map-polish MP1).
	const openFromMore = async (name) => {
		await page.getByRole("button", { name: "More tools", exact: true }).click()
		await page.getByRole("menuitem", { name }).click()
	}
	await openFromMore(/^Swipe/)
	await page.getByLabel("Enable Swipe Tool").check()
	await page.locator("canvas").nth(1).waitFor({ timeout: 30000 })
	await noRendererError("swipe mode")
	await page.getByRole("button", { name: "Retry imagery", exact: true }).click()
	await noRendererError("retry in swipe mode")
	await page.getByLabel("Enable Swipe Tool").uncheck({ timeout: 90000 })
	await page.getByRole("button", { name: "Close panel", exact: true }).click()
	await openFromMore("Export snapshot")
	assert.equal(await page.getByRole("button", { name: "Research Plate Export", exact: true }).isDisabled(), true)
	// Export is a modal sheet now: close it (Escape) to reach the map, then reopen it to check readiness.
	await page.keyboard.press("Escape")
	await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10000 })
	failing = false
	await page.getByRole("button", { name: "Retry imagery", exact: true }).click()
	await page.getByRole("alert").waitFor({ state: "hidden", timeout: 30000 })
	await page.waitForLoadState("networkidle")
	await page.waitForTimeout(1000)
	assert.equal(await page.getByRole("alert").count(), 0)
	await openFromMore("Export snapshot")
	assert.equal(await page.getByRole("button", { name: "Research Plate Export", exact: true }).isEnabled(), true)
	await page.keyboard.press("Escape")
	await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10000 })
	assert.deepEqual(errors, [])
	// Basemap limits: the default is the muted Esri Gray Canvas base; the USGS hydrography overlay is US-only and
	// the station is in India, so it must not be requested at all (extent); and zooming far past the source's
	// native zoom must overzoom, never request a level the source does not serve.
	assert.ok(
		requested.some((url) => /World_(Light|Dark)_Gray_Base/.test(url)),
		"default basemap should be Esri Gray Canvas",
	)
	assert.equal(requested.filter((url) => /USGSHydroCached/.test(url)).length, 0, "US-only overlay requested outside its extent")
	// The map may already sit at the source's last native level, where overzoom needs no new tiles, so the
	// zoom check covers every basemap tile requested in the whole run, not only those after the zoom clicks.
	for (let i = 0; i < 18; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click()
	await page.waitForLoadState("networkidle")
	await page.waitForTimeout(1000)
	const zooms = requested
		.map((url) => Number((url.match(/\/tile\/(\d+)\/\d+\/\d+(?:\?|$)/) ?? url.match(/\/(\d+)\/\d+\/\d+\.png/))?.[1]))
		.filter(Number.isFinite)
	assert.ok(zooms.length > 0, "the basemap should request tiles")
	assert.ok(Math.max(...zooms) <= 16, `tile requested past native zoom: z=${Math.max(...zooms)}`)
	assert.deepEqual(errors, [])
	const canvas = await page.locator("canvas#ai-hydro-research-map").evaluate((canvas) => {
		const copy = document.createElement("canvas")
		copy.width = canvas.width
		copy.height = canvas.height
		const ctx = copy.getContext("2d")
		ctx.drawImage(canvas, 0, 0)
		const data = ctx.getImageData(0, 0, copy.width, copy.height).data
		let redPixels = 0
		for (let i = 0; i < data.length; i += 4)
			if (data[i] > 100 && data[i] > data[i + 1] * 2 && data[i] > data[i + 2] * 2) redPixels++
		return { width: canvas.width, height: canvas.height, capture: canvas.toDataURL(), redPixels }
	})
	assert.ok(canvas.redPixels > 0, "Synthetic red station must actually render")
	assert.ok(canvas.width > 0 && canvas.height > 0 && canvas.capture.length > 100)
	// Falsifier for docking (map-polish §12): a docked panel resizes the deck canvas on every toggle. A frame over
	// 100 ms, or a burst of tile requests, right after a toggle means the plan falls back to overlay. requestAnimationFrame
	// timestamps are recorded in the page, aligned to wall-clock time, and compared with idle windows of the same length.
	await page.evaluate(() => {
		window.__frames = []
		let last = performance.now()
		const tick = (t) => {
			window.__frames.push([performance.timeOrigin + t, t - last])
			last = t
			requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	})
	const WINDOW_MS = 700
	const wallClock = () => page.evaluate(() => performance.timeOrigin + performance.now())
	const sum = (xs) => xs.reduce((a, b) => a + b, 0)
	// One run = 12 Layers-panel toggles and 12 idle windows at the given map width. 1100 px docks the panel (the canvas
	// resizes); 900 px floats it over the canvas (same panel render, no canvas resize), which is the control.
	const probeRun = async (mapWidth) => {
		await page.evaluate((w) => {
			document.getElementById("root").style.width = `${w}px`
		}, mapWidth)
		await page.waitForTimeout(800)
		const mode = await page.evaluate(() =>
			document.querySelector("[data-map-chrome-root]")?.getAttribute("data-map-chrome-mode"),
		)
		const toggle = []
		const idle = []
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(400)
			const idleStart = await wallClock()
			await page.waitForTimeout(WINDOW_MS)
			idle.push([idleStart, idleStart + WINDOW_MS])
			const start = await wallClock()
			await page.getByRole("button", { name: /^Layer manager/ }).click()
			await page.waitForTimeout(WINDOW_MS)
			toggle.push([start, start + WINDOW_MS])
		}
		const frames = await page.evaluate(() => window.__frames)
		const worst = (list) =>
			Math.max(
				0,
				...list.map(([from, to]) =>
					Math.max(0, ...frames.filter(([end]) => end > from && end <= to).map(([, dt]) => dt)),
				),
			)
		const per = (list) => list.map((w) => Number(worst([w]).toFixed(0)))
		const requestsIn = (list) => sum(list.map(([from, to]) => requestedAt.filter((t) => t > from && t <= to).length))
		const sorted = per(toggle).sort((a, b) => a - b)
		return {
			mapWidth,
			panelMode: mode,
			worstFrameMsAfterToggle: Math.max(...sorted),
			medianWorstFrameMsAfterToggle: sorted[Math.floor(sorted.length / 2)],
			worstFrameMsIdle: Number(worst(idle).toFixed(1)),
			tileRequestsAfterToggles: requestsIn(toggle),
			tileRequestsIdle: requestsIn(idle),
		}
	}
	const docked = await probeRun(1100)
	const overlay = await probeRun(900)
	const frameProbe = {
		method: "requestAnimationFrame deltas in headless Chromium with SwiftShader (software) GL; 12 toggles per mode, 700 ms windows, idle windows for scale",
		docked,
		overlayControl: overlay,
	}
	await page.evaluate(() => {
		document.getElementById("root").style.width = "1100px"
	})
	assert.equal(docked.panelMode, "docked")
	assert.equal(overlay.panelMode, "overlay")
	assert.ok((await page.evaluate(() => window.__frames.length)) > 100, "rAF should be running")
	console.log(JSON.stringify({ frameProbe }))
	// Software GL redraws a full-size deck canvas in tens of ms, so the plan's absolute 100 ms line cannot be judged here
	// (the overlay control that never resizes the canvas is over it too). What this gate can show is that docking is not
	// worse than floating, and that a resize does not trigger a tile request burst.
	assert.ok(
		docked.medianWorstFrameMsAfterToggle <= overlay.medianWorstFrameMsAfterToggle + 50,
		`docking is slower than floating: median worst frame ${docked.medianWorstFrameMsAfterToggle} ms vs ${overlay.medianWorstFrameMsAfterToggle} ms`,
	)
	assert.ok(
		docked.tileRequestsAfterToggles <= 12,
		`tile request burst after docked toggles: ${docked.tileRequestsAfterToggles}`,
	)
	await openFromMore("Export snapshot")
	await page.getByRole("button", { name: "Quick Export", exact: true }).click()
	await page.waitForFunction(() => Boolean(window.__savedMapExport), { timeout: 30000 })
	const saved = await page.evaluate(() => window.__savedMapExport)
	assert.equal(saved.artifacts.length, 1)
	assert.equal(saved.artifacts[0].format, "png")
	assert.ok(saved.artifacts[0].dataBase64.length > 100)
	const manifest = JSON.parse(saved.manifestJson)
	assert.equal(manifest.rendered.renderState.basemapReady, null)
	assert.equal(manifest.visibleLayers[0].metadata.source_status, "synthetic")
	assert.ok(manifest.warnings.some((warning) => warning.code === "RENDER_COMPLETENESS_UNVERIFIED"))
	assert.deepEqual(errors, [])
	// MP2 (X1-M2): double-click zooms the map and creates no pin; the P tool places one, which gets a card, can be
	// deleted with the Delete key and brought back with Undo; the context menu offers one "Add pin".
	await page.keyboard.press("Escape")
	await page
		.getByRole("dialog")
		.waitFor({ state: "detached", timeout: 10000 })
		.catch(() => {})
	const pointCount = () =>
		page.evaluate(
			() => JSON.parse(localStorage.getItem("aihydro.map.annotations.v2") ?? "[]").filter((a) => a.type === "point").length,
		)
	const pinNames = () =>
		page.evaluate(() => JSON.parse(localStorage.getItem("aihydro.map.annotations.v2") ?? "[]").map((a) => a.name))
	const mapZoom = async () => {
		await page.mouse.move(1099, 749) // off the canvas: the readout falls back to the zoom
		await page.waitForFunction(() => /^z /.test(document.querySelector(".map-coords-btn")?.textContent ?? ""), null, {
			timeout: 5000,
		})
		return Number((await page.locator(".map-coords-btn").textContent()).replace("z ", ""))
	}
	for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Zoom out", exact: true }).click()
	await page.waitForTimeout(800)
	const box = await page.locator("canvas#ai-hydro-research-map").boundingBox()
	const centre = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 + 80 }
	const pinsBefore = await pointCount()
	const zoomBefore = await mapZoom()
	const inspectBefore = (await page.evaluate(() => window.__mapEvents ?? [])).filter((t) => t === "inspect.click").length
	await page.mouse.dblclick(centre.x, centre.y)
	// The zoom animates; on a slow machine it takes longer, so wait for it to settle instead of for a fixed time.
	let zoomAfter = await mapZoom()
	for (let i = 0; i < 40 && zoomAfter - zoomBefore <= 0.5; i++) {
		await page.waitForTimeout(250)
		zoomAfter = await mapZoom()
	}
	await page.waitForTimeout(500)
	zoomAfter = await mapZoom()
	const inspectAfter = (await page.evaluate(() => window.__mapEvents ?? [])).filter((t) => t === "inspect.click").length
	assert.equal(await pointCount(), pinsBefore, "double-click must not create a pin")
	assert.ok(zoomAfter - zoomBefore > 0.5, `double-click should zoom in: ${zoomBefore} -> ${zoomAfter}`)
	assert.ok(inspectAfter - inspectBefore <= 1, `double-click emitted ${inspectAfter - inspectBefore} inspect.click events`)
	console.log(JSON.stringify({ doubleClick: { zoomBefore, zoomAfter, inspectClicks: inspectAfter - inspectBefore } }))
	await page.keyboard.press("Escape") // close any identify popover the first click opened
	// P, then click: one pin, with its card and the name field focused.
	await page.keyboard.press("p")
	await page.getByText("Pin tool: click the map", { exact: false }).waitFor({ timeout: 5000 })
	await page.mouse.click(box.x + 200, box.y + 200)
	const card = page.getByTestId("pin-card")
	await card.waitFor({ timeout: 5000 })
	assert.equal(await pointCount(), pinsBefore + 1)
	assert.equal(await page.getByLabel("Pin name").evaluate((el) => el === document.activeElement), true, "name is focused")
	await page.getByLabel("Pin name").fill("Test dam")
	await page.keyboard.press("Enter")
	await page.waitForFunction(() =>
		JSON.parse(localStorage.getItem("aihydro.map.annotations.v2") ?? "[]").some((a) => a.name === "Test dam"),
	)
	assert.equal(await page.getByText("__annotations-overlay", { exact: false }).count(), 0, "internal layer id is shown")
	// Delete with the key, then Undo from the toast: the pin returns with its name.
	await page.keyboard.press("Delete")
	await page.waitForFunction(
		() => !JSON.parse(localStorage.getItem("aihydro.map.annotations.v2") ?? "[]").some((a) => a.name === "Test dam"),
	)
	assert.equal(await pointCount(), pinsBefore)
	await page.getByRole("button", { name: "Undo", exact: true }).click()
	await page.waitForFunction(() =>
		JSON.parse(localStorage.getItem("aihydro.map.annotations.v2") ?? "[]").some((a) => a.name === "Test dam"),
	)
	assert.equal(await pointCount(), pinsBefore + 1)
	await page.keyboard.press("Escape") // the pin tool stays armed until Esc
	await page.keyboard.press("Escape") // then the card
	// Right-click on empty map: one "Add pin", no "Drop pin" or "Add annotation".
	await page.mouse.click(box.x + 20, box.y + 20, { button: "right" })
	const menu = page.getByRole("menu", { name: "Map actions" })
	await menu.waitFor({ timeout: 5000 })
	const items = await menu.getByRole("menuitem").allTextContents()
	assert.equal(items.filter((t) => /pin/i.test(t)).length, 1, `menu items: ${items.join(" | ")}`)
	assert.equal(items.filter((t) => /annotation|drop pin/i.test(t)).length, 0)
	await menu.getByRole("menuitem", { name: "Add pin" }).click()
	await card.waitFor({ timeout: 5000 })
	assert.equal(await pointCount(), pinsBefore + 2)
	assert.deepEqual(errors, [])
	await page.screenshot({ path: "/tmp/aihydro-map-smoke.png" })
	console.log(
		JSON.stringify({
			result: "passed",
			checks: [
				"actual MapView WebGL mount",
				"visible HTTP failure",
				"research export blocked",
				"retry x3, WebGL context restore and swipe mode without a renderer error",
				"retry recovery",
				"muted default basemap, US-only overlay not requested outside its extent, no tile past native zoom",
				"rendered station pixels",
				"readable canvas",
				"PNG composition and provenance bridge",
				"double-click zooms and creates no pin; P, click, card, Delete, Undo; one Add pin in the context menu",
				"no uncaught browser errors",
			],
			fixture: "synthetic, host/network mocked",
			screenshot: "/tmp/aihydro-map-smoke.png",
		}),
	)
} finally {
	await browser?.close()
	await server.close()
}
