import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { spkiFingerprint } from "../contractPrimitives"
import {
	AGENT_CONTEXT_ENV_VARS,
	assertOwnerContext,
	createKeyFiles,
	createTtyPassphraseReader,
	exportPrivateKeyPem,
	findEnclosingGitWorktree,
	loadPublicKeyFile,
	loadSigningKeyFile,
	PRIVATE_KEY_FILE,
	PUBLIC_KEY_FILE,
	publicKeySpkiDer,
	REFUSAL_EXIT_CODE,
	RefusalError,
} from "../keys"

const PASSPHRASE = "correct horse battery staple"
const posix = process.platform !== "win32"

describe("assertOwnerContext", () => {
	const tty = { stdinIsTTY: true, stdoutIsTTY: true }

	it("passes only for a clean environment on a terminal", () => {
		expect(() => assertOwnerContext({ env: {}, ...tty }, "sign")).to.not.throw()
	})

	for (const name of AGENT_CONTEXT_ENV_VARS) {
		it(`refuses when ${name} is set, even to an empty or falsy-looking value`, () => {
			for (const value of ["1", "", "0", "false"]) {
				let failure: unknown
				try {
					assertOwnerContext({ env: { [name]: value }, ...tty }, "sign")
				} catch (error) {
					failure = error
				}
				expect(failure, `${name}=${JSON.stringify(value)}`).to.be.instanceOf(RefusalError)
				expect((failure as RefusalError).exitCode).to.equal(REFUSAL_EXIT_CODE)
				expect((failure as Error).message).to.contain(name)
			}
		})
	}

	it("names exactly the three agent markers", () => {
		expect([...AGENT_CONTEXT_ENV_VARS]).to.deep.equal(["AIHYDRO_AGENT_CONTEXT", "AIHYDRO_ACTIVE", "CLAUDECODE"])
	})

	it("refuses without a TTY on stdin or on stdout", () => {
		for (const streams of [
			{ stdinIsTTY: false, stdoutIsTTY: true },
			{ stdinIsTTY: true, stdoutIsTTY: false },
			{ stdinIsTTY: false, stdoutIsTTY: false },
		]) {
			expect(() => assertOwnerContext({ env: {}, ...streams }, "sign")).to.throw(RefusalError, /interactive terminal/)
		}
	})
})

describe("key files", () => {
	let root: string

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-keys-"))
	})
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	it("creates a 0700 directory and a 0600 encrypted PKCS#8 key plus a public key, returning only paths and the fingerprint", async () => {
		const dir = path.join(root, "keys")
		const created = await createKeyFiles(dir, PASSPHRASE)
		if (posix) {
			expect((await fs.stat(dir)).mode & 0o777).to.equal(0o700)
			expect((await fs.stat(created.privateKeyPath)).mode & 0o777).to.equal(0o600)
		}
		const pem = await fs.readFile(created.privateKeyPath, "utf8")
		expect(pem).to.contain("BEGIN ENCRYPTED PRIVATE KEY")
		expect(JSON.stringify(created)).to.not.contain("PRIVATE KEY")
		expect(path.basename(created.privateKeyPath)).to.equal(PRIVATE_KEY_FILE)
		expect(path.basename(created.publicKeyPath)).to.equal(PUBLIC_KEY_FILE)
		const publicKey = await loadPublicKeyFile(created.publicKeyPath)
		expect(publicKey.fingerprint).to.equal(created.fingerprint)
		expect(created.fingerprint).to.match(/^sha256:[0-9a-f]{64}$/)
		expect(await fs.readFile(created.publicKeyPath, "utf8")).to.not.contain("PRIVATE")
	})

	it("never overwrites an existing key and leaves it byte-identical", async () => {
		const dir = path.join(root, "keys")
		const created = await createKeyFiles(dir, PASSPHRASE)
		const before = await fs.readFile(created.privateKeyPath)
		let failure: unknown
		try {
			await createKeyFiles(dir, "another passphrase entirely")
		} catch (error) {
			failure = error
		}
		expect(failure).to.be.instanceOf(RefusalError)
		expect((failure as Error).message).to.contain("already exists")
		expect((await fs.readFile(created.privateKeyPath)).equals(before)).to.equal(true)
	})

	it("refuses to create a key when only the public half exists (no partial overwrite)", async () => {
		const dir = path.join(root, "keys")
		await fs.mkdir(dir, { mode: 0o700 })
		await fs.writeFile(path.join(dir, PUBLIC_KEY_FILE), "keep")
		await createKeyFiles(dir, PASSPHRASE).then(
			() => expect.fail("should refuse"),
			(error) => expect(error).to.be.instanceOf(RefusalError),
		)
		expect(await fs.readFile(path.join(dir, PUBLIC_KEY_FILE), "utf8")).to.equal("keep")
		expect(await fs.readdir(dir)).to.deep.equal([PUBLIC_KEY_FILE])
	})

	it("refuses a target inside a git work tree, including a not-yet-created subdirectory", async () => {
		const repo = path.join(root, "repo")
		await fs.mkdir(path.join(repo, ".git"), { recursive: true })
		expect(await findEnclosingGitWorktree(path.join(repo, "deep", "dir"))).to.equal(repo)
		for (const target of [repo, path.join(repo, "keys"), path.join(repo, "a", "b")]) {
			await createKeyFiles(target, PASSPHRASE).then(
				() => expect.fail(`should refuse ${target}`),
				(error) => expect((error as Error).message).to.contain("git work tree"),
			)
		}
		expect(await fs.readdir(repo)).to.deep.equal([".git"])
	})

	it("treats a .git FILE (linked worktree) as a work tree too", async () => {
		const repo = path.join(root, "linked")
		await fs.mkdir(repo)
		await fs.writeFile(path.join(repo, ".git"), "gitdir: /elsewhere\n")
		await createKeyFiles(path.join(repo, "keys"), PASSPHRASE).then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("git work tree"),
		)
	})

	it("refuses a symlinked key directory", async function () {
		if (!posix) this.skip()
		const real = path.join(root, "real")
		await fs.mkdir(real, { mode: 0o700 })
		const link = path.join(root, "link")
		await fs.symlink(real, link)
		await createKeyFiles(link, PASSPHRASE).then(
			() => expect.fail("should refuse"),
			(error) => expect(error).to.be.instanceOf(RefusalError),
		)
	})

	it("refuses a key directory that group or others can enter", async function () {
		if (!posix) this.skip()
		const dir = path.join(root, "open")
		await fs.mkdir(dir)
		await fs.chmod(dir, 0o755)
		await createKeyFiles(dir, PASSPHRASE).then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("must not be accessible"),
		)
	})

	it("rejects a short passphrase and creates nothing", async () => {
		await createKeyFiles(path.join(root, "k"), "short").then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("at least 12"),
		)
		expect(await fs.readdir(root)).to.deep.equal([])
	})

	it("loads the key with the right passphrase and refuses a wrong one without echoing it", async () => {
		const created = await createKeyFiles(path.join(root, "k"), PASSPHRASE)
		const loaded = await loadSigningKeyFile(created.privateKeyPath, async () => PASSPHRASE)
		expect(loaded.fingerprint).to.equal(created.fingerprint)
		const wrong = "definitely the wrong passphrase"
		await loadSigningKeyFile(created.privateKeyPath, async () => wrong).then(
			() => expect.fail("should refuse"),
			(error) => {
				expect(error).to.be.instanceOf(RefusalError)
				expect((error as Error).message).to.not.contain(wrong)
				expect((error as Error).message).to.not.contain(PASSPHRASE)
			},
		)
	})

	it("supports --no-passphrase keys and does not ask for a passphrase for them", async () => {
		const created = await createKeyFiles(path.join(root, "plain"), undefined)
		expect(await fs.readFile(created.privateKeyPath, "utf8")).to.contain("BEGIN PRIVATE KEY")
		const loaded = await loadSigningKeyFile(created.privateKeyPath, async () => {
			throw new Error("must not prompt")
		})
		expect(loaded.fingerprint).to.equal(created.fingerprint)
	})

	it("refuses to sign with a key file others can read, a symlink, a missing file or a key in a repo", async function () {
		if (!posix) this.skip()
		const created = await createKeyFiles(path.join(root, "k"), undefined)
		await fs.chmod(created.privateKeyPath, 0o644)
		await loadSigningKeyFile(created.privateKeyPath, async () => "").then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("readable only by you"),
		)
		await fs.chmod(created.privateKeyPath, 0o600)
		const link = path.join(root, "key-link.pem")
		await fs.symlink(created.privateKeyPath, link)
		await loadSigningKeyFile(link, async () => "").then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("not a link"),
		)
		await loadSigningKeyFile(path.join(root, "missing.pem"), async () => "").then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("does not exist"),
		)
		const repo = path.join(root, "repo")
		await fs.mkdir(path.join(repo, ".git"), { recursive: true })
		const inRepo = path.join(repo, "key.pem")
		await fs.copyFile(created.privateKeyPath, inRepo)
		await fs.chmod(inRepo, 0o600)
		await loadSigningKeyFile(inRepo, async () => "").then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("git work tree"),
		)
	})

	it("refuses a private key passed where a public key is wanted, and a non-Ed25519 public key", async () => {
		const created = await createKeyFiles(path.join(root, "k"), undefined)
		await loadPublicKeyFile(created.privateKeyPath).then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("contains a private key"),
		)
		const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
			type: "spki",
			format: "pem",
		}) as string
		const rsaPath = path.join(root, "rsa.pem")
		await fs.writeFile(rsaPath, rsa)
		await loadPublicKeyFile(rsaPath).then(
			() => expect.fail("should refuse"),
			(error) => expect((error as Error).message).to.contain("not an Ed25519"),
		)
	})
})

describe("encrypted PKCS#8", () => {
	it("is scrypt-protected PBES2 that Node's own reader opens, not the weak PBKDF2 default", () => {
		const { privateKey } = generateKeyPairSync("ed25519")
		const pem = exportPrivateKeyPem(privateKey, PASSPHRASE)
		const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ""), "base64")
		expect(der.toString("hex")).to.contain("2b06010401da47040b") // id-scrypt
		expect(der.toString("hex")).to.not.contain("2a864886f70d01050c") // id-PBKDF2
		const reopened = createPrivateKey({ key: pem, format: "pem", passphrase: PASSPHRASE })
		expect(spkiFingerprint(publicKeySpkiDer(reopened))).to.equal(spkiFingerprint(publicKeySpkiDer(privateKey)))
		expect(createPublicKey(reopened).asymmetricKeyType).to.equal("ed25519")
		expect(() => createPrivateKey({ key: pem, format: "pem", passphrase: "wrong wrong wrong" })).to.throw()
		expect(() => createPrivateKey({ key: pem, format: "pem" })).to.throw()
	})

	it("uses a fresh salt and IV every time", () => {
		const { privateKey } = generateKeyPairSync("ed25519")
		expect(exportPrivateKeyPem(privateKey, PASSPHRASE)).to.not.equal(exportPrivateKeyPem(privateKey, PASSPHRASE))
	})
})

describe("TTY passphrase reader", () => {
	function fakeTty(options?: { isTTY?: boolean; keys?: string }) {
		const events: string[] = []
		let listener: ((chunk: Buffer) => void) | undefined
		const tty = {
			stdin: {
				isTTY: options?.isTTY ?? true,
				setRawMode: (mode: boolean) => events.push(`raw:${mode}`),
				resume: () => events.push("resume"),
				pause: () => events.push("pause"),
				on: (_event: "data", fn: (chunk: Buffer) => void) => {
					listener = fn
					events.push("listen")
					// Keystrokes typed the instant the prompt shows: delivered right after the prompt is written.
				},
				removeListener: () => events.push("unlisten"),
			},
			stdout: {
				write: (text: string) => {
					events.push(`write:${JSON.stringify(text)}`)
					if (text === "Passphrase: " && options?.keys !== undefined)
						queueMicrotask(() => listener?.(Buffer.from(options.keys as string)))
				},
			},
		}
		return { tty, events }
	}

	it("turns echo off (raw mode) and starts listening BEFORE the prompt is written", async () => {
		const { tty, events } = fakeTty({ keys: "hunter2 is long\r" })
		const value = await createTtyPassphraseReader(tty)("Passphrase: ")
		expect(value).to.equal("hunter2 is long")
		const prompt = events.indexOf('write:"Passphrase: "')
		expect(events.indexOf("raw:true")).to.be.within(0, prompt - 1)
		expect(events.indexOf("resume")).to.be.within(0, prompt - 1)
		expect(events.indexOf("listen")).to.be.within(0, prompt - 1)
		expect(events.slice(prompt + 1)).to.deep.equal(["raw:false", "pause", "unlisten", 'write:"\\n"'])
	})

	it("never writes the typed characters to the screen, and handles backspace and Ctrl-C", async () => {
		const typed = fakeTty({ keys: "abcX\u007f\r" })
		expect(await createTtyPassphraseReader(typed.tty)("Passphrase: ")).to.equal("abc")
		expect(typed.events.filter((e) => e.startsWith("write")).join("")).to.not.contain("abc")
		const cancelled = fakeTty({ keys: "ab\u0003" })
		await createTtyPassphraseReader(cancelled.tty)("Passphrase: ").then(
			() => expect.fail("should cancel"),
			(error) => expect(error).to.be.instanceOf(RefusalError),
		)
		expect(cancelled.events).to.include("raw:false")
	})

	it("refuses without a TTY and writes no prompt", async () => {
		const { tty, events } = fakeTty({ isTTY: false })
		await createTtyPassphraseReader(tty)("Passphrase: ").then(
			() => expect.fail("should refuse"),
			(error) => expect(error).to.be.instanceOf(RefusalError),
		)
		expect(events).to.deep.equal([])
	})
})
