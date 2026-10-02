#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"

const EXPECTED_EXCELJS_VERSION = "4.4.0"
const BASELINE_REVIEW_BY = "2026-08-31"
const HIGH_BASELINE = {
	archiver: {
		isDirect: false,
		range: "0.20.0 - 7.0.1",
		nodes: ["node_modules/exceljs/node_modules/archiver"],
		advisorySources: [1124334],
	},
	"archiver-utils": {
		isDirect: false,
		range: ">=0.2.0",
		nodes: [
			"node_modules/exceljs/node_modules/archiver-utils",
			"node_modules/exceljs/node_modules/zip-stream/node_modules/archiver-utils",
		],
		advisorySources: [1124334],
	},
	"brace-expansion": {
		isDirect: false,
		range: "<=5.0.7",
		nodes: ["node_modules/brace-expansion", "node_modules/minimatch/node_modules/brace-expansion"],
		advisorySources: [1124334],
	},
	exceljs: {
		isDirect: true,
		range: ">=3.5.0",
		nodes: ["node_modules/exceljs"],
		advisorySources: [1119441, 1124334],
	},
	glob: {
		isDirect: false,
		range: "4.3.0 - 10.5.0",
		nodes: ["node_modules/exceljs/node_modules/glob", "node_modules/fstream/node_modules/glob"],
		advisorySources: [1124334],
	},
	minimatch: {
		isDirect: true,
		range: "2.0.0 - 10.0.2",
		nodes: ["node_modules/minimatch", "node_modules/readdir-glob/node_modules/minimatch"],
		advisorySources: [1124334],
	},
	"readdir-glob": {
		isDirect: false,
		range: "<=2.0.3",
		nodes: ["node_modules/readdir-glob"],
		advisorySources: [1124334],
	},
	rimraf: {
		isDirect: false,
		range: "2.3.0 - 3.0.2 || 4.2.0 - 5.0.10",
		nodes: ["node_modules/fstream/node_modules/rimraf"],
		advisorySources: [1124334],
	},
	"zip-stream": {
		isDirect: false,
		range: "0.8.0 - 6.0.1",
		nodes: ["node_modules/exceljs/node_modules/zip-stream"],
		advisorySources: [1124334],
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
	candidate.vulnerabilities.archiver.nodes.push("node_modules/new-runtime/node_modules/archiver")
})
expectSyntheticRejection("directness change for an existing advisory", (candidate) => {
	candidate.vulnerabilities.archiver.isDirect = true
})
expectSyntheticRejection("range change for an existing advisory", (candidate) => {
	candidate.vulnerabilities.archiver.range = "*"
})
expectSyntheticRejection("new advisory source on an allowlisted package", (candidate) => {
	candidate.vulnerabilities.archiver.via.push({
		source: 9999999,
		name: "archiver",
		severity: "high",
		range: "*",
	})
})
try {
	validateAuditBaseline(audit, new Date("2026-09-01T00:00:00.000Z"))
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
