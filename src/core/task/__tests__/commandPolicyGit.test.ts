import { expect } from "chai"
import { execFileSync } from "child_process"
import * as fs from "fs"
import { afterEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import {
	classifyCommand,
	commandToExecute,
	decideCommand,
	HOST_READ_ONLY_REASON,
	mentionsAihydroProgram,
	type CommandPolicyInput,
} from "../commandPolicy"
import { GIT_HARDENING_CONFIG, GIT_WRAPPER_FUNCTION, gitHardeningAssignments, hardenGitEnvironment } from "../gitHardening"
import { setWorkspaceTrustProvider } from "../workspaceTrust"

const posix = (workspaceTrusted?: boolean) => ({ platform: "linux", shell: "/bin/bash", workspaceTrusted })
const BASE: CommandPolicyInput = {
	command: "git status",
	modelRequiresApproval: false,
	autoApproveSafe: true,
	autoApproveAll: false,
	touchesProtectedPath: false,
	shellEnvironment: posix(true),
}

afterEach(() => setWorkspaceTrustProvider(undefined))

describe("A1: git auto-runs only in a trusted workspace", () => {
	it("an untrusted workspace asks for every git command but still runs other read-only commands", () => {
		for (const c of ["git status", "git log --oneline -5", "git diff HEAD~1", "ls | git status", "git status | head -3"]) {
			expect(classifyCommand(c, posix(false)).readOnly, c).to.equal(false)
			expect(decideCommand({ ...BASE, command: c, shellEnvironment: posix(false) }).action, c).to.equal("ask")
		}
		expect(classifyCommand("ls -la", posix(false)).readOnly).to.equal(true)
		expect(decideCommand({ ...BASE, command: "cat README.md", shellEnvironment: posix(false) }).action).to.equal("run")
	})

	it("a trusted workspace auto-runs read-only git", () => {
		expect(decideCommand(BASE).action).to.equal("run")
	})

	it("with no explicit trust the registered provider decides, and no provider (non-VS Code host) fails closed", () => {
		const env = { platform: "linux", shell: "/bin/bash" }
		expect(classifyCommand("git status", env).readOnly).to.equal(false) // no provider registered
		setWorkspaceTrustProvider(() => false)
		expect(classifyCommand("git status", env).readOnly).to.equal(false)
		setWorkspaceTrustProvider(() => true)
		expect(classifyCommand("git status", env).readOnly).to.equal(true)
		setWorkspaceTrustProvider(() => {
			throw new Error("boom")
		})
		expect(classifyCommand("git status", env).readOnly).to.equal(false)
	})

	it("execute-all is the user's explicit choice and is unaffected", () => {
		expect(decideCommand({ ...BASE, shellEnvironment: posix(false), autoApproveAll: true }).action).to.equal("run")
	})
})

describe("A2: hardening injected when a read-only git command auto-runs", () => {
	it("sets every neutralising config at env precedence, GIT_PAGER=cat and GIT_TERMINAL_PROMPT=0", () => {
		const a = gitHardeningAssignments()
		expect(a).to.include(`GIT_CONFIG_COUNT=${GIT_HARDENING_CONFIG.length}`)
		for (const [i, [key, value]] of GIT_HARDENING_CONFIG.entries()) {
			expect(a).to.include(`GIT_CONFIG_KEY_${i}=${key}`)
			expect(a).to.include(`GIT_CONFIG_VALUE_${i}=${value}`)
		}
		const keys = GIT_HARDENING_CONFIG.map(([k]) => k)
		for (const k of ["core.fsmonitor", "core.hooksPath", "core.pager", "core.sshCommand", "protocol.allow"]) {
			expect(keys, k).to.include(k)
		}
		expect(GIT_HARDENING_CONFIG.find(([k]) => k === "core.fsmonitor")?.[1]).to.equal("false")
		expect(GIT_HARDENING_CONFIG.find(([k]) => k === "core.hooksPath")?.[1]).to.equal("/dev/null")
		// diff.external is NOT set through config: an empty value makes git try to run "" and fail (see the real-git test).
		expect(keys).to.not.include("diff.external")
		expect(GIT_WRAPPER_FUNCTION).to.include("--no-ext-diff")
		expect(GIT_WRAPPER_FUNCTION).to.include("--no-textconv")
		expect(GIT_WRAPPER_FUNCTION).to.include("--no-pager")
		expect(GIT_HARDENING_CONFIG.find(([k]) => k === "core.pager")?.[1]).to.equal("cat")
		expect(GIT_HARDENING_CONFIG.find(([k]) => k === "core.sshCommand")?.[1]).to.equal("")
		expect(GIT_HARDENING_CONFIG.find(([k]) => k === "protocol.allow")?.[1]).to.equal("never")
		expect(a).to.include("GIT_PAGER=cat")
		expect(a).to.include("GIT_TERMINAL_PROMPT=0")
	})

	it("wraps in a subshell so the variables do not leak into the user's terminal", () => {
		const out = hardenGitEnvironment("git status")
		expect(out.startsWith("( export ")).to.equal(true)
		expect(out.endsWith("; git status )")).to.equal(true)
		expect(out).to.include(GIT_WRAPPER_FUNCTION)
	})

	it("hardens only host-classified read-only runs that run git", () => {
		const run = decideCommand(BASE)
		expect(commandToExecute("git status", run)).to.include("GIT_CONFIG_COUNT=")
		expect(commandToExecute("git log | head -3", run)).to.include("GIT_CONFIG_COUNT=")
		expect(commandToExecute("ls", decideCommand({ ...BASE, command: "ls" }))).to.equal("ls")
		// an approved (asked) command and an execute-all run are left exactly as written
		expect(commandToExecute("git push", { action: "ask", reason: "x" })).to.equal("git push")
		expect(commandToExecute("git push", { action: "run", reason: "execute-all-commands is on" })).to.equal("git push")
		expect(HOST_READ_ONLY_REASON).to.equal(run.reason)
	})

	// Real git, real hostile repository. POSIX only (the hardening is a POSIX subshell).
	const real = process.platform === "win32" ? it.skip : it
	real("neutralises core.fsmonitor, diff.external and a textconv driver of a hostile pre-existing .git/config", function () {
		this.timeout(30_000)
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-hostile-"))
		try {
			const git = (...args: string[]) =>
				execFileSync("git", args, {
					cwd: dir,
					stdio: "pipe",
					env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
				})
			git("init", "-q")
			git("config", "user.email", "t@example.com")
			git("config", "user.name", "t")
			fs.writeFileSync(path.join(dir, "a.txt"), "one\n")
			git("add", "a.txt")
			git("commit", "-q", "-m", "init")
			fs.writeFileSync(path.join(dir, "a.txt"), "two\n")
			const fsmon = path.join(dir, "fsmon.sh")
			const extdiff = path.join(dir, "extdiff.sh")
			fs.writeFileSync(fsmon, `#!/bin/sh\ntouch "${dir}/PWNED_FSMONITOR"\n`, { mode: 0o755 })
			fs.writeFileSync(extdiff, `#!/bin/sh\ntouch "${dir}/PWNED_EXTDIFF"\n`, { mode: 0o755 })
			const textconv = path.join(dir, "textconv.sh")
			fs.writeFileSync(textconv, `#!/bin/sh\ntouch "${dir}/PWNED_TEXTCONV"\ncat "$1"\n`, { mode: 0o755 })
			fs.writeFileSync(path.join(dir, ".gitattributes"), "*.txt diff=evil\n")
			git("config", "core.fsmonitor", fsmon)
			git("config", "diff.external", extdiff)
			git("config", "diff.evil.textconv", textconv)
			const run = (command: string) =>
				execFileSync("sh", ["-c", command], {
					cwd: dir,
					stdio: "pipe",
					env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
				})

			// Sanity: the attack works against the unhardened command in this environment.
			run("git status >/dev/null; git diff >/dev/null")
			const markers = ["PWNED_FSMONITOR", "PWNED_EXTDIFF", "PWNED_TEXTCONV"].map((m) => path.join(dir, m))
			const attackWorks = markers.some((m) => fs.existsSync(m))
			for (const m of markers) {
				fs.rmSync(m, { force: true })
			}
			expect(attackWorks, "the hostile config must be live for this test to mean anything").to.equal(true)

			run(hardenGitEnvironment("git status") + " >/dev/null")
			run(hardenGitEnvironment("git diff") + " >/dev/null")
			run(hardenGitEnvironment("git log --oneline | head -3") + " >/dev/null")
			run(hardenGitEnvironment("git log -p -1") + " >/dev/null")
			run(hardenGitEnvironment("git show HEAD") + " >/dev/null")
			run(hardenGitEnvironment("git --no-pager diff -- a.txt") + " >/dev/null")
			// A repeated --no-pager must not skip the wrapper (the wrapper loops; the classifier accepts one).
			run(hardenGitEnvironment("git --no-pager --no-pager diff") + " >/dev/null")
			run(hardenGitEnvironment("git --no-pager --no-pager log -p") + " >/dev/null")
			run(hardenGitEnvironment("git --no-pager --no-pager --no-pager show HEAD") + " >/dev/null")
			expect(fs.existsSync(path.join(dir, "PWNED_FSMONITOR")), "core.fsmonitor ran").to.equal(false)
			expect(fs.existsSync(path.join(dir, "PWNED_EXTDIFF")), "diff.external ran").to.equal(false)
			expect(fs.existsSync(path.join(dir, "PWNED_TEXTCONV")), "diff textconv ran").to.equal(false)
			// the wrapped command still produces git's normal output
			expect(run(hardenGitEnvironment("git log --oneline")).toString()).to.include("init")
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("A: a repeated --no-pager is not accepted by the classifier", () => {
	it("allows at most one leading --no-pager", () => {
		const env = posix(true)
		expect(classifyCommand("git --no-pager diff", env).readOnly).to.equal(true)
		expect(classifyCommand("git --no-pager --no-pager diff", env).readOnly).to.equal(false)
		expect(classifyCommand("git --no-pager --no-pager log -p", env).readOnly).to.equal(false)
		expect(decideCommand({ ...BASE, command: "git --no-pager --no-pager diff" }).action).to.equal("ask")
	})

	it("the wrapper function loops over repeated --no-pager flags", () => {
		expect(GIT_WRAPPER_FUNCTION).to.include('while [ "$1" = --no-pager ]; do shift; done')
	})
})

describe("B: prototype keys are not programs or git subcommands", () => {
	const env = posix(true)
	for (const word of [
		"constructor",
		"toString",
		"__proto__",
		"hasOwnProperty",
		"valueOf",
		"isPrototypeOf",
		"toLocaleString",
		"propertyIsEnumerable",
	]) {
		it(`${word} is not read-only as a program`, () => {
			expect(classifyCommand(word, env).readOnly, word).to.equal(false)
			expect(classifyCommand(`${word} x`, env).readOnly, word).to.equal(false)
			expect(classifyCommand(`ls | ${word}`, env).readOnly, word).to.equal(false)
		})
		it(`git ${word} is not read-only as a subcommand`, () => {
			expect(classifyCommand(`git ${word}`, env).readOnly, word).to.equal(false)
			expect(classifyCommand(`git ${word} --version`, env).readOnly, word).to.equal(false)
		})
	}
})

describe("C: glob forms that could match aihydro are a launch", () => {
	for (const c of [
		'aihydr? "x"',
		'aihyd* "x"',
		'a*hydro "x"',
		'[a]ihydro "x"',
		"/usr/local/bin/aihyd* x",
		"aihydr[o] x",
		"ai*ro x",
		"aih?dro x",
		'env aihyd* "x" -y',
		"cd . && aihydr? x",
	]) {
		it(`is a launch: ${JSON.stringify(c)}`, () => {
			expect(mentionsAihydroProgram(c), c).to.equal(true)
			expect(decideCommand({ ...BASE, command: c, autoApproveAll: true }).action, c).to.equal("deny")
		})
	}

	it("does not flag unrelated globs or a bare wildcard", () => {
		for (const c of [
			"grep -r x *",
			"ls *.ts",
			"cat a*",
			"ls src/*",
			"rm -rf build/*",
			"cat ?",
			"ls [abc]*",
			"echo aihydro-*",
		]) {
			expect(mentionsAihydroProgram(c), c).to.equal(false)
		}
	})
})
