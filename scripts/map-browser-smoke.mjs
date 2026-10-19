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
					return `const client = new Proxy({}, {get: (_, name) => name === "prepareMapExport" ? async () => ({accepted: true, basePath: "/synthetic-smoke-no-disk-write"}) : name === "saveMapExport" ? async request => {window.__savedMapExport = request; return {ok: true, outputs: []}} : name.startsWith("subscribe") ? () => () => {} : async () => ({})}); ${clients.map((name) => `export const ${name} = client;`).join("\n")}`
				if (id === "\0smoke-context")
					return `const state = {layers: ${JSON.stringify(fixture)}, connectionStatus: "connected", reconnect: () => {}}; export const useMapContext = () => state;`
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
					geometry: { type: "LineString", coordinates: [[79.9, 24.9], [80.1, 25.1]] },
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
	await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
		requested.push(route.request().url())
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
		assert.equal(await page.getByText("Map renderer", { exact: false }).count(), 0, `${label}: renderer error shown: ${alerts}`)
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
	await page.getByRole("button", { name: /^Swipe/ }).click()
	await page.getByLabel("Enable Swipe Tool").check()
	await page.locator("canvas").nth(1).waitFor({ timeout: 30000 })
	await noRendererError("swipe mode")
	await page.getByRole("button", { name: "Retry imagery", exact: true }).click()
	await noRendererError("retry in swipe mode")
	await page.getByLabel("Enable Swipe Tool").uncheck({ timeout: 90000 })
	await page.getByRole("button", { name: "Close panel", exact: true }).click()
	await page.getByRole("button", { name: "Export snapshot", exact: true }).click()
	assert.equal(await page.getByRole("button", { name: "Research Plate Export", exact: true }).isDisabled(), true)
	// Keep export readiness visible while retrying the underlying map.
	failing = false
	await page.getByRole("button", { name: "Retry imagery", exact: true }).click()
	await page.getByRole("alert").waitFor({ state: "hidden", timeout: 30000 })
	await page.waitForLoadState("networkidle")
	await page.waitForTimeout(1000)
	assert.equal(await page.getByRole("alert").count(), 0)
	assert.equal(await page.getByRole("button", { name: "Research Plate Export", exact: true }).isEnabled(), true)
	assert.deepEqual(errors, [])
	// Basemap limits: the default is the muted Carto no-labels base; the USGS hydrography overlay is US-only and
	// the station is in India, so it must not be requested at all (extent); and zooming far past the source's
	// native zoom must overzoom, never request a level the source does not serve.
	assert.ok(requested.some((url) => /(light|dark)_nolabels/.test(url)), "default basemap should be Carto no-labels")
	assert.equal(requested.filter((url) => /USGSHydroCached/.test(url)).length, 0, "US-only overlay requested outside its extent")
	requested.length = 0
	for (let i = 0; i < 18; i++) await page.getByRole("button", { name: "Zoom in", exact: true }).click()
	await page.waitForLoadState("networkidle")
	await page.waitForTimeout(1000)
	const zooms = requested.map((url) => Number(url.match(/\/(\d+)\/\d+\/\d+\.png/)?.[1])).filter(Number.isFinite)
	assert.ok(zooms.length > 0, "zooming should request tiles")
	assert.ok(Math.max(...zooms) <= 19, `tile requested past native zoom: z=${Math.max(...zooms)}`)
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
