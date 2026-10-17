#!/usr/bin/env node
/**
 * UI screen harness runner.
 *
 *   node scripts/ui-screens/run.mjs --out <dir> --themes dark,light,hc-dark,hc-light \
 *        --widths 320,400,800,1280,1920 --font 13,20 --check
 *
 * Renders every registered screen (webview-ui/src/screens/registry.tsx) in headless
 * Chromium (SwiftShader GL) across the matrix, runs the built-in checker, and writes
 * PNGs + index.html + summary.json. All non-local traffic is answered from fixtures.
 * Exit code is non-zero on uncaught page errors, unrouted external requests,
 * checker counts above the committed budget (--check), or pixel diffs over
 * threshold where a baseline exists.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { chromium } from "playwright"
import { pageChecker } from "./checker.mjs"
import { basemapIdForUrl, tilePng } from "./tiles.mjs"
import { startServer, THEMES } from "./server.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(import.meta.url)

const args = process.argv.slice(2)
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`)
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback
}
const flag = (name) => args.includes(`--${name}`)
const list = (v) =>
	String(v)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)

const outDir = resolve(opt("out", "/private/tmp/ui-screens"))
const themes = list(opt("themes", "dark,light,hc-dark,hc-light"))
const widths = list(opt("widths", "320,400,800,1280,1920")).map(Number)
const fonts = list(opt("font", "13,20")).map(Number)
const motion = list(opt("motion", "reduce"))
const only = opt("screens") ? list(opt("screens")) : null
const workers = Number(opt("workers", "4"))
const baselineDir = resolve(opt("baseline", join(root, "webview-ui/screens-baseline", process.platform)))
const budgetPath = resolve(opt("budget", join(root, "webview-ui/screens-baseline/checker-budget.json")))
const diffThreshold = Number(opt("diff-threshold", "0.002"))
const trace = process.env.UI_SCREENS_TRACE
	? (label) => process.stderr.write(`\n  [trace ${Date.now() % 100000}] ${label}`)
	: () => {}
const resume = flag("resume")
const freeze = !flag("no-freeze")
const check = flag("check")
const writeBudget = flag("write-budget")
const updateBaseline = flag("update-baseline")
// Pixel diffs are required by --check unless explicitly skipped (CI has no image baselines).
const noPixel = flag("no-pixel")
for (const t of themes) if (!THEMES.includes(t)) throw new Error(`unknown theme ${t}`)

// Production CSS still runs always-on keyframes under prefers-reduced-motion (plan S1/S2 fix that), so the
// harness fast-forwards animations to their end state before measuring: deterministic checks and pixels.
const FREEZE_CSS =
	"*,*::before,*::after{animation-duration:0.001s!important;animation-delay:0s!important;animation-iteration-count:1!important;animation-fill-mode:forwards!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}"

// Layout can still be moving under load (virtualised lists scrolling to the end, late fonts). Take
// screenshots until two consecutive ones are byte-identical (max 10) and return the last one.
async function settle(page) {
	let previous = null
	for (let i = 0; i < 10; i++) {
		const shot = await page.screenshot({ timeout: 90000 })
		if (previous && Buffer.compare(previous, shot) === 0) return shot
		previous = shot
		await page.waitForTimeout(200)
	}
	return previous
}

const REF = { theme: "dark", font: 13 }
const refWidth = { sidebar: 400, panel: 800, editor: 1280 }
const name = (s, t, w, f, m) => `${s}__${t}__w${w}__f${f}${m === "reduce" ? "" : "__motion"}`

mkdirSync(join(outDir, "png"), { recursive: true })
const { url: base, close } = await startServer()
const browser = await chromium.launch({
	headless: true,
	args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
})

let axe = null
try {
	axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")
} catch {
	axe = null
}

const externalHosts = new Map()
let unrouted = 0
const isLocal = (u) => /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(u) || /^(data|blob|about):/.test(u)

async function newContext() {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
	const handled = new WeakSet()
	await context.route(/^(?!(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$))(https?|wss?):/, (route) => {
		const request = route.request()
		handled.add(request)
		const url = request.url()
		const host = new URL(url).host
		externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1)
		const looksLikeTile = request.resourceType() === "image" || /\/(tile|\d+\/\d+\/\d+)|\.png|\.jpe?g|\.webp/i.test(url)
		if (looksLikeTile) {
			const { color } = basemapIdForUrl(url)
			return route.fulfill({
				status: 200,
				contentType: "image/png",
				headers: { "Access-Control-Allow-Origin": "*" },
				body: tilePng(color),
			})
		}
		return route.fulfill({
			status: 404,
			contentType: "text/plain",
			headers: { "Access-Control-Allow-Origin": "*" },
			body: "blocked by UI screen harness",
		})
	})
	context.on("request", (request) => {
		const url = request.url()
		if (!isLocal(url) && !handled.has(request)) {
			// Give the route handler a tick: request events can precede route registration bookkeeping.
			setTimeout(() => {
				if (!handled.has(request)) unrouted++
			}, 50)
		}
	})
	return context
}

// ── discover screens (also warms the Vite dependency graph) ────────────────
const warm = await (await newContext()).newPage()
await warm.goto(`${base}/screen/chat-home-history`, { waitUntil: "networkidle", timeout: 180000 })
await warm.waitForFunction(() => window.__screens, null, { timeout: 120000 })
const allScreens = await warm.evaluate(() => window.__screens)
await warm.context().close()
const screens = allScreens.filter((s) => !only || only.includes(s.id) || only.includes(s.group))

const allCells = []
for (const s of screens)
	for (const t of themes)
		for (const w of widths)
			for (const f of fonts) for (const m of motion) allCells.push({ screen: s, theme: t, width: w, font: f, motion: m })

// --resume keeps clean results (and their PNGs) from an earlier run in the same --out dir and renders only the rest.
const results = []
const priorByFile = new Map()
if (resume && existsSync(join(outDir, "summary.json"))) {
	for (const r of JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8")).results ?? [])
		if (r.errors.length === 0 && r.checker && existsSync(join(outDir, "png", r.file))) priorByFile.set(r.file, r)
}
const cells = allCells.filter((c) => {
	const prior = priorByFile.get(`${name(c.screen.id, c.theme, c.width, c.font, c.motion)}.png`)
	if (prior) results.push(prior)
	return !prior
})
if (resume) process.stderr.write(`resume: reusing ${results.length} clean cells, rendering ${cells.length}\n`)
let next = 0

async function worker() {
	const context = await newContext()
	const page = await context.newPage()
	let errors = []
	page.on("pageerror", (e) => errors.push(String(e.message ?? e)))
	for (;;) {
		const idx = next++
		if (idx >= cells.length) break
		const { screen, theme, width, font, motion: m } = cells[idx]
		errors = []
		const file = `${name(screen.id, theme, width, font, m)}.png`
		const record = {
			screen: screen.id,
			group: screen.group,
			theme,
			width,
			font,
			motion: m,
			file,
			errors: [],
			checker: null,
			axe: null,
			ok: true,
		}
		for (let attempt = 0; attempt < 2; attempt++) {
			errors = []
			record.ok = true
			record.checker = null
			try {
				await page.emulateMedia({ reducedMotion: m === "reduce" ? "reduce" : "no-preference" })
				await page.setViewportSize({ width, height: width >= 1280 ? 900 : 860 })
				await page.goto(`${base}/screen/${screen.id}?theme=${theme}&font=${font}&surface=${screen.surface}`, {
					waitUntil: "networkidle",
					timeout: 120000,
				})
				await page.waitForFunction(() => window.__screenReady === true, null, { timeout: 60000 })
				trace("ready")
				await page.locator("#root > *").first().waitFor({ state: "attached", timeout: 60000 })
				if (screen.ready) await page.locator(screen.ready).first().waitFor({ timeout: 60000 })
				await page.waitForTimeout(screen.hasMapCanvas ? 1500 : 350)
				trace("waited1")
				const steps = await page.evaluate(() => window.__screenSteps ?? [])
				for (const step of steps) {
					if (step.click)
						await page
							.locator(step.click)
							.nth(step.nth ?? 0)
							.click({ timeout: 20000 })
					else if (step.scrollEnd)
						// Virtualised lists re-measure items after each scroll; iterate until scrollTop/scrollHeight stop moving.
						await page
							.locator(step.scrollEnd)
							.first()
							.evaluate(async (el) => {
								let last = ""
								let stable = 0
								for (let i = 0; i < 40 && stable < 4; i++) {
									el.scrollTop = el.scrollHeight
									await new Promise((r) => setTimeout(r, 150))
									const now = `${el.scrollTop}/${el.scrollHeight}`
									stable = now === last ? stable + 1 : 0
									last = now
								}
							})
					else if (step.scroll) await page.locator(step.scroll).first().scrollIntoViewIfNeeded({ timeout: 20000 })
					else if (step.fill) await page.locator(step.fill[0]).first().fill(step.fill[1])
					else if (step.press) await page.keyboard.press(step.press)
					else if (step.wait) await page.waitForTimeout(step.wait)
				}
				// Structural assertions replace pixel diffs for screens whose scroll offset is load dependent.
				for (const sel of screen.expectVisible ?? []) {
					const box = await page.locator(sel).first().boundingBox({ timeout: 20000 })
					const vp = page.viewportSize()
					if (!box || box.y + box.height <= 0 || box.y >= vp.height || box.x + box.width <= 0 || box.x >= vp.width)
						throw new Error(`ASSERT not visible in viewport: ${sel}`)
				}
				if (screen.scrollPinned) {
					const pinned = await page
						.locator(screen.scrollPinned)
						.first()
						.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2)
					if (!pinned) throw new Error(`ASSERT scroll not pinned to end: ${screen.scrollPinned}`)
				}
				await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {})
				trace("idle2")
				await page.waitForTimeout(screen.hasMapCanvas ? 800 : 200)
				if (freeze) {
					await page.addStyleTag({ content: FREEZE_CSS })
					await page.waitForTimeout(150)
				}
				await settle(page)
				trace("settled1")
				record.checker = await page.evaluate(pageChecker)
				trace("checked")
				if (axe) {
					await page.evaluate(axe)
					record.axe = await page.evaluate(async () => {
						const r = await window.axe.run(document.body, { resultTypes: ["violations"] })
						return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
					})
				}
				const mask = screen.hasMapCanvas
					? await page.evaluate(() =>
							[...document.querySelectorAll("canvas")].map((c) => {
								const r = c.getBoundingClientRect()
								return [r.left, r.top, r.right, r.bottom]
							}),
						)
					: []
				record.mask = mask
				writeFileSync(join(outDir, "png", file), await settle(page))
			} catch (e) {
				record.ok = false
				errors.push(`HARNESS: ${String(e.message ?? e).split("\n")[0]}`)
			}
			// A transient harness failure (machine load) gets one retry; real page errors do not.
			if (record.ok || errors.some((e) => !e.startsWith("HARNESS:"))) break
		}
		record.errors = errors
		results.push(record)
		process.stderr.write(`\r[${results.length}/${cells.length}] ${file}`.padEnd(100))
	}
	await context.close()
}
await Promise.all(Array.from({ length: Math.max(1, workers) }, worker))
process.stderr.write("\n")
await browser.close()
await close()

results.sort((a, b) => a.file.localeCompare(b.file))

// ── aggregate checker counts ───────────────────────────────────────────────
const RULES = ["noName", "smallTarget", "smallText", "contrast", "contrastIndeterminate"]
const zero = () => Object.fromEntries(RULES.map((r) => [r, 0]))
const perScreen = {}
for (const r of results) {
	const s = (perScreen[r.screen] ??= { matrixTotal: zero(), ref: null, cells: 0 })
	s.cells++
	if (r.checker) for (const rule of RULES) s.matrixTotal[rule] += r.checker[rule]
	const meta = screens.find((x) => x.id === r.screen)
	if (r.theme === REF.theme && r.font === REF.font && r.width === refWidth[meta.surface] && r.motion === motion[0] && r.checker)
		s.ref = Object.fromEntries(RULES.map((rule) => [rule, r.checker[rule]]))
}
const totals = zero()
const refTotals = zero()
for (const s of Object.values(perScreen)) {
	for (const rule of RULES) {
		totals[rule] += s.matrixTotal[rule]
		refTotals[rule] += s.ref?.[rule] ?? 0
	}
}

// ── budget ─────────────────────────────────────────────────────────────────
const budgetOut = {
	_note: "Checker baseline budget. Counts may shrink, never grow: --write-budget keeps min(old, new) per rule. Reference cell = dark theme, 13px, native width (sidebar 400, panel 800, editor 1280). cells = matrix size the matrixTotal was measured over (totals are only compared for equal sizes).",
	reference: { ...REF, widths: refWidth },
	screens: Object.fromEntries(
		Object.entries(perScreen).map(([id, s]) => [id, { ref: s.ref, matrixTotal: s.matrixTotal, cells: s.cells }]),
	),
}
const RULES_BUDGETED = RULES.filter((r) => r !== "contrastIndeterminate")
const minRules = (a, b) =>
	Object.fromEntries(RULES.map((r) => [r, Math.min(a?.[r] ?? Number.POSITIVE_INFINITY, b?.[r] ?? Number.POSITIVE_INFINITY)]))
if (writeBudget) {
	// The budget can only shrink: existing entries keep min(old, new) per rule. New screens take the measured values.
	const old = existsSync(budgetPath) ? JSON.parse(readFileSync(budgetPath, "utf8")) : { screens: {} }
	for (const [id, s] of Object.entries(budgetOut.screens)) {
		const prev = old.screens?.[id]
		if (!prev) {
			s.cells = perScreen[id].cells
			continue
		}
		s.ref = s.ref && prev.ref ? minRules(prev.ref, s.ref) : (prev.ref ?? s.ref)
		if (prev.cells === perScreen[id].cells) {
			s.matrixTotal = minRules(prev.matrixTotal, s.matrixTotal)
			s.cells = prev.cells
		} else {
			s.matrixTotal = prev.matrixTotal
			s.cells = prev.cells
		}
	}
	// Screens absent from this run (subset run) keep their old entries.
	for (const [id, prev] of Object.entries(old.screens ?? {})) if (!budgetOut.screens[id]) budgetOut.screens[id] = prev
	mkdirSync(dirname(budgetPath), { recursive: true })
	writeFileSync(budgetPath, JSON.stringify(budgetOut, null, "\t") + "\n")
}
const budgetFailures = []
let matrixTotalsChecked = 0
if (check && !writeBudget) {
	if (!existsSync(budgetPath)) budgetFailures.push(`budget file missing: ${budgetPath}`)
	else {
		const budget = JSON.parse(readFileSync(budgetPath, "utf8"))
		for (const [id, s] of Object.entries(perScreen)) {
			const b = budget.screens?.[id]
			if (!b) {
				budgetFailures.push(`${id}: rendered screen has no budget entry (add with --write-budget)`)
				continue
			}
			for (const rule of RULES_BUDGETED) {
				if (s.ref && b.ref && s.ref[rule] > b.ref[rule])
					budgetFailures.push(`${id} ref ${rule}: ${s.ref[rule]} > ${b.ref[rule]}`)
			}
			// Matrix totals are only comparable when the same number of cells was rendered.
			if (b.cells === s.cells) {
				matrixTotalsChecked++
				for (const rule of RULES_BUDGETED)
					if (s.matrixTotal[rule] > b.matrixTotal[rule])
						budgetFailures.push(`${id} matrix ${rule}: ${s.matrixTotal[rule]} > ${b.matrixTotal[rule]}`)
			}
		}
	}
}

// ── pixel diff against baselines ───────────────────────────────────────────
const diffs = { compared: 0, missingBaseline: 0, overThreshold: [], skipped: check && noPixel ? "--no-pixel" : undefined }
if ((check && !noPixel) || updateBaseline) {
	let PNG = null
	try {
		PNG = require("playwright-core/lib/utilsBundle").PNG
	} catch {
		PNG = null
	}
	if (updateBaseline) {
		mkdirSync(baselineDir, { recursive: true })
		for (const r of results) writeFileSync(join(baselineDir, r.file), readFileSync(join(outDir, "png", r.file)))
	} else if (PNG && existsSync(baselineDir)) {
		for (const r of results) {
			const basePath = join(baselineDir, r.file)
			if (!existsSync(basePath)) {
				diffs.missingBaseline++
				continue
			}
			const a = PNG.sync.read(readFileSync(basePath))
			const b = PNG.sync.read(readFileSync(join(outDir, "png", r.file)))
			diffs.compared++
			if (a.width !== b.width || a.height !== b.height) {
				diffs.overThreshold.push({ file: r.file, reason: "size" })
				continue
			}
			let diff = 0
			let total = 0
			const masked = (x, y) => (r.mask ?? []).some(([l, t, rr, bb]) => x >= l && x <= rr && y >= t && y <= bb)
			for (let y = 0; y < a.height; y++)
				for (let x = 0; x < a.width; x++) {
					if (masked(x, y)) continue
					total++
					const i = (y * a.width + x) * 4
					if (
						Math.abs(a.data[i] - b.data[i]) +
							Math.abs(a.data[i + 1] - b.data[i + 1]) +
							Math.abs(a.data[i + 2] - b.data[i + 2]) >
						24
					)
						diff++
				}
			if (diff / Math.max(1, total) > (screens.find((x) => x.id === r.screen)?.pixelDiffThreshold ?? diffThreshold))
				diffs.overThreshold.push({ file: r.file, ratio: +(diff / total).toFixed(5) })
		}
	} else {
		diffs.note = PNG ? "no baseline directory (create with --update-baseline)" : "pixel decoder unavailable"
	}
}

// ── contact sheet ──────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const refFile = (id) => {
	const meta = screens.find((x) => x.id === id)
	return results.find(
		(r) =>
			r.screen === id &&
			r.theme === REF.theme &&
			r.font === REF.font &&
			r.width === refWidth[meta.surface] &&
			r.motion === motion[0],
	)?.file
}
let html = `<!doctype html><meta charset="utf-8"><title>UI screens</title><style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}h1{font-size:18px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}figure{margin:0;border:1px solid #ccc;padding:8px}img{width:100%;border:1px solid #ddd}figcaption{font-size:12px;margin-top:4px}table{border-collapse:collapse;font-size:12px}td,th{border:1px solid #ccc;padding:2px 6px}</style><h1>UI screen contact sheet (reference cell: dark, 13px, native width). All data is synthetic FIXTURE content.</h1><div class="g">`
for (const s of screens) {
	const f = refFile(s.id)
	const c = perScreen[s.id]?.ref
	html += `<figure><a href="png/${esc(f ?? "")}">${f ? `<img loading="lazy" src="png/${esc(f)}" alt="${esc(s.title)}">` : "(no reference render)"}</a><figcaption><b>${esc(s.id)}</b><br>${esc(s.title)}<br>${c ? RULES.map((r) => `${r}=${c[r]}`).join(" ") : ""}</figcaption></figure>`
}
html += `</div><h1>All cells</h1><table><tr><th>file<th>errors<th>noName<th>smallTarget<th>smallText<th>contrast</tr>`
for (const r of results)
	html += `<tr><td><a href="png/${esc(r.file)}">${esc(r.file)}</a><td>${r.errors.length}<td>${r.checker?.noName ?? ""}<td>${r.checker?.smallTarget ?? ""}<td>${r.checker?.smallText ?? ""}<td>${r.checker?.contrast ?? ""}</tr>`
html += "</table>"
writeFileSync(join(outDir, "index.html"), html)

const errorCells = results.filter((r) => r.errors.length)
const pixelRequiredFailure = check && !noPixel && !updateBaseline && (diffs.missingBaseline > 0 || Boolean(diffs.note))
const failed =
	errorCells.length > 0 ||
	unrouted > 0 ||
	(check && (budgetFailures.length > 0 || diffs.overThreshold.length > 0)) ||
	pixelRequiredFailure
const summary = {
	screens: screens.length,
	cells: results.length,
	matrix: { themes, widths, fonts, motion },
	errors: errorCells.reduce((n, r) => n + r.errors.length, 0),
	errorSamples: errorCells.slice(0, 10).map((r) => ({ file: r.file, errors: r.errors.slice(0, 2) })),
	unroutedRequests: unrouted,
	externalRoutedRequests: Object.fromEntries(externalHosts),
	axe: axe ? "ran" : "unavailable (axe-core not installed)",
	checker: { referenceCellTotals: refTotals, matrixTotals: totals },
	budgetFailures,
	matrixTotalsChecked,
	pixelRequiredFailure,
	diffs,
	contactSheet: join(outDir, "index.html"),
	perScreen,
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ ...summary, results }, null, 2))
console.log(JSON.stringify({ ...summary, perScreen: undefined }, null, 2))
process.exit(failed ? 1 : 0)
