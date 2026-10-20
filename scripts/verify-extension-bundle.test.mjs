import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "verify-extension-bundle.mjs")
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-bundle-guard-"))
after(() => fs.rmSync(temporary, { recursive: true, force: true }))

const REQUIRED = ["node_modules/exceljs/lib/doc/workbook.js", "node_modules/exceljs/lib/xlsx/xlsx.js"]

function verify(extraInputs) {
	const file = path.join(temporary, `metafile-${Math.random().toString(36).slice(2)}.json`)
	fs.writeFileSync(
		file,
		JSON.stringify({ inputs: Object.fromEntries([...REQUIRED, ...extraInputs].map((input) => [input, {}])) }),
	)
	return spawnSync(process.execPath, [script, file], { encoding: "utf8" })
}

describe("verify-extension-bundle: Learning Pack authoring stays out of extension.js", () => {
	it("passes for the installed verifier and the shared contract path ordering", () => {
		const result = verify([
			"src/services/learning-pack/validateLearningPack.ts",
			"src/services/learning-pack/inspectLearningPackArchive.ts",
			"src/services/learning-pack/contractPaths.ts",
			"src/services/learning-pack/canonicalJson.ts",
		])
		assert.equal(result.status, 0, result.stderr)
		assert.match(result.stdout, /no Learning Pack authoring code/)
	})

	for (const input of [
		"src/services/learning-pack/authoring/signPack.ts",
		"src/services/learning-pack/authoring/keys.ts",
		"src/services/learning-pack/authoring/buildPack.ts",
		"src/services/learning-pack/authoring/contractPrimitives.ts",
		"src/services/learning-pack/authoring/cli.ts",
		"scripts/aihydro-pack.ts",
	]) {
		it(`fails when ${input} is bundled`, () => {
			const result = verify(["src/services/learning-pack/validateLearningPack.ts", input])
			assert.notEqual(result.status, 0)
			assert.match(result.stderr, /authoring code must not be bundled into extension\.js/)
			assert.match(result.stderr, new RegExp(input.replaceAll(".", "\\.")))
		})
	}
})
