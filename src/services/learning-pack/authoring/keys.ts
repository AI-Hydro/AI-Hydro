/**
 * Publisher key handling for the authoring CLI.
 *
 * Honest scope: this is a GUARD against accidents and against an agent that is simply running in the author's
 * terminal, not a security boundary. A process running as the same user can read the key file and read the
 * environment; the only real protection for the key is its passphrase, which is typed on the controlling
 * terminal and never leaves this process. Nothing here accepts key bytes or a passphrase from an environment
 * variable, a file descriptor argument, standard input or any tool/RPC surface, and nothing here ever prints
 * key material (errors name paths and fingerprints only).
 *
 * The signer is never bundled into the extension (scripts/verify-extension-bundle.mjs enforces it).
 */

import {
	createCipheriv,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	type KeyObject,
	randomBytes,
	scryptSync,
} from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { spkiFingerprint } from "./contractPrimitives"

/** Set by the AI-Hydro host and by common agent runtimes; any of them present means "not the owner at a terminal". */
export const AGENT_CONTEXT_ENV_VARS = ["AIHYDRO_AGENT_CONTEXT", "AIHYDRO_ACTIVE", "CLAUDECODE"] as const

export const DEFAULT_KEY_DIR_PARTS = [".ssh", "aihydro-learning-pack"] as const
export const PRIVATE_KEY_FILE = "ed25519.key.pem"
export const PUBLIC_KEY_FILE = "ed25519.pub.pem"
export const MIN_PASSPHRASE_LENGTH = 12

/** Exit code the CLI uses for every refusal in this file. */
export const REFUSAL_EXIT_CODE = 3

export class RefusalError extends Error {
	readonly exitCode = REFUSAL_EXIT_CODE
	constructor(message: string) {
		super(message)
		this.name = "RefusalError"
	}
}

export function defaultKeyDir(home = os.homedir()): string {
	return path.join(home, ...DEFAULT_KEY_DIR_PARTS)
}

export interface OwnerContext {
	env: NodeJS.ProcessEnv
	stdinIsTTY: boolean
	stdoutIsTTY: boolean
}

/**
 * Refuse unless this looks like the owner at an interactive terminal: no agent marker in the environment and a
 * TTY on both stdin and stdout (the passphrase is read from, and the prompt written to, the terminal).
 */
export function assertOwnerContext(context: OwnerContext, action: string): void {
	for (const name of AGENT_CONTEXT_ENV_VARS) {
		if (context.env[name] !== undefined) {
			throw new RefusalError(
				`Refusing to ${action}: ${name} is set, so this looks like an agent session. ` +
					"Run this yourself in your own terminal (outside any agent).",
			)
		}
	}
	if (!context.stdinIsTTY || !context.stdoutIsTTY) {
		throw new RefusalError(
			`Refusing to ${action}: it needs an interactive terminal (stdin and stdout must be a TTY). ` +
				"Run it yourself in a terminal; it cannot be scripted.",
		)
	}
}

/** Nearest ancestor (or `start` itself) that contains a `.git` entry, or undefined. Pure filesystem; runs no program. */
export async function findEnclosingGitWorktree(start: string): Promise<string | undefined> {
	let current = path.resolve(start)
	for (;;) {
		try {
			await fs.lstat(path.join(current, ".git"))
			return current
		} catch {
			// not here
		}
		const parent = path.dirname(current)
		if (parent === current) return undefined
		current = parent
	}
}

/** Resolve the deepest existing ancestor so a not-yet-created key directory is still checked against real paths. */
async function realpathOfDeepestExisting(target: string): Promise<string> {
	let current = path.resolve(target)
	const tail: string[] = []
	for (;;) {
		try {
			return path.join(await fs.realpath(current), ...tail.reverse())
		} catch {
			const parent = path.dirname(current)
			if (parent === current) return path.resolve(target)
			tail.push(path.basename(current))
			current = parent
		}
	}
}

async function assertOutsideGitWorktree(target: string, what: string): Promise<void> {
	const real = await realpathOfDeepestExisting(target)
	const worktree = await findEnclosingGitWorktree(real)
	if (worktree) {
		throw new RefusalError(`Refusing to use ${what} ${target}: it is inside the git work tree ${worktree}`)
	}
}

// --- encrypted PKCS#8 (PBES2: scrypt + AES-256-CBC), readable by Node/OpenSSL's createPrivateKey -----------------

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 4 }) // N*r stays under OpenSSL's 32 MiB decrypt limit
const OID_PBES2 = "2a864886f70d01050d"
const OID_SCRYPT = "2b06010401da47040b"
const OID_AES256_CBC = "60864801650304012a"

function derLength(length: number): Buffer {
	if (length < 0x80) return Buffer.from([length])
	if (length < 0x100) return Buffer.from([0x81, length])
	return Buffer.from([0x82, length >> 8, length & 0xff])
}
function derTlv(tag: number, ...parts: Buffer[]): Buffer {
	const body = Buffer.concat(parts)
	return Buffer.concat([Buffer.from([tag]), derLength(body.length), body])
}
const derSeq = (...parts: Buffer[]): Buffer => derTlv(0x30, ...parts)
const derOctets = (bytes: Buffer): Buffer => derTlv(0x04, bytes)
const derOid = (hex: string): Buffer => derTlv(0x06, Buffer.from(hex, "hex"))
function derInt(value: number): Buffer {
	let hex = value.toString(16)
	if (hex.length % 2) hex = `0${hex}`
	let bytes = Buffer.from(hex, "hex")
	if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes])
	return derTlv(0x02, bytes)
}

/** PKCS#8 PEM. With a passphrase it is `ENCRYPTED PRIVATE KEY` using scrypt (Node's own export is PBKDF2 with 2,048 rounds). */
export function exportPrivateKeyPem(privateKey: KeyObject, passphrase: string | undefined): string {
	if (passphrase === undefined) return privateKey.export({ type: "pkcs8", format: "pem" }) as string
	const salt = randomBytes(16)
	const iv = randomBytes(16)
	const derived = scryptSync(passphrase, salt, 32, { ...SCRYPT, maxmem: 256 * 1024 * 1024 })
	const cipher = createCipheriv("aes-256-cbc", derived, iv)
	const encrypted = Buffer.concat([cipher.update(privateKey.export({ type: "pkcs8", format: "der" })), cipher.final()])
	const der = derSeq(
		derSeq(
			derOid(OID_PBES2),
			derSeq(
				derSeq(derOid(OID_SCRYPT), derSeq(derOctets(salt), derInt(SCRYPT.N), derInt(SCRYPT.r), derInt(SCRYPT.p))),
				derSeq(derOid(OID_AES256_CBC), derOctets(iv)),
			),
		),
		derOctets(encrypted),
	)
	const body = der
		.toString("base64")
		.replace(/(.{64})/g, "$1\n")
		.trimEnd()
	return `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${body}\n-----END ENCRYPTED PRIVATE KEY-----\n`
}

/** SPKI DER of a key object's public half (accepts a private or a public key object). */
export function publicKeySpkiDer(key: KeyObject): Buffer {
	return (key.type === "public" ? key : createPublicKey(key)).export({ format: "der", type: "spki" })
}

export function isEncryptedPrivateKeyPem(text: string): boolean {
	return text.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")
}

export function validatePassphrase(passphrase: string): void {
	if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
		throw new RefusalError(`The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
	}
}

export interface CreatedKey {
	privateKeyPath: string
	publicKeyPath: string
	fingerprint: string
}

async function assertPrivateDirectory(dir: string): Promise<void> {
	const stat = await fs.lstat(dir)
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RefusalError(`${dir} must be a real directory`)
	if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
		throw new RefusalError(`${dir} must not be accessible by group or others (chmod 700 it)`)
	}
}

/**
 * Create a new Ed25519 key pair in `dir`: directory 0700, private key 0600, both created exclusively so an
 * existing key is never overwritten. Refuses a target inside a git work tree. The private key never leaves
 * this function except as the encrypted (or, with `passphrase === undefined`, plain) PEM it writes to disk.
 * Returns only paths and the public fingerprint.
 */
export async function createKeyFiles(dir: string, passphrase: string | undefined): Promise<CreatedKey> {
	if (passphrase !== undefined) validatePassphrase(passphrase)
	await assertOutsideGitWorktree(dir, "key directory")
	const privateKeyPath = path.join(dir, PRIVATE_KEY_FILE)
	const publicKeyPath = path.join(dir, PUBLIC_KEY_FILE)
	await fs.mkdir(dir, { recursive: true, mode: 0o700 })
	await assertPrivateDirectory(dir)
	for (const existing of [privateKeyPath, publicKeyPath]) {
		const present = await fs.lstat(existing).then(
			() => true,
			() => false,
		)
		if (present) throw new RefusalError(`${existing} already exists; refusing to overwrite a key`)
	}
	const { privateKey, publicKey } = generateKeyPairSync("ed25519")
	const privatePem = exportPrivateKeyPem(privateKey, passphrase)
	const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string
	// "wx" = exclusive create: a race with another writer fails instead of overwriting.
	await fs.writeFile(privateKeyPath, privatePem, { flag: "wx", mode: 0o600 })
	try {
		await fs.writeFile(publicKeyPath, publicPem, { flag: "wx", mode: 0o644 })
	} catch (error) {
		await fs.rm(privateKeyPath, { force: true })
		throw error
	}
	return { privateKeyPath, publicKeyPath, fingerprint: spkiFingerprint(publicKeySpkiDer(publicKey)) }
}

export interface LoadedSigningKey {
	privateKey: KeyObject
	fingerprint: string
}

/**
 * Load a private key file for signing. Requires a regular, non-symlink file owned by this user, readable only by
 * the owner (0600-class), outside any git work tree. Throws RefusalError (no key material in the message).
 */
export async function loadSigningKeyFile(keyPath: string, getPassphrase: () => Promise<string>): Promise<LoadedSigningKey> {
	const resolved = path.resolve(keyPath)
	const stat = await fs.lstat(resolved).catch(() => undefined)
	if (!stat) throw new RefusalError(`Key file ${resolved} does not exist`)
	if (stat.isSymbolicLink() || !stat.isFile()) throw new RefusalError(`Key file ${resolved} must be a regular file, not a link`)
	if (process.platform !== "win32") {
		if ((stat.mode & 0o077) !== 0) {
			throw new RefusalError(`Key file ${resolved} must be readable only by you (chmod 600 it)`)
		}
		if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
			throw new RefusalError(`Key file ${resolved} is not owned by the current user`)
		}
	}
	await assertOutsideGitWorktree(resolved, "key file")
	const pem = await fs.readFile(resolved, "utf8")
	let privateKey: KeyObject
	try {
		privateKey = createPrivateKey(
			isEncryptedPrivateKeyPem(pem)
				? { key: pem, format: "pem", passphrase: await getPassphrase() }
				: { key: pem, format: "pem" },
		)
	} catch {
		// Deliberately generic: do not distinguish a wrong passphrase from a corrupt file, and echo nothing.
		throw new RefusalError(`Could not read the signing key ${resolved} (wrong passphrase, or not an Ed25519 PKCS#8 PEM key)`)
	}
	if (privateKey.asymmetricKeyType !== "ed25519") throw new RefusalError(`Key ${resolved} is not an Ed25519 key`)
	return { privateKey, fingerprint: spkiFingerprint(publicKeySpkiDer(privateKey)) }
}

export interface LoadedPublicKey {
	spkiDer: Buffer
	fingerprint: string
}

/** Read an Ed25519 public key from an SPKI PEM or DER file. */
export async function loadPublicKeyFile(publicKeyPath: string): Promise<LoadedPublicKey> {
	const bytes = await fs.readFile(publicKeyPath).catch(() => undefined)
	if (!bytes) throw new RefusalError(`Public key file ${publicKeyPath} cannot be read`)
	const text = bytes.toString("latin1")
	if (text.includes("PRIVATE KEY")) {
		throw new RefusalError(`${publicKeyPath} contains a private key; pass the public key file instead`)
	}
	let key: KeyObject
	try {
		key = text.includes("-----BEGIN PUBLIC KEY-----")
			? createPublicKey({ key: bytes, format: "pem" })
			: createPublicKey({ key: bytes, format: "der", type: "spki" })
	} catch {
		throw new RefusalError(`${publicKeyPath} is not an SPKI public key (PEM or DER)`)
	}
	if (key.asymmetricKeyType !== "ed25519") throw new RefusalError(`${publicKeyPath} is not an Ed25519 public key`)
	const spkiDer = key.export({ format: "der", type: "spki" })
	return { spkiDer, fingerprint: spkiFingerprint(spkiDer) }
}

export type PassphraseReader = (prompt: string) => Promise<string>

/**
 * Read a passphrase from the controlling terminal without echo. Characters are consumed in raw mode, so they
 * are never written to the screen, the shell history or any log. Ctrl-C aborts.
 */
export const readPassphraseFromTty: PassphraseReader = (prompt) =>
	new Promise((resolve, reject) => {
		const { stdin, stdout } = process
		if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
			reject(new RefusalError("A passphrase can only be read from an interactive terminal"))
			return
		}
		stdout.write(prompt)
		let value = ""
		const finish = (action: () => void): void => {
			stdin.setRawMode(false)
			stdin.pause()
			stdin.removeListener("data", onData)
			stdout.write("\n")
			action()
		}
		const onData = (chunk: Buffer): void => {
			for (const char of chunk.toString("utf8")) {
				if (char === "\r" || char === "\n" || char === "\u0004") {
					finish(() => resolve(value))
					return
				}
				if (char === "\u0003") {
					finish(() => reject(new RefusalError("Cancelled")))
					return
				}
				if (char === "\u007f" || char === "\b") value = value.slice(0, -1)
				else if (char >= " ") value += char
			}
		}
		stdin.setRawMode(true)
		stdin.resume()
		stdin.on("data", onData)
	})
