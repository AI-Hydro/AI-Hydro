#!/usr/bin/env node
/**
 * Run a Playwright selection N times, each in a fresh process with retries disabled, and report
 * how many runs passed. Used to measure the flake rate of the real-panel specs: a retry would hide
 * the very flake being measured, so `--retries=0` is forced.
 *
 *   node scripts/e2e-repeat.mjs --runs 20 --label ubuntu-vsix -- src/test/e2e/learning-pack-install.test.ts --grep @phase1-pack
 *
 * Everything after `--` goes to `playwright test -c playwright.config.ts`. Writes
 * test-results/e2e-repeat/<label>.json and, on GitHub Actions, a table in the step summary.
 * Exits non-zero if any run failed.
 */
import { spawnSync } from "node:child_process"
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const separator = argv.indexOf("--")
const own = separator === -1 ? argv : argv.slice(0, separator)
const playwrightArgs = separator === -1 ? [] : argv.slice(separator + 1)
const option = (name, fallback) => {
	const at = own.indexOf(`--${name}`)
	return at === -1 ? fallback : own[at + 1]
}
const runs = Number.parseInt(option("runs", "20"), 10)
const label = option("label", "run").replace(/[^A-Za-z0-9._-]/g, "_")
if (!Number.isInteger(runs) || runs < 1 || runs > 100 || playwrightArgs.length === 0) {
	console.error("usage: e2e-repeat.mjs --runs N [--label name] -- <playwright test arguments>")
	process.exit(2)
}

const outDir = path.resolve("test-results", "e2e-repeat")
mkdirSync(outDir, { recursive: true })

/** Collect {title, status} for every test in a Playwright JSON report, ignoring the setup project. */
function collect(suites, found = []) {
	for (const suite of suites ?? []) {
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests ?? []) {
				if (test.projectName === "setup test environment") continue
				const last = test.results?.[test.results.length - 1]
				found.push({ title: spec.title, status: last?.status ?? "missing" })
			}
		}
		collect(suite.suites, found)
	}
	return found
}

const iterations = []
for (let n = 1; n <= runs; n++) {
	const reportFile = path.join(outDir, `${label}-iteration-${n}.json`)
	rmSync(reportFile, { force: true })
	const started = Date.now()
	const result = spawnSync(
		"npx",
		["playwright", "test", "-c", "playwright.config.ts", ...playwrightArgs, "--retries=0", "--reporter=json"],
		{
			env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
			shell: process.platform === "win32",
			stdio: ["ignore", "ignore", "inherit"],
		},
	)
	let tests = []
	try {
		tests = collect(JSON.parse(readFileSync(reportFile, "utf8")).suites)
	} catch {
		// The run died before writing a report: it counts as failed below.
	}
	const passed = result.status === 0 && tests.length > 0 && tests.every((test) => test.status === "passed")
	iterations.push({ n, passed, exitCode: result.status, seconds: Math.round((Date.now() - started) / 1000), tests })
	console.log(`iteration ${n}/${runs}: ${passed ? "PASS" : "FAIL"} (exit ${result.status}, ${iterations.at(-1).seconds}s)`)
	for (const test of tests.filter((t) => t.status !== "passed")) console.log(`  ${test.status}: ${test.title}`)
	rmSync(reportFile, { force: true })
}

const passedRuns = iterations.filter((iteration) => iteration.passed).length
const perTest = {}
for (const iteration of iterations) {
	for (const test of iteration.tests) {
		perTest[test.title] ??= { passed: 0, notPassed: 0 }
		perTest[test.title][test.status === "passed" ? "passed" : "notPassed"]++
	}
}
const summary = {
	label,
	runs,
	passedRuns,
	retries: 0,
	platform: process.platform,
	perTest,
	iterations: iterations.map(({ n, passed, exitCode, seconds }) => ({ n, passed, exitCode, seconds })),
}
writeFileSync(path.join(outDir, `${label}.json`), `${JSON.stringify(summary, null, 2)}\n`)

const lines = [
	`### ${label}: ${passedRuns}/${runs} runs passed (retries disabled)`,
	"",
	"| Test | Passed | Not passed |",
	"| --- | --- | --- |",
	...Object.entries(perTest).map(([title, c]) => `| ${title} | ${c.passed} | ${c.notPassed} |`),
	"",
]
console.log(lines.join("\n"))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`)
process.exit(passedRuns === runs ? 0 : 1)
