#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"

const EXPECTED_EXCELJS_VERSION = "4.4.0"
// Baseline accepted by the owner on 2026-10-19, WITHOUT individual reachability review:
// - These are the 16 high production advisories `npm audit --omit=dev` reports after the
//   simple-git 4.0.2 / proxy-addr 2.0.8 upgrade and an in-range `npm audit fix`. They were hidden
//   until now because the expired review date and the critical check failed first.
// - A reachability review of each entry (is it in dist/extension.js, and can untrusted input reach
//   the vulnerable path?) is the follow-up due before BASELINE_REVIEW_BY. Entries found reachable
//   are to be upgraded or replaced, not kept here.
// - The earlier entries (archiver, archiver-utils, brace-expansion, exceljs, glob, minimatch,
//   readdir-glob, rimraf, zip-stream) no longer report as high and are removed. exceljs is now
//   moderate; its only flagged dependency path is uuid, which exceljs calls as v4() without a
//   buffer, so the vulnerable v3/v5/v6-with-buffer path is unreachable.
// - The exact range/node/source checks below still fail on any new advisory or changed entry.
const BASELINE_REVIEW_BY = "2026-12-31"
const HIGH_BASELINE = {
	"@puppeteer/browsers": {
		isDirect: false,
		range: "*",
		nodes: ["node_modules/@puppeteer/browsers"],
		advisorySources: [1139346, 1193685, 1240853],
	},
	"basic-ftp": {
		isDirect: false,
		range: "<=6.2.0",
		nodes: ["node_modules/basic-ftp"],
		advisorySources: [1240853],
	},
	braces: {
		isDirect: false,
		range: "*",
		nodes: ["node_modules/braces"],
		advisorySources: [1240992],
	},
	"extract-zip": {
		isDirect: false,
		range: "*",
		nodes: ["node_modules/extract-zip"],
		advisorySources: [1139346, 1193685],
	},
	"fast-glob": {
		isDirect: false,
		range: "*",
		nodes: ["node_modules/fast-glob"],
		advisorySources: [1240992],
	},
	"get-uri": {
		isDirect: false,
		range: ">=5.0.0",
		nodes: ["node_modules/get-uri"],
		advisorySources: [1240853],
	},
	globby: {
		isDirect: true,
		range: ">=8.0.0",
		nodes: ["node_modules/globby"],
		advisorySources: [1240992],
	},
	micromatch: {
		isDirect: false,
		range: ">=0.2.0",
		nodes: ["node_modules/micromatch"],
		advisorySources: [1240992],
	},
	"pac-proxy-agent": {
		isDirect: false,
		range: ">=6.0.0",
		nodes: ["node_modules/pac-proxy-agent"],
		advisorySources: [1240853],
	},
	"proxy-agent": {
		isDirect: false,
		range: ">=6.0.0",
		nodes: ["node_modules/proxy-agent"],
		advisorySources: [1240853],
	},
	"puppeteer-chromium-resolver": {
		isDirect: true,
		range: "20.0.0 - 24.0.3",
		nodes: ["node_modules/puppeteer-chromium-resolver"],
		advisorySources: [1139346, 1193685, 1240853],
	},
	"puppeteer-core": {
		isDirect: true,
		range: "19.8.4 - 24.43.1",
		nodes: ["node_modules/puppeteer-core"],
		advisorySources: [1139346, 1193685, 1240853],
	},
}

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

const SYNTHETIC_TARGET = "basic-ftp"

function assertExactArray(label, actual, expected) {
	const sortedActual = [...actual].sort()
	const sortedExpected = [...expected].sort()
	if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
		throw new Error(`${label} changed.\nExpected: ${sortedExpected.join(", ")}\nActual: ${sortedActual.join(", ")}`)
	}
}

function validateAuditBaseline(candidateAudit, now = new Date()) {
	const expiry = new Date(`${BASELINE_REVIEW_BY}T23:59:59.999Z`)
	if (now > expiry) {
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
		const expected = HIGH_BASELINE[name]
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

function expectSyntheticRejection(label, mutate) {
	const candidate = structuredClone(audit)
	mutate(candidate)
	try {
		validateAuditBaseline(candidate)
	} catch {
		return
	}
	throw new Error(`Synthetic audit regression was not rejected: ${label}`)
}

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
try {
	// One day after the review date, so the self-test follows BASELINE_REVIEW_BY when it moves.
	validateAuditBaseline(audit, new Date(Date.parse(`${BASELINE_REVIEW_BY}T23:59:59.999Z`) + 24 * 60 * 60 * 1000))
	throw new Error("Synthetic expired audit baseline was not rejected.")
} catch (error) {
	if (!String(error).includes("baseline expired")) {
		throw error
	}
}

console.log(
	`Production audit baseline accepted through ${BASELINE_REVIEW_BY} after bundle verification: ${highNames.length} exact high metadata findings, 0 critical.`,
)
console.log(`Residual high packages: ${highNames.join(", ") || "none"}`)
console.log("Synthetic audit regressions rejected: added path, directness/range changes, new source, and expiry.")
