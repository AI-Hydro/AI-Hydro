import { expect } from "chai"
import * as fs from "fs"
import { describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import { isSubagentCommand, prepareSubagentCommand, SUBAGENT_NO_YOLO_NOTICE, transformAiHydroCommand } from "../subagent_command"

describe("subagent launch never injects YOLO (T15, B2)", () => {
	const cleanup: string[] = []
	after(() => cleanup.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

	it("transformAiHydroCommand passes yolo_mode_toggled=false and no -y / yolo=true", () => {
		const out = transformAiHydroCommand('aihydro "do a thing"')
		expect(out).to.include("-s yolo_mode_toggled=false")
		expect(out).to.not.include("yolo_mode_toggled=true")
		expect(out).to.not.match(/\s-y(\s|$)/)
		expect(out).to.not.match(/--yolo/)
		expect(out).to.include("--oneshot")
	})

	it("prepareSubagentCommand never injects YOLO, for any profile", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"))
		cleanup.push(home)
		const savedHome = process.env.HOME
		const savedProfile = process.env.USERPROFILE
		// prepareSubagentCommand writes under os.homedir(); point it at a scratch directory.
		process.env.HOME = home
		process.env.USERPROFILE = home
		try {
			for (const suffix of ["", " --profile explorer", " --profile data-runner"]) {
				const job = prepareSubagentCommand(`aihydro "summarise the repo"${suffix}`)
				expect(job, suffix).to.not.equal(null)
				expect(job!.command, suffix).to.include("-s yolo_mode_toggled=false")
				expect(job!.command, suffix).to.not.include("yolo_mode_toggled=true")
				expect(job!.command, suffix).to.not.match(/\s-y(\s|$)/)
			}
		} finally {
			process.env.HOME = savedHome
			process.env.USERPROFILE = savedProfile
		}
	})

	it("recognises subagent commands and says honestly that the subagent is not in YOLO", () => {
		expect(isSubagentCommand('aihydro "x"')).to.equal(true)
		expect(isSubagentCommand("ls")).to.equal(false)
		expect(SUBAGENT_NO_YOLO_NOTICE).to.include("WITHOUT YOLO")
		expect(SUBAGENT_NO_YOLO_NOTICE).to.include("own approval policy")
	})
})
