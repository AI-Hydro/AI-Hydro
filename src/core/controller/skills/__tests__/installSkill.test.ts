import { expect } from "chai"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { installSkillVerified } from "../installSkill"
import { resolveSkillDir } from "../skillPaths"

const GOOD_URL = "https://raw.githubusercontent.com/AI-Hydro/Skills/main/skills/baseflow-separation/SKILL.md"
const SKILLS_PAGES_URL = "https://ai-hydro.github.io/Skills/skills/baseflow-separation/SKILL.md"
const CONTENT = "---\nname: baseflow-separation\n---\nBody\n"
const CONTENT_SHA = `sha256:${createHash("sha256").update(CONTENT, "utf-8").digest("hex")}`

describe("installSkillVerified", () => {
	let home: string
	let fetched: string[]
	const fetchText = async (url: string) => {
		fetched.push(url)
		return CONTENT
	}

	beforeEach(async () => {
		home = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-skills-test-"))
		fetched = []
	})
	afterEach(async () => {
		await fs.rm(home, { recursive: true, force: true })
	})

	const exists = (p: string) =>
		fs.access(p).then(
			() => true,
			() => false,
		)

	it("installs from an allowlisted origin and records the digest as unverified when the catalog has none", async () => {
		const { localPath, integrity } = await installSkillVerified(
			"baseflow-separation",
			SKILLS_PAGES_URL,
			"Baseflow",
			undefined,
			{
				homeDir: home,
				fetchText,
			},
		)
		expect(localPath).to.equal(path.join(home, ".aihydro", "skills", "marketplace", "baseflow-separation", "SKILL.md"))
		expect(await fs.readFile(localPath, "utf-8")).to.equal(CONTENT)
		expect(integrity).to.deep.equal({ sha256: CONTENT_SHA, verified: false })

		const registry = JSON.parse(await fs.readFile(path.join(home, ".aihydro", "skills", "installed.json"), "utf-8"))
		expect(registry["baseflow-separation"].sha256).to.equal(CONTENT_SHA)
		expect(registry["baseflow-separation"].verified).to.equal(false)
		expect(registry["baseflow-separation"].source).to.equal("marketplace")
	})

	it("marks the install verified when the supplied sha256 matches (bare hex or sha256: prefix)", async () => {
		for (const expected of [CONTENT_SHA, CONTENT_SHA.replace("sha256:", "").toUpperCase()]) {
			const { integrity } = await installSkillVerified("baseflow-separation", SKILLS_PAGES_URL, "Baseflow", expected, {
				homeDir: home,
				fetchText,
			})
			expect(integrity).to.deep.equal({ sha256: CONTENT_SHA, verified: true })
		}
		const registry = JSON.parse(await fs.readFile(path.join(home, ".aihydro", "skills", "installed.json"), "utf-8"))
		expect(registry["baseflow-separation"].verified).to.equal(true)
	})

	it("rejects a digest mismatch and writes nothing", async () => {
		const wrong = `sha256:${"0".repeat(64)}`
		let err: Error | undefined
		try {
			await installSkillVerified("baseflow-separation", SKILLS_PAGES_URL, "Baseflow", wrong, { homeDir: home, fetchText })
		} catch (e) {
			err = e as Error
		}
		expect(err?.message).to.match(/digest mismatch/)
		expect(await exists(path.join(home, ".aihydro", "skills"))).to.equal(false)
	})

	it("rejects a malformed expected digest", async () => {
		let err: Error | undefined
		try {
			await installSkillVerified("baseflow-separation", SKILLS_PAGES_URL, "Baseflow", "abc", { homeDir: home, fetchText })
		} catch (e) {
			err = e as Error
		}
		expect(err?.message).to.match(/Invalid expected sha256/)
		expect(fetched).to.deep.equal([])
	})

	for (const bad of ["../escape", "..", "a/b", "/abs", "", "UPPER", "-lead", ".hidden", "a".repeat(65), "x\0y"]) {
		it(`rejects traversal / malformed skillId ${JSON.stringify(bad)} before any fetch or write`, async () => {
			let err: Error | undefined
			try {
				await installSkillVerified(bad, SKILLS_PAGES_URL, "x", undefined, { homeDir: home, fetchText })
			} catch (e) {
				err = e as Error
			}
			expect(err?.message).to.match(/Invalid skillId/)
			expect(fetched).to.deep.equal([])
			expect(await exists(path.join(home, ".aihydro"))).to.equal(false)
		})
	}

	it("accepts the boundary ids (64 chars, underscore, digit-leading)", async () => {
		for (const id of ["a".repeat(64), "0_a-b"]) {
			await installSkillVerified(id, SKILLS_PAGES_URL, "x", undefined, { homeDir: home, fetchText })
		}
	})

	for (const bad of [
		"https://evil.example.com/SKILL.md",
		"https://ai-hydro.github.io.evil.com/Skills/SKILL.md",
		"file:///etc/passwd",
		"not-a-url",
	]) {
		it(`rejects skillUrl ${bad} before any fetch or write`, async () => {
			let err: Error | undefined
			try {
				await installSkillVerified("baseflow-separation", bad, "x", undefined, { homeDir: home, fetchText })
			} catch (e) {
				err = e as Error
			}
			expect(err).to.not.equal(undefined)
			expect(err?.message).to.match(/allowlist|not a valid URL|unsupported protocol/)
			expect(fetched).to.deep.equal([])
			expect(await exists(path.join(home, ".aihydro"))).to.equal(false)
		})
	}

	it("accepts the live catalog's raw.githubusercontent.com/AI-Hydro/* URLs", async () => {
		for (const url of [GOOD_URL, "https://raw.githubusercontent.com/AI-Hydro/swatplus-builder/main/SKILL.md"]) {
			await installSkillVerified("baseflow-separation", url, "x", undefined, { homeDir: home, fetchText })
		}
	})

	for (const bad of [
		"https://raw.githubusercontent.com/evil-org/Skills/main/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro-evil/Skills/main/SKILL.md",
		"http://raw.githubusercontent.com/AI-Hydro/Skills/main/SKILL.md",
		"https://AI-Hydro@raw.githubusercontent.com/evil/x/main/SKILL.md",
		"https://raw.githubusercontent.com.evil.com/AI-Hydro/Skills/main/SKILL.md",
	]) {
		it(`rejects raw.githubusercontent lookalike ${bad}`, async () => {
			let err: Error | undefined
			try {
				await installSkillVerified("baseflow-separation", bad, "x", undefined, { homeDir: home, fetchText })
			} catch (e) {
				err = e as Error
			}
			expect(err?.message).to.match(/allowlist/)
			expect(fetched).to.deep.equal([])
		})
	}
})

describe("resolveSkillDir", () => {
	it("stays inside the source directory", () => {
		const dir = resolveSkillDir("manual", "my-skill", "/h")
		expect(dir).to.equal(path.join("/h", ".aihydro", "skills", "manual", "my-skill"))
	})
	it("rejects empty, dot-dot, nested-escape and absolute ids", () => {
		for (const bad of ["", "..", "../x", "a/../../x", "/etc"]) {
			expect(() => resolveSkillDir("manual", bad, "/h"), bad).to.throw(/Invalid skillId/)
		}
	})
})
