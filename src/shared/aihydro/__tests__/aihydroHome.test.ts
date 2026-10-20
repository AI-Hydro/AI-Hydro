import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { getBoundStudy } from "../../../integrations/aihydro-session/boundStudy"
import { defaultAiHydroHome, listSessionIds, resolveSessionJsonPath } from "../../../integrations/aihydro-session/sessionSurfaces"
import { AIHYDRO_HOME_ENV, aihydroHome, aihydroPath } from "../aihydroHome"

describe("aihydroHome (WP-0: one AI-Hydro home)", () => {
	const HOME = path.join(path.sep, "users", "tester")
	let saved: string | undefined

	beforeEach(() => {
		saved = process.env[AIHYDRO_HOME_ENV]
	})
	afterEach(() => {
		if (saved === undefined) {
			delete process.env[AIHYDRO_HOME_ENV]
		} else {
			process.env[AIHYDRO_HOME_ENV] = saved
		}
	})

	it("defaults to ~/.aihydro when AIHYDRO_HOME is unset or empty", () => {
		expect(aihydroHome({}, HOME)).to.equal(path.join(HOME, ".aihydro"))
		expect(aihydroHome({ AIHYDRO_HOME: "" }, HOME)).to.equal(path.join(HOME, ".aihydro"))
	})

	it("honours AIHYDRO_HOME", () => {
		const scratch = path.join(path.sep, "scratch", "home")
		expect(aihydroHome({ AIHYDRO_HOME: scratch }, HOME)).to.equal(scratch)
	})

	it("expands a leading ~ like the server resolver", () => {
		expect(aihydroHome({ AIHYDRO_HOME: "~" }, HOME)).to.equal(HOME)
		expect(aihydroHome({ AIHYDRO_HOME: "~/state" }, HOME)).to.equal(path.join(HOME, "state"))
	})

	it("resolves at call time, so a later change is picked up without reloading", () => {
		delete process.env[AIHYDRO_HOME_ENV]
		const before = aihydroHome()
		process.env[AIHYDRO_HOME_ENV] = path.join(path.sep, "elsewhere")
		expect(aihydroHome()).to.equal(path.join(path.sep, "elsewhere"))
		expect(aihydroPath("sessions", "s.json")).to.equal(path.join(path.sep, "elsewhere", "sessions", "s.json"))
		expect(before).to.not.equal(aihydroHome())
	})

	describe("consumers follow the home end to end", () => {
		let scratch: string
		beforeEach(() => {
			scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-home-"))
			process.env[AIHYDRO_HOME_ENV] = scratch
		})
		afterEach(() => {
			fs.rmSync(scratch, { recursive: true, force: true })
		})

		it("session surfaces list and resolve sessions under AIHYDRO_HOME", () => {
			fs.mkdirSync(path.join(scratch, "sessions"), { recursive: true })
			fs.writeFileSync(path.join(scratch, "sessions", "scratch-study.json"), "{}")
			expect(defaultAiHydroHome()).to.equal(scratch)
			expect(listSessionIds()).to.deep.equal(["scratch-study"])
			expect(resolveSessionJsonPath("scratch-study")).to.equal(path.join(scratch, "sessions", "scratch-study.json"))
		})

		it("the bound-study reader reads chat_studies.json from AIHYDRO_HOME", () => {
			fs.mkdirSync(path.join(scratch, "sessions"), { recursive: true })
			fs.writeFileSync(
				path.join(scratch, "chat_studies.json"),
				JSON.stringify({ chat_to_study: { ulid1: "scratch-study" } }),
			)
			expect(getBoundStudy("ulid1")?.studyId).to.equal("scratch-study")
		})
	})

	it("nothing under src hard-codes the home directory except the helper", () => {
		const srcRoot = path.resolve(__dirname, "../../..")
		const offenders: string[] = []
		const pattern = /homedir\(\)\s*,\s*["']\.aihydro["']/
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) {
					if (entry.name !== "node_modules" && entry.name !== "generated") {
						walk(full)
					}
				} else if (/\.tsx?$/.test(entry.name) && !full.includes(`${path.sep}__tests__${path.sep}`)) {
					if (pattern.test(fs.readFileSync(full, "utf8"))) {
						offenders.push(path.relative(srcRoot, full))
					}
				}
			}
		}
		walk(srcRoot)
		expect(offenders).to.deep.equal([])
	})
})
