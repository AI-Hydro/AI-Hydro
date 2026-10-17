import { expect } from "chai"
import { describe, it } from "mocha"
import { isAiHydroServerName } from "../aiHydroServer"

describe("isAiHydroServerName", () => {
	// Regression guard: a strict `=== "ai-hydro"` check silently disabled
	// _chat_id / _workspace injection for every server alias users actually
	// register, so chat↔study binding never fired and aihydro_chat_status
	// always reported bound:false. These aliases MUST all match.
	const aiHydroAliases = [
		"ai-hydro",
		"aihydro",
		"aihydro-tools",
		"ai-hydro-tools",
		"AI-Hydro",
		"AIHYDRO",
		"  aihydro-tools  ", // tolerant of incidental whitespace
	]

	for (const name of aiHydroAliases) {
		it(`matches ai-hydro family member: ${JSON.stringify(name)}`, () => {
			expect(isAiHydroServerName(name)).to.equal(true)
		})
	}

	const nonAiHydro = [
		"swatplus-builder",
		"pyhmt2d",
		"hydromind",
		"aihydro-evil-fork", // prefix lookalikes must not receive workspace/chat context
		"aihydro_core", // not a first-party name unless allowlisted
		"my-aihydro-fork", // does not START with the family prefix
		"hydro",
		"",
		undefined,
	]

	for (const name of nonAiHydro) {
		it(`does not match non-family server: ${JSON.stringify(name)}`, () => {
			expect(isAiHydroServerName(name)).to.equal(false)
		})
	}

	it("honours an explicit allowlist for other aliases", () => {
		expect(isAiHydroServerName("aihydro-core", ["aihydro-core"])).to.equal(true)
		expect(isAiHydroServerName("aihydro-core", [""])).to.equal(false)
		expect(isAiHydroServerName("AIHYDRO-CORE", [" aihydro-core "])).to.equal(true)
	})
})
