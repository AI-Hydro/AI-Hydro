// Run: node scripts/basemap/measure-rivers.mjs   (GPU=1 for real-GPU Chromium on macOS, FULL=1 for all five configurations)
// Needs network. Frame-time and network measurements on a CONUS view (real network, software GL: a pessimistic proxy for a GPU).
import { chromium } from "playwright"
import { startServer } from "../ui-screens/server.mjs"

const { url: base, close } = await startServer()
const browser = await chromium.launch({
	channel: process.env.GPU ? "chromium" : undefined,
	headless: true,
	args: process.env.GPU
		? ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
		: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})
const pct = (a, p) => {
	const s = [...a].sort((x, y) => x - y)
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
async function run(basemap, theme, zoom) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const timings = []
	const inflight = new Set()
	let geo = 0,
		geoBytes = 0
	ctx.on("request", (r) => {
		if (/geoglows|arcgisonline/.test(r.url())) inflight.add(r)
	})
	ctx.on("requestfailed", (r) => inflight.delete(r))
	ctx.on("requestfinished", async (r) => {
		inflight.delete(r)
		if (/geoglows/.test(r.url())) {
			const t = r.timing()
			const resp = await r.response()
			geo++
			geoBytes += Number((await resp?.allHeaders())?.["content-length"] ?? 0)
			timings.push({ range: r.headers().range, ms: t.responseEnd - t.requestStart })
		}
	})
	const ws = JSON.stringify({
		version: 2,
		...(basemap ? { basemap, basemapExplicit: true } : {}),
		viewState: { longitude: -96, latitude: 38, zoom },
		layerPanel: { showDetails: false },
		chrome: "collapsed",
	})
	await ctx.addInitScript((w) => {
		const set = Storage.prototype.setItem
		Storage.prototype.setItem = function (k, v) {
			return set.call(this, k, k === "aihydro.map.workspace.v1" ? w : v)
		}
	}, ws)
	const page = await ctx.newPage()
	const t0 = Date.now()
	await page.goto(`${base}/screen/map-empty-default?theme=${theme}&font=13&surface=editor`, {
		waitUntil: "networkidle",
		timeout: 120000,
	})
	let quiet = 0
	for (let i = 0; i < 120 && quiet < 6; i++) {
		await page.waitForTimeout(500)
		quiet = inflight.size === 0 ? quiet + 1 : 0
	}
	await page.waitForTimeout(1500)
	await page.evaluate(() => {
		window.__d = []
		let last = performance.now()
		const tick = (t) => {
			window.__d.push(t - last)
			last = t
			window.__raf = requestAnimationFrame(tick)
		}
		window.__raf = requestAnimationFrame(tick)
	})
	// Pan, then zoom in and out.
	await page.mouse.move(720, 450)
	await page.mouse.down()
	for (let i = 0; i < 40; i++) {
		await page.mouse.move(720 - i * 6, 450 + i * 3)
		await page.waitForTimeout(25)
	}
	await page.mouse.up()
	for (const dy of [-300, -300, 300, 300]) {
		await page.mouse.wheel(0, dy)
		await page.waitForTimeout(500)
	}
	await page.waitForTimeout(1500)
	const d = await page.evaluate(() => {
		cancelAnimationFrame(window.__raf)
		return window.__d.slice(1)
	})
	const out = {
		basemap: basemap ?? "muted-hydro",
		theme,
		zoom,
		frames: d.length,
		meanMs: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1),
		p50: +pct(d, 50).toFixed(1),
		p95: +pct(d, 95).toFixed(1),
		max: +Math.max(...d).toFixed(0),
		geoglowsRequests: geo,
		geoglowsKB: +(geoBytes / 1024).toFixed(0),
		tileMs: timings.length
			? {
					n: timings.length,
					p50: +pct(
						timings.map((x) => x.ms),
						50,
					).toFixed(0),
					p95: +pct(
						timings.map((x) => x.ms),
						95,
					).toFixed(0),
					max: +Math.max(...timings.map((x) => x.ms)).toFixed(0),
				}
			: null,
	}
	await ctx.close()
	return out
}
const results = []
for (const [bm, th, z] of process.env.FULL
	? [
			[undefined, "dark", 4],
			["muted-hydro-usgs", "dark", 4],
			[undefined, "light", 4],
			[undefined, "dark", 7],
			["muted-hydro-usgs", "dark", 7],
		]
	: [
			[undefined, "dark", 4],
			["muted-hydro-usgs", "dark", 4],
		]) {
	const r = await run(bm, th, z)
	results.push(r)
	console.log(JSON.stringify(r))
}
await browser.close()
await close()
