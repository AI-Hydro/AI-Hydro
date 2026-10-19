import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * "Nothing green unless approved" (vision-2040 chat audit, layout rule 5): the only green in the chat surface comes
 * from design/evidenceStates.ts (`approved`). Chat components must not reach for a success/green token directly.
 */
const BANNED = /charts-green|bg-success|text-success|chip-emerald|testing-iconPassed|#176f2c/

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) {
			return name === "__tests__" ? [] : sourceFiles(path)
		}
		return /\.(tsx?|css)$/.test(name) && !/\.(test|spec|stories)\./.test(name) ? [path] : []
	})
}

describe("chat surface colour ban", () => {
	const root = join(__dirname, "..")
	it("has no green/success tokens under components/chat", () => {
		const offenders = sourceFiles(root).filter((file) => BANNED.test(readFileSync(file, "utf8")))
		expect(offenders).toEqual([])
	})
})
