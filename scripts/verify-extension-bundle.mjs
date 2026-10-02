#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const metafilePath = process.argv[2]
if (!metafilePath) {
	throw new Error("Usage: node scripts/verify-extension-bundle.mjs <esbuild-metafile.json>")
}

const metafile = JSON.parse(fs.readFileSync(metafilePath, "utf8"))
const normalizedInputs = Object.keys(metafile.inputs ?? {}).map((input) => input.replaceAll(path.sep, "/"))

const requiredInputs = ["node_modules/exceljs/lib/doc/workbook.js", "node_modules/exceljs/lib/xlsx/xlsx.js"]
for (const requiredInput of requiredInputs) {
	if (!normalizedInputs.some((input) => input.endsWith(requiredInput))) {
		throw new Error(`Expected XLSX runtime input is missing from the extension bundle: ${requiredInput}`)
	}
}

// These packages belong to ExcelJS streaming I/O or build-only tooling. The
// extension uses only the document workbook reader, so including any of them
// would reintroduce an unused vulnerable archive/glob path into shipped code.
const forbiddenPackageSegments = [
	"/node_modules/archiver/",
	"/node_modules/archiver-utils/",
	"/node_modules/brace-expansion/",
	"/node_modules/fstream/",
	"/node_modules/glob/",
	"/node_modules/minimatch/",
	"/node_modules/readdir-glob/",
	"/node_modules/rimraf/",
	"/node_modules/ts-morph/",
	"/node_modules/unzipper/",
	"/node_modules/zip-stream/",
]

const forbiddenInputs = normalizedInputs.filter((input) =>
	forbiddenPackageSegments.some((segment) => `/${input}`.includes(segment)),
)

if (forbiddenInputs.length > 0) {
	throw new Error(`Forbidden build/archive inputs found in the extension bundle:\n${forbiddenInputs.sort().join("\n")}`)
}

console.log(
	`Verified extension bundle inputs: ExcelJS document reader present; ${forbiddenPackageSegments.length} unused package paths absent.`,
)
