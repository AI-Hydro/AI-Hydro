#!/usr/bin/env node
/**
 * Self-test for the screen harness `expectAbsent` assertion: it must fail on a rendered match and pass on absent,
 * display:none, and closed-<details> content. Run with `npm run ui:screens:selftest` (needs Playwright Chromium).
 */
import assert from "node:assert/strict"
import { chromium } from "playwright"
import { assertAbsent } from "./assertions.mjs"

const browser = await chromium.launch()
let failures = 0
const check = async (name, fn) => {
	try {
		await fn()
		console.log(`ok   ${name}`)
	} catch (e) {
		failures++
		console.error(`FAIL ${name}: ${e.message}`)
	}
}
try {
	const page = await browser.newPage()
	await page.setContent(`
		<div id="shown">API Request $0.01</div>
		<div id="hidden" style="display:none">Thinking: hidden</div>
		<details><summary>more</summary><p id="closed">Checkpoint</p></details>
		<span id="empty"></span>`)

	await check("passes when nothing matches", () => assertAbsent(page, ["text=No such row", "#nope"]))
	await check("passes for display:none and closed <details> content", () => assertAbsent(page, ["#hidden", "#closed"]))
	await check("fails on a rendered match (selector)", async () => {
		await assert.rejects(() => assertAbsent(page, ["#shown"]), /present but expected absent: #shown/)
	})
	await check("fails on a rendered match (text engine)", async () => {
		await assert.rejects(() => assertAbsent(page, ["text=API Request"]), /present but expected absent/)
	})
	await check("reports the first offending selector in a list", async () => {
		await assert.rejects(() => assertAbsent(page, ["#hidden", "#shown", "#closed"]), /#shown/)
	})
	await check("an empty or missing list passes", async () => {
		await assertAbsent(page, [])
		await assertAbsent(page, undefined)
	})
} finally {
	await browser.close()
}
process.exit(failures ? 1 : 0)
