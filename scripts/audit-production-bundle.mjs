#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"

const EXPECTED_EXCELJS_VERSION = "4.4.0"
// Production audit policy: zero high or critical advisories are accepted.
// - History: a 16-entry high baseline (owner-accepted 2026-10-19, extended to 2026-12-31) covered
//   the browser-tool dependency chain puppeteer-core 23 -> @puppeteer/browsers 2.6 -> extract-zip /
//   proxy-agent / pac-proxy-agent / get-uri / basic-ftp, plus braces/micromatch/fast-glob/globby.
//   Upstream then widened several advisory ranges (e.g. @puppeteer/browsers "*" -> "<=2.13.2"),
//   which tripped the exact-range check on 2026-11-24.
// - Resolution: puppeteer-core and puppeteer-chromium-resolver were upgraded to 25.x
//   (@puppeteer/browsers 3.x), which clears every one of those advisories; the braces/glob family no
//   longer reports as high either. HIGH_BASELINE is therefore empty and any new high advisory fails.
// - To accept a future high advisory deliberately, add an entry (exact isDirect/range/nodes/
//   advisorySources) with a justification comment AND set BASELINE_REVIEW_BY; the expiry check only
//   applies while HIGH_BASELINE is non-empty.
const BASELINE_REVIEW_BY = "2026-12-31"
const HIGH_BASELINE = {}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"))
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"))
if (packageJson.dependencies?.exceljs !== EXPECTED_EXCELJS_VERSION) {
	throw new Error(
		`Review the production audit baseline before changing package.json ExcelJS: expected exact ${EXPECTED_EXCELJS_VERSION}.`,
	)
}
const lockedExcelJsVersion = packageLock.packages?.["node_modules/exceljs"]?.version
if (lockedExcelJsVersion !== EXPECTED_EXCELJS_VERSION) {
	throw new Error(
		`Review the production audit baseline before changing ExcelJS: expected ${EXPECTED_EXCELJS_VERSION}, found ${lockedExcelJsVersion ?? "missing"}.`,
	)
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const auditProcess = spawnSync(npmCommand, ["audit", "--omit=dev", "--json"], {
	encoding: "utf8",
	maxBuffer: 16 * 1024 * 1024,
})

if (auditProcess.error) {
	throw auditProcess.error
}

let audit
try {
	audit = JSON.parse(auditProcess.stdout)
} catch {
	throw new Error(`npm audit did not return valid JSON.\n${auditProcess.stderr || auditProcess.stdout}`)
}

if (audit.error) {
	throw new Error(`npm audit failed: ${JSON.stringify(audit.error)}`)
}

function collectAdvisorySources(vulnerabilities, name, visited = new Set()) {
	if (visited.has(name)) {
		return new Set()
	}
	visited.add(name)

	const sources = new Set()
	for (const via of vulnerabilities[name]?.via ?? []) {
		if (typeof via === "string") {
			for (const source of collectAdvisorySources(vulnerabilities, via, visited)) {
				sources.add(source)
			}
		} else if (typeof via?.source === "number") {
			sources.add(via.source)
		}
	}
	return sources
}

const SYNTHETIC_TARGET = "synthetic-package"
// Fixture used only by the self-test below, so the guard mechanics stay exercised while the real
// baseline is empty.
const SYNTHETIC_BASELINE = {
	[SYNTHETIC_TARGET]: {
		isDirect: false,
		range: "<=1.0.0",
		nodes: [`node_modules/${SYNTHETIC_TARGET}`],
		advisorySources: [1],
	},
}
const SYNTHETIC_AUDIT = {
	vulnerabilities: {
		[SYNTHETIC_TARGET]: {
			name: SYNTHETIC_TARGET,
			severity: "high",
			isDirect: false,
			range: "<=1.0.0",
			nodes: [`node_modules/${SYNTHETIC_TARGET}`],
			via: [{ source: 1, name: SYNTHETIC_TARGET, severity: "high", range: "<=1.0.0" }],
		},
	},
}

function assertExactArray(label, actual, expected) {
	const sortedActual = [...actual].sort()
	const sortedExpected = [...expected].sort()
	if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
		throw new Error(`${label} changed.\nExpected: ${sortedExpected.join(", ")}\nActual: ${sortedActual.join(", ")}`)
	}
}

function validateAuditBaseline(candidateAudit, now = new Date(), baseline = HIGH_BASELINE) {
	const expiry = new Date(`${BASELINE_REVIEW_BY}T23:59:59.999Z`)
	if (Object.keys(baseline).length > 0 && now > expiry) {
		throw new Error(`Production audit baseline expired on ${BASELINE_REVIEW_BY}; review or remove it.`)
	}

	const vulnerabilities = candidateAudit.vulnerabilities ?? {}
	const criticalNames = Object.entries(vulnerabilities)
		.filter(([, vulnerability]) => vulnerability.severity === "critical")
		.map(([name]) => name)
		.sort()
	if (criticalNames.length > 0) {
		throw new Error(`Critical production advisories are not allowed: ${criticalNames.join(", ")}`)
	}

	const highEntries = Object.entries(vulnerabilities)
		.filter(([, vulnerability]) => vulnerability.severity === "high")
		.sort(([left], [right]) => left.localeCompare(right))
	for (const [name, vulnerability] of highEntries) {
		const expected = baseline[name]
		if (!expected) {
			throw new Error(`New high production advisory requires review: ${name}`)
		}
		if (vulnerability.isDirect !== expected.isDirect) {
			throw new Error(
				`${name} directness changed: expected ${expected.isDirect}, found ${vulnerability.isDirect ?? "missing"}.`,
			)
		}
		if (vulnerability.range !== expected.range) {
			throw new Error(`${name} vulnerable range changed: expected ${expected.range}, found ${vulnerability.range}.`)
		}
		assertExactArray(`${name} production nodes`, vulnerability.nodes ?? [], expected.nodes)
		const sources = collectAdvisorySources(vulnerabilities, name)
		if (sources.size === 0) {
			throw new Error(`High advisory ${name} has no reviewable advisory source.`)
		}
		assertExactArray(`${name} advisory sources`, sources, expected.advisorySources)
	}

	return highEntries.map(([name]) => name)
}

const highNames = validateAuditBaseline(audit)

function expectSyntheticRejection(label, mutate, baseline = SYNTHETIC_BASELINE) {
	const candidate = structuredClone(SYNTHETIC_AUDIT)
	mutate(candidate)
	try {
		validateAuditBaseline(candidate, new Date(), baseline)
	} catch {
		return
	}
	throw new Error(`Synthetic audit regression was not rejected: ${label}`)
}

// Sanity: the unmodified fixture is accepted against its fixture baseline.
validateAuditBaseline(structuredClone(SYNTHETIC_AUDIT), new Date(`${BASELINE_REVIEW_BY}T00:00:00.000Z`), SYNTHETIC_BASELINE)

expectSyntheticRejection("any high advisory against the real (empty) baseline", () => {}, HIGH_BASELINE)
expectSyntheticRejection("new production node for an existing advisory", (candidate) => {
	candidate.vulnerabilities[SYNTHETIC_TARGET].nodes.push(`node_modules/new-runtime/node_modules/${SYNTHETIC_TARGET}`)
})
expectSyntheticRejection("directness change for an existing advisory", (candidate) => {
	candidate.vulnerabilities[SYNTHETIC_TARGET].isDirect = true
})
expectSyntheticRejection("range change for an existing advisory", (candidate) => {
	candidate.vulnerabilities[SYNTHETIC_TARGET].range = "*"
})
expectSyntheticRejection("new advisory source on an allowlisted package", (candidate) => {
	candidate.vulnerabilities[SYNTHETIC_TARGET].via.push({
		source: 9999999,
		name: SYNTHETIC_TARGET,
		severity: "high",
		range: "*",
	})
})
expectSyntheticRejection("critical advisory", (candidate) => {
	candidate.vulnerabilities[SYNTHETIC_TARGET].severity = "critical"
})
try {
	// One day after the review date, so the self-test follows BASELINE_REVIEW_BY when it moves.
	validateAuditBaseline(
		SYNTHETIC_AUDIT,
		new Date(Date.parse(`${BASELINE_REVIEW_BY}T23:59:59.999Z`) + 24 * 60 * 60 * 1000),
		SYNTHETIC_BASELINE,
	)
	throw new Error("Synthetic expired audit baseline was not rejected.")
} catch (error) {
	if (!String(error).includes("baseline expired")) {
		throw error
	}
}

console.log(
	`Production audit passed after bundle verification: ${highNames.length} high (baseline entries: ${Object.keys(HIGH_BASELINE).length}), 0 critical.`,
)
console.log(`Residual high packages: ${highNames.join(", ") || "none"}`)
console.log("Synthetic audit regressions rejected: added path, directness/range changes, new source, and expiry.")
