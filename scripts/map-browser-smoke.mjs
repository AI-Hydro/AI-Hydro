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
					return `import "/src/index.css"; import React from "react"; import {createRoot} from "react-dom/client"; import {MapView} from "/src/components/map/MapView.tsx"; createRoot(document.getElementById("root")).render(React.createElement(React.StrictMode, null, React.createElement(MapView)));`
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
	// Every external response is controlled; no real provider requests or credentials.
	await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
		route.fulfill(
			failing
				? { status: 403, body: "intentional smoke failure" }
				: {
						status: 200,
						contentType: "image/png",
						headers: { "Access-Control-Allow-Origin": "*" },
						body: Buffer.from(png, "base64"),
					},
		),
	)
	await page.goto(server.resolvedUrls.local[0], { waitUntil: "networkidle", timeout: 120000 })
	await page.locator("canvas#ai-hydro-research-map").waitFor({ timeout: 30000 })
	await page.getByRole("alert").filter({ hasText: "HTTP 403" }).waitFor({ timeout: 30000 })
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
				"retry recovery",
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
