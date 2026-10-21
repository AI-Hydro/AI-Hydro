import { isUnderProtectedRoots } from "@shared/aihydro/protectedPathMatch"
import { describe, expect, it } from "vitest"

const roots = ["/home/u/.ssh", "/home/u/.aihydro/trust", "C:\\Users\\u\\AppData\\Roaming\\Code\\globalStorage\\x"]

describe("isUnderProtectedRoots", () => {
	it("matches a root and anything below it, case-insensitively, with .. resolved", () => {
		expect(isUnderProtectedRoots("/home/u/.ssh", roots)).toBe(true)
		expect(isUnderProtectedRoots("/home/u/.ssh/id_ed25519", roots)).toBe(true)
		expect(isUnderProtectedRoots("/HOME/u/.aihydro/Trust/keys", roots)).toBe(true)
		expect(isUnderProtectedRoots("/work/../home/u/.ssh/config", roots)).toBe(true)
		expect(isUnderProtectedRoots("c:/users/u/appdata/roaming/code/globalstorage/x/settings.json", roots)).toBe(true)
	})
	it("does not match siblings or look-alike prefixes", () => {
		expect(isUnderProtectedRoots("/home/u/.ssh-other/x", roots)).toBe(false)
		expect(isUnderProtectedRoots("/home/u/project/a.ts", roots)).toBe(false)
	})
	it("treats git exec paths, ~ paths and climbing relative paths as protected (fail safe)", () => {
		expect(isUnderProtectedRoots("/work/p/.git/hooks/pre-commit", roots)).toBe(true)
		expect(isUnderProtectedRoots("~/.ssh/id", roots)).toBe(true)
		expect(isUnderProtectedRoots("../outside/file", roots)).toBe(true)
		expect(isUnderProtectedRoots("src/a.ts", roots)).toBe(false)
	})
	it("lifts workspace-relative paths into a dot-directory root, with or without ./", () => {
		const r = ["/home/u/.ssh", "/home/u/.aihydro/approvals"]
		expect(isUnderProtectedRoots(".ssh/id", r)).toBe(true)
		expect(isUnderProtectedRoots("./.ssh/id", r)).toBe(true)
		expect(isUnderProtectedRoots(".aihydro/approvals/x.json", r)).toBe(true)
		expect(isUnderProtectedRoots(".aihydro/other/x.json", r)).toBe(false)
		// a plain, undotted name is ambiguous and stays with the host stamp
		expect(isUnderProtectedRoots("approvals/x.json", r)).toBe(false)
		expect(isUnderProtectedRoots("src/.ssh-notes/x", r)).toBe(false)
	})
	it("treats the Windows extended prefix and the macOS /private alias as the same path", () => {
		expect(isUnderProtectedRoots("\\\\?\\C:\\Users\\u\\AppData\\Roaming\\Code\\globalStorage\\x\\a", roots)).toBe(true)
		expect(isUnderProtectedRoots("/private/var/folders/u/.ssh/id", ["/var/folders/u/.ssh"])).toBe(true)
		expect(isUnderProtectedRoots("/var/folders/u/.ssh/id", ["/private/var/folders/u/.ssh"])).toBe(true)
	})
})
