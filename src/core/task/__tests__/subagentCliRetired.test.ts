import * as assert from "assert"
import * as fs from "fs"
import * as path from "path"

/**
 * The `aihydro "..."` CLI subagent is retired for good (plan S9, AC1). These are source-level guards so it cannot
 * come back by accident: nothing reads AIHYDRO_PROFILE, nothing probes `aihydro version`, and the deleted modules
 * stay deleted. The command deny itself is covered in commandPolicy tests.
 */
const SRC = path.resolve(__dirname, "../../..")

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "generated" || entry.name === "proto" || entry.name === "test") {
				continue
			}
			sourceFiles(full, out)
		} else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
			out.push(full)
		}
	}
	return out
}

function filesContaining(pattern: RegExp): string[] {
	return sourceFiles(SRC)
		.filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
		.map((file) => path.relative(SRC, file))
}

describe("retired aihydro CLI subagent", () => {
	it("nothing but the approval terminal's environment scrub names AIHYDRO_PROFILE", () => {
		assert.deepStrictEqual(filesContaining(/AIHYDRO_PROFILE/), ["integrations/aihydro-session/approvalTerminal.ts"])
	})

	it("nothing reads AIHYDRO_PROFILE from the environment", () => {
		assert.deepStrictEqual(filesContaining(/process\.env\.AIHYDRO_PROFILE|env\[["']AIHYDRO_PROFILE["']\]/), [])
	})

	it("no CLI probe or launch module exists", () => {
		assert.deepStrictEqual(
			filesContaining(/cli-detector|checkCliInstallation|subagent_command|prepareSubagentCommand|isAiHydroCliInstalled/),
			[],
		)
		assert.ok(!fs.existsSync(path.join(SRC, "integrations/cli-subagents")))
		assert.ok(!fs.existsSync(path.join(SRC, "utils/cli-detector.ts")))
	})

	it("nothing spawns `aihydro version`", () => {
		assert.deepStrictEqual(filesContaining(/["'`]aihydro version["'`]/), [])
	})
})
