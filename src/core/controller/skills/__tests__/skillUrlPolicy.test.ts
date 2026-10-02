import { expect } from "chai"
import { describe, it } from "mocha"
import { assertTrustedSkillUrl, TRUSTED_RAW_SKILL_PREFIXES } from "../skillUrlPolicy"

const SHA = "0123456789abcdef0123456789abcdef01234567"

describe("assertTrustedSkillUrl", () => {
	it("pins exactly the repo+branch prefixes the live catalog uses", () => {
		expect([...TRUSTED_RAW_SKILL_PREFIXES]).to.deep.equal([
			"https://raw.githubusercontent.com/AI-Hydro/Skills/main/",
			"https://raw.githubusercontent.com/AI-Hydro/swatplus-builder/main/",
		])
	})

	for (const ok of [
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/skills/baseflow-separation/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/swatplus-builder/main/SKILL.md",
		"https://ai-hydro.github.io/Skills/skills/x/SKILL.md",
	]) {
		it(`accepts ${ok}`, () => {
			expect(() => assertTrustedSkillUrl(ok, "t")).to.not.throw()
		})
	}

	for (const bad of [
		// fork commit served under the upstream path by SHA
		`https://raw.githubusercontent.com/AI-Hydro/Skills/${SHA}/evil/SKILL.md`,
		`https://raw.githubusercontent.com/AI-Hydro/swatplus-builder/${SHA}/SKILL.md`,
		// any repo / any branch
		"https://raw.githubusercontent.com/AI-Hydro/any-repo/any-branch/x",
		"https://raw.githubusercontent.com/AI-Hydro/any-repo/main/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/dev/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/refs/heads/main/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/",
		"https://raw.githubusercontent.com/AI-Hydro/skills/main/SKILL.md",
		// other owners / lookalikes
		"https://raw.githubusercontent.com/evil-org/Skills/main/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro-evil/Skills/main/SKILL.md",
		"https://raw.githubusercontent.com.evil.com/AI-Hydro/Skills/main/SKILL.md",
		// scheme / userinfo / port
		"http://raw.githubusercontent.com/AI-Hydro/Skills/main/SKILL.md",
		"https://AI-Hydro@raw.githubusercontent.com/evil/x/main/SKILL.md",
		"https://raw.githubusercontent.com:8443/AI-Hydro/Skills/main/SKILL.md",
		// percent-encoding
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/%2e%2e/%2e%2e/evil/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/a%2Fb/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/..%2Fevil-org/x/main/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro%2FSkills/main/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/ma%69n/SKILL.md",
		// dot segments that normalise out of the prefix
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/../../evil-org/x/main/SKILL.md",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/../other/SKILL.md",
		// query / fragment
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/SKILL.md?ref=evil",
		"https://raw.githubusercontent.com/AI-Hydro/Skills/main/SKILL.md#x",
	]) {
		it(`rejects ${bad}`, () => {
			expect(() => assertTrustedSkillUrl(bad, "t")).to.throw(/allowlist|not a valid URL|unsupported protocol/)
		})
	}
})
