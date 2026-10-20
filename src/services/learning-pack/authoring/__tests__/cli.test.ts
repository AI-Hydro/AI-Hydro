import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { readLearningPackArchiveEntries } from "../../inspectLearningPackArchive"
import { type CliContext, runCli } from "../cli"
import { AGENT_CONTEXT_ENV_VARS } from "../keys"
import { moduleHtml, sourceCourse } from "./authoringTestKit"

const PASSPHRASE = "a long enough test passphrase"

function cleanEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env }
	for (const name of AGENT_CONTEXT_ENV_VARS) delete env[name]
	delete env.SOURCE_DATE_EPOCH
	env.GIT_CONFIG_NOSYSTEM = "1"
	return { ...env, ...extra }
}

interface Run {
	code: number
	out: string
	err: string
	prompts: string[]
}

async function run(argv: string[], cwd: string, overrides?: Partial<CliContext>): Promise<Run> {
	let out = ""
	let err = ""
	const prompts: string[] = []
	const code = await runCli({
		argv,
		cwd,
		env: cleanEnv(),
		stdinIsTTY: true,
		stdoutIsTTY: true,
		aiHydroVersion: "0.4.0",
		readPassphrase: async (prompt) => {
			prompts.push(prompt)
			return PASSPHRASE
		},
		out: (text) => {
			out += text
		},
		err: (text) => {
			err += text
		},
		...overrides,
	})
	return { code, out, err, prompts }
}

async function exists(p: string): Promise<boolean> {
	return fs.lstat(p).then(
		() => true,
		() => false,
	)
}

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		env: cleanEnv({ GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z" }),
		stdio: "pipe",
	})
}

describe("aihydro-pack CLI", function () {
	// Git, scrypt and signing are slow on shared Windows runners; the mocha default is 2 s.
	this.timeout(60_000)
	let root: string
	let repo: string
	let courseDir: string
	let keys: string

	async function writeFixtureRepo(): Promise<void> {
		repo = path.join(root, "repo")
		courseDir = path.join(repo, "courses", "demo")
		await fs.mkdir(courseDir, { recursive: true })
		await fs.mkdir(path.join(repo, "modules", "water-basics"), { recursive: true })
		await fs.mkdir(path.join(repo, "modules", "runoff-lab"), { recursive: true })
		const course = sourceCourse()
		;(course.modules as { path: string }[])[0].path = "../../modules/water-basics/module.html"
		;(course.modules as { path: string }[])[1].path = "../../modules/runoff-lab/module.html"
		await fs.writeFile(path.join(courseDir, "course.json"), JSON.stringify(course, null, "\t"))
		await fs.writeFile(path.join(repo, "modules/water-basics/module.html"), moduleHtml("water-basics"))
		await fs.writeFile(path.join(repo, "modules/runoff-lab/module.html"), moduleHtml("runoff-lab", { executable: true }))
		await fs.writeFile(
			path.join(root, "pack.config.json"),
			JSON.stringify({
				schemaVersion: 1,
				packId: "aihydro.intro-demo",
				version: "0.2.0",
				edition: "student",
				publisher: { name: "Test Publisher" },
				idPrefix: "aihydro.intro-demo.",
				idMap: { "intro-demo-2026": "aihydro.intro-demo.course" },
			}),
		)
		git(repo, "init", "-q", "-b", "main")
		git(repo, "add", "-A")
		git(repo, "commit", "-q", "-m", "fixture")
	}

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-cli-"))
		keys = path.join(root, "keys")
	})
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	describe("agent-context and terminal refusals exit 3 and write nothing (A5)", () => {
		for (const marker of AGENT_CONTEXT_ENV_VARS) {
			it(`init-key refuses when ${marker} is set`, async () => {
				const result = await run(["init-key", "--out", keys], root, { env: cleanEnv({ [marker]: "1" }) })
				expect(result.code).to.equal(3)
				expect(result.err).to.contain(marker)
				expect(result.prompts).to.deep.equal([])
				expect(await exists(keys)).to.equal(false)
			})

			it(`sign --key refuses when ${marker} is set, before touching the archive or the key`, async () => {
				const out = path.join(root, "signed.aihydropack")
				const result = await run(
					["sign", path.join(root, "missing.pack"), "--key", path.join(root, "nokey"), "--out", out],
					root,
					{
						env: cleanEnv({ [marker]: "1" }),
					},
				)
				expect(result.code).to.equal(3)
				expect(result.prompts).to.deep.equal([])
				expect(await exists(out)).to.equal(false)
			})
		}

		it("init-key and sign --key refuse without a TTY", async () => {
			const noTty = { stdinIsTTY: false, stdoutIsTTY: false }
			expect((await run(["init-key", "--out", keys], root, noTty)).code).to.equal(3)
			expect(await exists(keys)).to.equal(false)
			expect((await run(["sign", "x.pack", "--out", "y.pack"], root, noTty)).code).to.equal(3)
			expect(await exists(path.join(root, "y.pack"))).to.equal(false)
		})

		it("fingerprint of a private key refuses in an agent context", async () => {
			const keyFile = path.join(root, "k.pem")
			await fs.writeFile(keyFile, "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n", { mode: 0o600 })
			const result = await run(["fingerprint", keyFile], root, { env: cleanEnv({ CLAUDECODE: "1" }) })
			expect(result.code).to.equal(3)
			expect(result.out).to.equal("")
		})

		it("the real entry point refuses too: a child process with CLAUDECODE, and one with no TTY", function () {
			this.timeout(120_000)
			const entry = path.resolve(__dirname, "../../../../../scripts/aihydro-pack.ts")
			const node = ["-r", "ts-node/register", "-r", "tsconfig-paths/register", entry]
			const common = { cwd: path.resolve(__dirname, "../../../../.."), encoding: "utf8" as const, input: "" }
			const base = { ...cleanEnv(), TS_NODE_PROJECT: "./tsconfig.unit-test.json" }
			const agent = spawnSync(process.execPath, [...node, "init-key", "--out", keys], {
				...common,
				env: { ...base, CLAUDECODE: "1" },
			})
			expect(agent.status, agent.stderr).to.equal(3)
			expect(agent.stderr).to.contain("CLAUDECODE")
			const piped = spawnSync(process.execPath, [...node, "init-key", "--out", keys], { ...common, env: base })
			expect(piped.status, piped.stderr).to.equal(3)
			expect(piped.stderr).to.contain("interactive terminal")
			expect(piped.stdout).to.equal("")
		})
	})

	describe("key handling", () => {
		it("init-key prints only the public path and fingerprint, never key material or the passphrase", async () => {
			const result = await run(["init-key", "--out", keys], root)
			expect(result.code).to.equal(0)
			expect(result.prompts).to.have.length(2)
			const privatePem = await fs.readFile(path.join(keys, "ed25519.key.pem"), "utf8")
			const body = privatePem.split("\n").filter((line) => line && !line.startsWith("-----"))
			const all = `${result.out}${result.err}`
			for (const line of body) expect(all).to.not.contain(line)
			expect(all).to.not.contain(PASSPHRASE)
			expect(all).to.not.contain("PRIVATE KEY")
			expect(all).to.not.contain("ed25519.key.pem")
			expect(all).to.match(/fingerprint: sha256:[0-9a-f]{64}/)
			expect(all).to.contain(path.join(keys, "ed25519.pub.pem"))
			if (process.platform !== "win32")
				expect((await fs.stat(path.join(keys, "ed25519.key.pem"))).mode & 0o777).to.equal(0o600)
		})

		it("init-key never overwrites: a second run exits 3 and leaves the key bytes alone", async () => {
			await run(["init-key", "--out", keys], root)
			const before = await fs.readFile(path.join(keys, "ed25519.key.pem"))
			const again = await run(["init-key", "--out", keys], root)
			expect(again.code).to.equal(3)
			expect(again.err).to.contain("already exists")
			expect((await fs.readFile(path.join(keys, "ed25519.key.pem"))).equals(before)).to.equal(true)
		})

		it("init-key refuses mismatched passphrase confirmation and creates nothing", async () => {
			let calls = 0
			const result = await run(["init-key", "--out", keys], root, {
				readPassphrase: async () => (calls++ === 0 ? PASSPHRASE : "something else entirely"),
			})
			expect(result.code).to.equal(3)
			expect(await exists(keys)).to.equal(false)
		})

		it("offers no flag, argument or environment path for a passphrase or key bytes", async () => {
			for (const flag of [
				"--passphrase",
				"--passphrase-file",
				"--passphrase-env",
				"--key-bytes",
				"--stdin",
				"--password",
			]) {
				const result = await run(["init-key", flag, "x", "--out", keys], root)
				expect(result.code, flag).to.equal(2)
			}
			const envs = ["AIHYDRO_PACK_PASSPHRASE", "AIHYDRO_PACK_KEY", "PASSPHRASE", "AIHYDRO_LEARNING_PACK_KEY"]
			const result = await run(["init-key", "--out", keys], root, {
				env: cleanEnv(Object.fromEntries(envs.map((name) => [name, "env-supplied-secret-value"]))),
			})
			expect(result.code).to.equal(0)
			// The passphrase came from the terminal reader (the spy), never from the environment.
			expect(result.prompts).to.have.length(2)
			const pem = await fs.readFile(path.join(keys, "ed25519.key.pem"), "utf8")
			const { createPrivateKey } = await import("node:crypto")
			expect(() => createPrivateKey({ key: pem, format: "pem", passphrase: "env-supplied-secret-value" })).to.throw()
			expect(() => createPrivateKey({ key: pem, format: "pem", passphrase: PASSPHRASE })).to.not.throw()
		})

		it("fingerprint prints the same value for the public key, the private key and a signed pack", async () => {
			const created = await run(["init-key", "--out", keys], root)
			const fp = /fingerprint: (sha256:[0-9a-f]{64})/.exec(created.out)?.[1]
			const pub = await run(["fingerprint", path.join(keys, "ed25519.pub.pem")], root)
			expect(pub.out.trim()).to.equal(fp)
			const priv = await run(["fingerprint", path.join(keys, "ed25519.key.pem")], root)
			expect(priv.out.trim()).to.equal(fp)
			expect(priv.prompts).to.have.length(1)
		})
	})

	describe("build, sign, verify", () => {
		beforeEach(writeFixtureRepo)

		const config = (): string => path.join(root, "pack.config.json")

		it("a development build signed with --ephemeral verifies, even from an agent context", async () => {
			const unsigned = path.join(root, "dev.unsigned.aihydropack")
			const built = await run(["build", courseDir, "--root", repo, "--config", config(), "--out", unsigned], root)
			expect(built.code, built.err).to.equal(0)
			expect(built.out).to.contain("module id water-basics -> aihydro.intro-demo.water-basics")
			// The unsigned archive does not verify yet.
			expect((await run(["verify", unsigned], root)).code).to.equal(1)

			const signed = path.join(root, "dev.aihydropack")
			const agentEnv = cleanEnv({ CLAUDECODE: "1" })
			const result = await run(["sign", unsigned, "--ephemeral", "--out", signed], root, {
				env: agentEnv,
				stdinIsTTY: false,
				stdoutIsTTY: false,
			})
			expect(result.code, result.err).to.equal(0)
			expect(result.out).to.contain("throwaway key")
			expect(result.prompts).to.deep.equal([])
			const verified = await run(["verify", signed, "--ai-hydro-version", "0.4.0"], root)
			expect(verified.code, verified.err).to.equal(0)
			expect(verified.out).to.contain("status: valid")
			expect(verified.out).to.contain("signed by the key with fingerprint sha256:")
			expect(verified.out).to.not.contain("proves who")
		})

		it("a release build signed with a real (test) key verifies against the expected fingerprint (A1/A2 through the CLI)", async () => {
			const created = await run(["init-key", "--out", keys], root)
			const fp = /fingerprint: (sha256:[0-9a-f]{64})/.exec(created.out)?.[1] as string
			const unsigned = path.join(root, "rel.unsigned.aihydropack")
			const built = await run(
				[
					"build",
					courseDir,
					"--root",
					repo,
					"--config",
					config(),
					"--kind",
					"release",
					"--publisher-pub",
					path.join(keys, "ed25519.pub.pem"),
					"--out",
					unsigned,
				],
				root,
			)
			expect(built.code, built.err).to.equal(0)
			expect(built.out).to.contain(`key ID ${fp}`)
			const signed = path.join(root, "rel.aihydropack")
			const result = await run(["sign", unsigned, "--key", path.join(keys, "ed25519.key.pem"), "--out", signed], root)
			expect(result.code, result.err).to.equal(0)
			expect(result.prompts).to.have.length(1)
			expect(`${result.out}${result.err}`).to.not.contain(PASSPHRASE)

			const ok = await run(["verify", signed, "--expect-fingerprint", fp], root)
			expect(ok.code, ok.err).to.equal(0)
			expect(ok.out).to.contain("fingerprint matches the expected value")
			const wrong = await run(["verify", signed, "--expect-fingerprint", `sha256:${"0".repeat(64)}`], root)
			expect(wrong.code).to.equal(1)
			expect(wrong.out).to.contain("does NOT match")
			const json = JSON.parse((await run(["verify", signed, "--json"], root)).out)
			expect(json).to.include({ status: "valid", packId: "aihydro.intro-demo", signerFingerprint: fp })
			const inspected = await run(["inspect", signed], root)
			expect(inspected.code).to.equal(0)
			expect(inspected.out).to.contain("aihydro.intro-demo.water-basics")
			expect(inspected.out).to.contain('"transforms"')
			expect((await run(["fingerprint", signed], root)).out.trim()).to.equal(fp)
		})

		it("a real key cannot sign a pack built for a different key", async () => {
			await run(["init-key", "--out", keys], root)
			const other = path.join(root, "other-keys")
			await run(["init-key", "--out", other], root)
			const unsigned = path.join(root, "rel.unsigned.aihydropack")
			await run(
				[
					"build",
					courseDir,
					"--root",
					repo,
					"--config",
					config(),
					"--kind",
					"release",
					"--publisher-pub",
					path.join(other, "ed25519.pub.pem"),
					"--out",
					unsigned,
				],
				root,
			)
			const out = path.join(root, "never.aihydropack")
			const result = await run(["sign", unsigned, "--key", path.join(keys, "ed25519.key.pem"), "--out", out], root)
			expect(result.code).to.equal(1)
			expect(result.err).to.contain("Key ID mismatch")
			expect(await exists(out)).to.equal(false)
		})

		it("verify rejects a pack with a flipped byte", async () => {
			const unsigned = path.join(root, "d.unsigned.aihydropack")
			await run(["build", courseDir, "--root", repo, "--config", config(), "--out", unsigned], root)
			const signed = path.join(root, "d.aihydropack")
			await run(["sign", unsigned, "--ephemeral", "--out", signed], root)
			const bytes = await fs.readFile(signed)
			bytes[200] ^= 0xff
			const tampered = path.join(root, "t.aihydropack")
			await fs.writeFile(tampered, bytes)
			const result = await run(["verify", tampered], root)
			expect(result.code).to.equal(1)
			expect(result.out).to.contain("status: invalid")
		})

		it("a release build refuses a dirty tree and writes nothing", async () => {
			await run(["init-key", "--out", keys], root)
			await fs.writeFile(path.join(repo, "untracked.txt"), "dirty")
			const out = path.join(root, "r.unsigned.aihydropack")
			const result = await run(
				[
					"build",
					courseDir,
					"--root",
					repo,
					"--config",
					config(),
					"--kind",
					"release",
					"--publisher-pub",
					path.join(keys, "ed25519.pub.pem"),
					"--out",
					out,
				],
				root,
			)
			expect(result.code).to.equal(1)
			expect(result.err).to.contain("clean git work tree")
			expect(await exists(out)).to.equal(false)
			// A development build of the same dirty tree is allowed and records it.
			const dev = path.join(root, "dev.unsigned.aihydropack")
			expect((await run(["build", courseDir, "--root", repo, "--config", config(), "--out", dev], root)).code).to.equal(0)
		})

		it("build refuses invalid input before writing anything, and never overwrites without --force", async () => {
			const out = path.join(root, "out.aihydropack")
			await fs.writeFile(
				path.join(root, "bad.config.json"),
				JSON.stringify({ ...JSON.parse(await fs.readFile(config(), "utf8")), idMap: { nope: "x" } }),
			)
			const bad = await run(
				["build", courseDir, "--root", repo, "--config", path.join(root, "bad.config.json"), "--out", out],
				root,
			)
			expect(bad.code).to.equal(1)
			expect(bad.err).to.contain('idMap key "nope"')
			expect(await exists(out)).to.equal(false)

			await fs.writeFile(
				path.join(root, "typo.config.json"),
				JSON.stringify({ ...JSON.parse(await fs.readFile(config(), "utf8")), edtion: "student" }),
			)
			const typo = await run(
				["build", courseDir, "--root", repo, "--config", path.join(root, "typo.config.json"), "--out", out],
				root,
			)
			expect(typo.code).to.equal(1)
			expect(await exists(out)).to.equal(false)

			expect((await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out], root)).code).to.equal(0)
			const first = await fs.readFile(out)
			const again = await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out], root)
			expect(again.code).to.equal(1)
			expect(again.err).to.contain("--force")
			expect((await fs.readFile(out)).equals(first)).to.equal(true)
			expect(
				(await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out, "--force"], root)).code,
			).to.equal(0)
		})

		it("confines sources to the root: the course's ../../ module paths need an explicit --root", async () => {
			const out = path.join(root, "o.aihydropack")
			const result = await run(["build", courseDir, "--config", config(), "--out", out], root)
			expect(result.code).to.equal(1)
			expect(result.err).to.contain("outside the source root")
			expect(await exists(out)).to.equal(false)
		})

		it("refuses a symlinked module source", async function () {
			if (process.platform === "win32") this.skip()
			const target = path.join(repo, "modules/water-basics/module.html")
			const real = path.join(root, "real-module.html")
			await fs.copyFile(target, real)
			await fs.rm(target)
			await fs.symlink(real, target)
			const out = path.join(root, "o.aihydropack")
			const result = await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out], root)
			expect(result.code).to.equal(1)
			expect(result.err).to.contain("symbolic link")
			expect(await exists(out)).to.equal(false)
		})

		describe("release provenance cannot be false", () => {
			const release = async (extra: string[], out: string, configPath = config()): Promise<Run> => {
				await run(["init-key", "--out", keys], root).catch(() => undefined)
				return run(
					[
						"build",
						courseDir,
						"--root",
						repo,
						"--config",
						configPath,
						"--kind",
						"release",
						"--publisher-pub",
						path.join(keys, "ed25519.pub.pem"),
						"--out",
						out,
						...extra,
					],
					root,
				)
			}
			async function provenanceOf(archive: string): Promise<Record<string, unknown>> {
				const read = await readLearningPackArchiveEntries(await fs.readFile(archive))
				return JSON.parse(Buffer.from(read.files?.get("provenance/provenance.json") as Uint8Array).toString("utf8"))
			}
			async function configWithFile(): Promise<string> {
				const withFile = path.join(root, "files.config.json")
				await fs.writeFile(
					withFile,
					JSON.stringify({
						...JSON.parse(await fs.readFile(config(), "utf8")),
						files: [{ source: "data/x.csv", dest: "datasets/x.csv" }],
					}),
				)
				return withFile
			}

			it("refuses a gitignored source file in a release build, and writes nothing", async () => {
				await fs.mkdir(path.join(repo, "data"))
				await fs.writeFile(path.join(repo, "data/x.csv"), "a,b\n1,2\n")
				await fs.writeFile(path.join(repo, ".gitignore"), "data/\n")
				git(repo, "add", "-A")
				git(repo, "commit", "-q", "-m", "ignore data")
				const out = path.join(root, "r.unsigned.aihydropack")
				const result = await release([], out, await configWithFile())
				expect(result.code, result.err).to.equal(1)
				expect(result.err).to.contain("not tracked")
				expect(result.err).to.contain("data/x.csv")
				expect(await exists(out)).to.equal(false)
				// The same ignored file is fine in a development build, which records that nothing was proven.
				const dev = path.join(root, "dev.unsigned.aihydropack")
				expect(
					(await run(["build", courseDir, "--root", repo, "--config", await configWithFile(), "--out", dev], root))
						.code,
				).to.equal(0)
			})

			it("treats file names literally: a gitignored x[12].csv is not covered by a tracked x1.csv", async () => {
				await fs.mkdir(path.join(repo, "data"))
				await fs.writeFile(path.join(repo, "data/x1.csv"), "tracked\n")
				await fs.writeFile(path.join(repo, ".gitignore"), "data/*.csv\n")
				git(repo, "add", "-A")
				git(repo, "add", "-f", "data/x1.csv") // force-add past the ignore rule
				git(repo, "commit", "-q", "-m", "tracked x1")
				await fs.writeFile(path.join(repo, "data/x[12].csv"), "IGNORED BYTES\n")
				const configPath = path.join(root, "glob.config.json")
				await fs.writeFile(
					configPath,
					JSON.stringify({
						...JSON.parse(await fs.readFile(config(), "utf8")),
						files: [{ source: "data/x[12].csv", dest: "datasets/x.csv" }],
					}),
				)
				const out = path.join(root, "r.unsigned.aihydropack")
				const result = await release([], out, configPath)
				expect(result.code, result.err).to.equal(1)
				expect(result.err).to.contain("not tracked")
				expect(await exists(out)).to.equal(false)
			})

			for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
				it(`refuses a tracked module that was edited after git update-index ${flag}`, async () => {
					const file = "modules/water-basics/module.html"
					git(repo, "update-index", flag, file)
					await fs.appendFile(path.join(repo, file), "<!-- edited, hidden from git status -->")
					const status = execFileSync("git", ["status", "--porcelain"], {
						cwd: repo,
						encoding: "utf8",
						env: cleanEnv(),
					})
					expect(status.trim(), "git status must be blind to the edit for this test to mean anything").to.equal("")
					const out = path.join(root, "r.unsigned.aihydropack")
					const result = await release([], out)
					expect(result.code, result.err).to.equal(1)
					expect(result.err).to.contain("differs from the committed file")
					expect(result.err).to.contain(file)
					expect(await exists(out)).to.equal(false)
				})
			}

			it("accepts an untouched tree, and a course in a subdirectory of the repository", async () => {
				const out = path.join(root, "r.unsigned.aihydropack")
				const result = await release([], out)
				expect(result.code, result.err).to.equal(0)
			})

			it("accepts the same file once it is tracked", async () => {
				await fs.mkdir(path.join(repo, "data"))
				await fs.writeFile(path.join(repo, "data/x.csv"), "a,b\n1,2\n")
				git(repo, "add", "-A")
				git(repo, "commit", "-q", "-m", "track data")
				const out = path.join(root, "r.unsigned.aihydropack")
				const result = await release([], out, await configWithFile())
				expect(result.code, result.err).to.equal(0)
				expect((await provenanceOf(out)).sourceDirty).to.equal(false)
			})

			it("requires --source-commit to equal HEAD for a release build", async () => {
				const first = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", env: cleanEnv() }).trim()
				await fs.appendFile(path.join(repo, "modules/water-basics/module.html"), "<!-- v2 -->")
				git(repo, "add", "-A")
				git(repo, "commit", "-q", "-m", "second")
				const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", env: cleanEnv() }).trim()
				const out = path.join(root, "r.unsigned.aihydropack")
				const stale = await release(["--source-commit", first], out)
				expect(stale.code).to.equal(1)
				expect(stale.err).to.contain("is not HEAD")
				expect(await exists(out)).to.equal(false)
				const ok = await release(["--source-commit", head], out)
				expect(ok.code, ok.err).to.equal(0)
				expect((await provenanceOf(out)).sourceCommit).to.equal(head)
			})

			it("records sourceDirty honestly: true when dirty, false when clean, null outside git or for a non-HEAD commit", async () => {
				await run(["init-key", "--out", keys], root)
				const clean = path.join(root, "clean.aihydropack")
				await run(["build", courseDir, "--root", repo, "--config", config(), "--out", clean], root)
				expect((await provenanceOf(clean)).sourceDirty).to.equal(false)

				await fs.writeFile(path.join(repo, "untracked.txt"), "x")
				const dirty = path.join(root, "dirty.aihydropack")
				await run(["build", courseDir, "--root", repo, "--config", config(), "--out", dirty], root)
				expect((await provenanceOf(dirty)).sourceDirty).to.equal(true)
				await fs.rm(path.join(repo, "untracked.txt"))

				const other = path.join(root, "other.aihydropack")
				const result = await run(
					["build", courseDir, "--root", repo, "--config", config(), "--out", other, "--source-commit", "a".repeat(40)],
					root,
					{
						env: cleanEnv({ SOURCE_DATE_EPOCH: "1760961600" }),
					},
				)
				expect(result.code, result.err).to.equal(0)
				expect((await provenanceOf(other)).sourceDirty).to.equal(null)

				const loose = path.join(root, "loose")
				await fs.cp(path.join(repo, "modules"), path.join(loose, "modules"), { recursive: true })
				await fs.mkdir(path.join(loose, "courses/demo"), { recursive: true })
				await fs.copyFile(path.join(courseDir, "course.json"), path.join(loose, "courses/demo/course.json"))
				const outside = path.join(root, "outside.aihydropack")
				const nogit = await run(
					[
						"build",
						path.join(loose, "courses/demo"),
						"--root",
						loose,
						"--config",
						config(),
						"--out",
						outside,
						"--source-commit",
						"b".repeat(40),
					],
					root,
					{ env: cleanEnv({ SOURCE_DATE_EPOCH: "1760961600", GIT_CEILING_DIRECTORIES: root }) },
				)
				expect(nogit.code, nogit.err).to.equal(0)
				expect((await provenanceOf(outside)).sourceDirty).to.equal(null)
				// ...and a release build outside git is refused.
				const rel = await run(
					[
						"build",
						path.join(loose, "courses/demo"),
						"--root",
						loose,
						"--config",
						config(),
						"--kind",
						"release",
						"--publisher-pub",
						path.join(keys, "ed25519.pub.pem"),
						"--out",
						path.join(root, "x.aihydropack"),
						"--source-commit",
						"b".repeat(40),
					],
					root,
					{ env: cleanEnv({ SOURCE_DATE_EPOCH: "1760961600", GIT_CEILING_DIRECTORIES: root }) },
				)
				expect(rel.code).to.equal(1)
				expect(rel.err).to.contain("inside a git work tree")
			})
		})

		describe("output writes", () => {
			it("--force replaces atomically, leaves no temp file, and never follows a symlink at the target", async function () {
				const out = path.join(root, "o.aihydropack")
				expect((await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out], root)).code).to.equal(
					0,
				)
				expect(
					(await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out, "--force"], root)).code,
				).to.equal(0)
				expect((await fs.readdir(root)).filter((name) => name.endsWith(".tmp"))).to.deep.equal([])
				if (process.platform === "win32") this.skip()
				const victim = path.join(root, "victim.txt")
				await fs.writeFile(victim, "precious")
				const link = path.join(root, "link.aihydropack")
				await fs.symlink(victim, link)
				for (const flags of [[], ["--force"]]) {
					const result = await run(
						["build", courseDir, "--root", repo, "--config", config(), "--out", link, ...flags],
						root,
					)
					expect(result.code, flags.join(" ")).to.equal(1)
					expect(result.err).to.contain("symbolic link")
				}
				expect(await fs.readFile(victim, "utf8")).to.equal("precious")
				expect((await fs.lstat(link)).isSymbolicLink()).to.equal(true)
			})

			it("refuses a directory at the target and keeps an existing pack intact on refusal", async () => {
				const out = path.join(root, "o2.aihydropack")
				await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out], root)
				const before = await fs.readFile(out)
				expect((await run(["build", courseDir, "--root", repo, "--config", config(), "--out", out], root)).code).to.equal(
					1,
				)
				expect((await fs.readFile(out)).equals(before)).to.equal(true)
				const dir = path.join(root, "adir")
				await fs.mkdir(dir)
				expect(
					(await run(["build", courseDir, "--root", repo, "--config", config(), "--out", dir, "--force"], root)).code,
				).to.equal(1)
			})
		})

		it("init-key --no-passphrase warns loudly that the key is unencrypted", async () => {
			const result = await run(["init-key", "--no-passphrase", "--out", keys], root)
			expect(result.code).to.equal(0)
			expect(result.prompts).to.deep.equal([])
			expect(result.err).to.contain("UNENCRYPTED")
			const withPass = await run(["init-key", "--out", path.join(root, "k2")], root)
			expect(withPass.err).to.not.contain("UNENCRYPTED")
		})

		it("rejects a bad usage with exit 2", async () => {
			expect((await run(["build"], root)).code).to.equal(2)
			expect((await run(["frobnicate"], root)).code).to.equal(2)
			expect((await run([], root)).code).to.equal(2)
			expect((await run(["build", courseDir, "--kind", "weird", "--out", "x"], root)).code).to.equal(2)
			expect(
				(await run(["build", courseDir, "--kind", "release", "--config", config(), "--out", "x"], root)).code,
			).to.equal(2)
			expect((await run(["sign", "a", "--ephemeral", "--key", "k", "--out", "x"], root)).code).to.equal(2)
		})
	})
})
