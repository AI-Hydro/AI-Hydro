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

// Learning Pack authoring (build, sign, key handling) is a separate CLI bundle (dist/aihydro-pack.cjs). It must never
// be reachable from extension.js: the signer inside the extension would put the publisher-key path one import away
// from any agent-facing code. The installed verifier may import only files outside `learning-pack/authoring/`.
const forbiddenAuthoringPatterns = ["/src/services/learning-pack/authoring/", "/scripts/aihydro-pack"]
const authoringInputs = normalizedInputs.filter((input) =>
	forbiddenAuthoringPatterns.some((pattern) => `/${input}`.includes(pattern)),
)
if (authoringInputs.length > 0) {
	throw new Error(
		`Learning Pack authoring code must not be bundled into extension.js (it belongs to dist/aihydro-pack.cjs):\n${authoringInputs.sort().join("\n")}`,
	)
}

console.log(
	`Verified extension bundle inputs: ExcelJS document reader present; ${forbiddenPackageSegments.length} unused package paths absent; no Learning Pack authoring code.`,
)
