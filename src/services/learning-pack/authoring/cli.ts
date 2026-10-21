/**
 * `aihydro-pack`: build, sign and verify Learning Packs. See docs/learning-pack-authoring.md.
 *
 * Exit codes: 0 success, 1 the work failed (invalid input, unverifiable pack, mismatch), 2 usage error,
 * 3 refused (agent context, no terminal, unsafe key location). A refusal writes nothing.
 *
 * `runCli` takes everything it touches (environment, TTY facts, passphrase reader, output) as a context so it
 * is testable. The context deliberately has no way to supply key bytes or a passphrase from outside: the only
 * passphrase source is `readPassphrase`, which the entry point binds to the controlling terminal.
 */

import { randomBytes } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { parseArgs } from "node:util"
import { inspectLearningPackArchiveBytes } from "../inspectLearningPackArchive"
import { assembleUnsignedPack, PackBuildError } from "./buildPack"
import {
	assertOwnerContext,
	createKeyFiles,
	defaultKeyDir,
	loadPublicKeyFile,
	loadSigningKeyFile,
	type PassphraseReader,
	PRIVATE_KEY_FILE,
	REFUSAL_EXIT_CODE,
	RefusalError,
} from "./keys"
import { PackConfigError, parsePackConfig } from "./packConfig"
import { SignError, signPack } from "./signPack"
import { assertSourcesMatchCommit, loadSources, readSourceProvenance } from "./sourceLoader"

export interface CliContext {
	argv: readonly string[]
	cwd: string
	env: NodeJS.ProcessEnv
	stdinIsTTY: boolean
	stdoutIsTTY: boolean
	/** Version of the AI-Hydro extension this tool ships with; `verify` checks compatibility against it by default. */
	aiHydroVersion: string
	readPassphrase: PassphraseReader
	out: (text: string) => void
	err: (text: string) => void
}

const USAGE = `aihydro-pack: build, sign and verify AI-Hydro Learning Packs

  aihydro-pack init-key [--out DIR] [--no-passphrase]
  aihydro-pack fingerprint <public-key | private-key | pack>
  aihydro-pack build <course-dir> --out FILE [--config FILE] [--publisher-pub FILE]
                     [--kind development|release] [--root DIR] [--source-commit SHA] [--force]
  aihydro-pack sign <unsigned-pack> --out FILE [--key FILE] [--force]
  aihydro-pack sign <unsigned-pack> --out FILE --ephemeral [--force]
  aihydro-pack verify <pack> [--expect-fingerprint sha256:HEX] [--ai-hydro-version V] [--json]
  aihydro-pack inspect <pack> [--ai-hydro-version V] [--json]

init-key and sign --key must be run by you, in a terminal, outside any agent; they refuse otherwise (exit 3).
`

class UsageError extends Error {}

function resolve(ctx: CliContext, p: string): string {
	return path.resolve(ctx.cwd, p)
}

/**
 * Write the output atomically: a temp file in the same directory, then a link (no overwrite) or rename (--force).
 * A symlink at the target is refused either way, so a planted link can never redirect the write, and a failure
 * never leaves a half-written pack at the target.
 */
async function writeOutput(target: string, bytes: Uint8Array, force: boolean): Promise<void> {
	await fs.mkdir(path.dirname(target), { recursive: true })
	const existing = await fs.lstat(target).catch(() => undefined)
	if (existing?.isSymbolicLink()) throw new PackBuildError(`${target} is a symbolic link; refusing to write through it`)
	if (existing && !force) throw new PackBuildError(`${target} already exists (pass --force to replace it)`)
	if (existing && !existing.isFile()) throw new PackBuildError(`${target} exists and is not a regular file`)
	const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`)
	try {
		await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o644 })
		if (force) {
			await fs.rename(temporary, target)
			return
		}
		try {
			await fs.link(temporary, target) // fails with EEXIST if something appeared meanwhile
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === "EEXIST") throw new PackBuildError(`${target} already exists (pass --force to replace it)`)
			// A filesystem without hard links: fall back to rename after re-checking.
			if (
				await fs.lstat(target).then(
					() => true,
					() => false,
				)
			) {
				throw new PackBuildError(`${target} already exists (pass --force to replace it)`)
			}
			await fs.rename(temporary, target)
		}
	} finally {
		await fs.rm(temporary, { force: true })
	}
}

type OptionSpec = Record<string, { type: "string" | "boolean" }>
type OptionValues<T extends OptionSpec> = { [K in keyof T]?: T[K]["type"] extends "string" ? string : boolean }

function options<T extends OptionSpec>(
	ctx: CliContext,
	spec: T,
	positionals: number,
): { values: OptionValues<T>; positionals: string[] } {
	try {
		const parsed = parseArgs({ args: [...ctx.argv.slice(1)], options: spec, allowPositionals: true, strict: true })
		if (parsed.positionals.length !== positionals) {
			throw new UsageError(
				`expected ${positionals} argument${positionals === 1 ? "" : "s"}, got ${parsed.positionals.length}`,
			)
		}
		return { values: parsed.values as unknown as OptionValues<T>, positionals: parsed.positionals }
	} catch (error) {
		if (error instanceof UsageError) throw error
		throw new UsageError(error instanceof Error ? error.message : String(error))
	}
}

async function initKey(ctx: CliContext): Promise<number> {
	const { values } = options(ctx, { out: { type: "string" }, "no-passphrase": { type: "boolean" } }, 0)
	assertOwnerContext(ctx, "create a signing key")
	const dir = values.out ? resolve(ctx, values.out) : defaultKeyDir()
	let passphrase: string | undefined
	if (!values["no-passphrase"]) {
		passphrase = await ctx.readPassphrase("New key passphrase (min 12 characters, not echoed): ")
		const again = await ctx.readPassphrase("Repeat passphrase: ")
		if (passphrase !== again) throw new RefusalError("The passphrases do not match; no key was created")
	}
	if (passphrase === undefined) {
		ctx.err(
			"WARNING: --no-passphrase writes an UNENCRYPTED private key. Anyone or anything that can read the file can sign as you.\n" +
				"Use it only on a machine you fully control, and prefer a passphrase.\n",
		)
	}
	const created = await createKeyFiles(dir, passphrase)
	ctx.out(`public key:  ${created.publicKeyPath}\nfingerprint: ${created.fingerprint}\n`)
	ctx.out(
		"The private key was written (mode 0600) next to it and is not shown. Back it up offline, and publish the\n" +
			"fingerprint through a channel readers already trust (README, docs site, your profile).\n",
	)
	return 0
}

async function fingerprintCommand(ctx: CliContext): Promise<number> {
	const { positionals } = options(ctx, {}, 1)
	const target = resolve(ctx, positionals[0])
	const bytes = await fs.readFile(target).catch(() => undefined)
	if (!bytes) throw new PackBuildError(`${target} cannot be read`)
	if (bytes.subarray(0, 2).toString("latin1") === "PK") {
		const result = await inspectLearningPackArchiveBytes(bytes, { aiHydroVersion: ctx.aiHydroVersion })
		const fingerprint = result.inspection?.contract.signerFingerprint
		if (!fingerprint) throw new PackBuildError(`The pack does not verify (${result.status}); no trustworthy fingerprint`)
		ctx.out(`${fingerprint}\n`)
		return 0
	}
	if (bytes.toString("latin1").includes("PRIVATE KEY")) {
		// Reading a private key (even only to print its public fingerprint) is an owner action.
		assertOwnerContext(ctx, "read a private key")
		const loaded = await loadSigningKeyFile(target, () => ctx.readPassphrase("Key passphrase (not echoed): "))
		ctx.out(`${loaded.fingerprint}\n`)
		return 0
	}
	ctx.out(`${(await loadPublicKeyFile(target)).fingerprint}\n`)
	return 0
}

async function buildCommand(ctx: CliContext): Promise<number> {
	const { values, positionals } = options(
		ctx,
		{
			out: { type: "string" },
			config: { type: "string" },
			"publisher-pub": { type: "string" },
			kind: { type: "string" },
			root: { type: "string" },
			"source-commit": { type: "string" },
			force: { type: "boolean" },
		},
		1,
	)
	if (!values.out) throw new UsageError("build needs --out FILE")
	const kind = values.kind ?? "development"
	if (kind !== "development" && kind !== "release") throw new UsageError("--kind must be development or release")
	const courseDir = resolve(ctx, positionals[0])
	const rootDir = values.root ? resolve(ctx, values.root) : courseDir
	const configPath = values.config ? resolve(ctx, values.config) : path.join(courseDir, "pack.config.json")
	const configBytes = await fs.readFile(configPath).catch(() => undefined)
	if (!configBytes) throw new PackBuildError(`${configPath} cannot be read`)
	const config = parsePackConfig(configBytes, configPath)
	const publisher = values["publisher-pub"] ? await loadPublicKeyFile(resolve(ctx, values["publisher-pub"])) : undefined
	if (kind === "release" && !publisher) throw new UsageError("--kind release needs --publisher-pub FILE")
	const sources = await loadSources({ courseDir, rootDir, config })
	const provenance = readSourceProvenance(rootDir, {
		buildKind: kind,
		env: ctx.env,
		sourceCommitOverride: values["source-commit"],
	})
	if (kind === "release") {
		// The config decides what is signed (IDs, range, license), so it must be a committed file of the source repo too.
		if (path.relative(rootDir, configPath).startsWith("..") || path.isAbsolute(path.relative(rootDir, configPath))) {
			throw new PackBuildError(
				`A release build needs the config inside the source root so it is tracked at the signed commit; ${configPath} is outside ${rootDir}`,
			)
		}
		assertSourcesMatchCommit(rootDir, new Map([...(sources.sourceFiles ?? new Map()), [configPath, configBytes]]))
	}
	const built = await assembleUnsignedPack({
		config,
		sources,
		buildKind: kind,
		publisherSpkiDer: publisher?.spkiDer,
		provenance,
	})
	const target = resolve(ctx, values.out)
	await writeOutput(target, built.archive, Boolean(values.force))
	ctx.out(`built ${target} (unsigned ${kind} build, ${built.files.size} files)\n`)
	ctx.out(`pack ${built.manifest.packId} ${built.manifest.version} ${built.manifest.edition}; key ID ${built.keyId}\n`)
	for (const transform of built.transforms) {
		if (transform.type === "course-id-rewrite") ctx.out(`  course id ${transform.from} -> ${transform.to}\n`)
		else if (transform.type === "module-id-rewrite") ctx.out(`  module id ${transform.from} -> ${transform.to}\n`)
	}
	return 0
}

async function signCommand(ctx: CliContext): Promise<number> {
	const { values, positionals } = options(
		ctx,
		{ out: { type: "string" }, key: { type: "string" }, ephemeral: { type: "boolean" }, force: { type: "boolean" } },
		1,
	)
	if (!values.out) throw new UsageError("sign needs --out FILE")
	if (values.ephemeral && values.key) throw new UsageError("--ephemeral and --key are mutually exclusive")
	if (!values.ephemeral) assertOwnerContext(ctx, "sign with a publisher key")
	const unsignedPath = resolve(ctx, positionals[0])
	const unsigned = await fs.readFile(unsignedPath).catch(() => undefined)
	if (!unsigned) throw new PackBuildError(`${unsignedPath} cannot be read`)
	let signed: Awaited<ReturnType<typeof signPack>>
	if (values.ephemeral) {
		signed = await signPack({ unsigned, signer: { kind: "ephemeral" } })
	} else {
		const keyPath = values.key ? resolve(ctx, values.key) : path.join(defaultKeyDir(), PRIVATE_KEY_FILE)
		const key = await loadSigningKeyFile(keyPath, () => ctx.readPassphrase("Key passphrase (not echoed): "))
		signed = await signPack({ unsigned, signer: { kind: "key", privateKey: key.privateKey } })
	}
	const target = resolve(ctx, values.out)
	await writeOutput(target, signed.archive, Boolean(values.force))
	ctx.out(`signed ${target}\nfingerprint: ${signed.fingerprint}\n`)
	if (signed.ephemeral) {
		ctx.out(
			"Signed with a throwaway key (development build). AI-Hydro installs it as signed-untrusted; the key is gone, so\n" +
				"it cannot be reproduced or trusted across upgrades.\n",
		)
	}
	return 0
}

async function loadPack(ctx: CliContext, file: string, version: string) {
	const target = resolve(ctx, file)
	const bytes = await fs.readFile(target).catch(() => undefined)
	if (!bytes) throw new PackBuildError(`${target} cannot be read`)
	return { target, result: await inspectLearningPackArchiveBytes(bytes, { aiHydroVersion: version }) }
}

async function verifyCommand(ctx: CliContext, inspectOnly: boolean): Promise<number> {
	const { values, positionals } = options(
		ctx,
		{
			"expect-fingerprint": { type: "string" },
			"ai-hydro-version": { type: "string" },
			json: { type: "boolean" },
		},
		1,
	)
	if (inspectOnly && values["expect-fingerprint"]) throw new UsageError("inspect takes no --expect-fingerprint (use verify)")
	const version = values["ai-hydro-version"] ?? ctx.aiHydroVersion
	const { target, result } = await loadPack(ctx, positionals[0], version)
	const contract = result.inspection?.contract
	const expected = values["expect-fingerprint"]
	const fingerprintMatches = expected === undefined || contract?.signerFingerprint === expected
	const ok = result.status === "valid" && fingerprintMatches
	if (values.json) {
		ctx.out(
			`${JSON.stringify({
				status: result.status,
				diagnostics: result.diagnostics,
				signerFingerprint: contract?.signerFingerprint,
				expectedFingerprint: expected,
				fingerprintMatches: expected === undefined ? undefined : fingerprintMatches,
				packId: contract?.manifest.packId,
				version: contract?.manifest.version,
				edition: contract?.manifest.edition,
				aiHydroVersion: version,
			})}\n`,
		)
		return ok ? 0 : 1
	}
	ctx.out(`${target}\nstatus: ${result.status} (checked against AI-Hydro ${version})\n`)
	for (const d of result.diagnostics) ctx.err(`  ${d.code}: ${d.message}${d.path ? ` (${d.path})` : ""}\n`)
	if (contract) {
		const { manifest } = contract
		ctx.out(`pack:        ${manifest.packId} ${manifest.version} (${manifest.edition})\n`)
		ctx.out(`signed by the key with fingerprint ${contract.signerFingerprint}\n`)
		if (expected !== undefined) {
			ctx.out(fingerprintMatches ? "fingerprint matches the expected value\n" : `fingerprint does NOT match ${expected}\n`)
		}
		if (inspectOnly) {
			const provenance = result.inspection?.files.get("provenance/provenance.json")
			ctx.out(`publisher:   ${manifest.publisher.name} (key ID ${manifest.publisher.keyId})\n`)
			ctx.out(
				`course:      ${manifest.ownership.courseId}, ${manifest.ownership.moduleIds.length} modules, entry ${manifest.entryModuleId}\n`,
			)
			ctx.out(
				`compat:      AI-Hydro ${manifest.compatibility.aiHydro}; local Python ${manifest.capabilities.localPython}\n`,
			)
			ctx.out(`files:       ${contract.checksums.files.length} signed payload files\n`)
			if (provenance) ctx.out(`provenance:  ${Buffer.from(provenance).toString("utf8").trimEnd()}\n`)
		}
		ctx.out(
			"Valid means the bytes match the signed inventory and the signature. It does not identify the publisher:\n" +
				"compare the fingerprint with the one the author published.\n",
		)
	}
	return ok ? 0 : 1
}

/** Run one command. Never throws for expected failures; returns the exit code. */
export async function runCli(ctx: CliContext): Promise<number> {
	const [command] = ctx.argv
	try {
		switch (command) {
			case "init-key":
				return await initKey(ctx)
			case "fingerprint":
				return await fingerprintCommand(ctx)
			case "build":
				return await buildCommand(ctx)
			case "sign":
				return await signCommand(ctx)
			case "verify":
				return await verifyCommand(ctx, false)
			case "inspect":
				return await verifyCommand(ctx, true)
			case undefined:
			case "help":
			case "--help":
			case "-h":
				ctx.out(USAGE)
				return command === undefined ? 2 : 0
			default:
				throw new UsageError(`unknown command "${command}"`)
		}
	} catch (error) {
		if (error instanceof UsageError) {
			ctx.err(`aihydro-pack: ${error.message}\n\n${USAGE}`)
			return 2
		}
		if (error instanceof RefusalError) {
			ctx.err(`aihydro-pack: ${error.message}\n`)
			return REFUSAL_EXIT_CODE
		}
		if (error instanceof PackBuildError || error instanceof SignError || error instanceof PackConfigError) {
			ctx.err(`aihydro-pack: ${error.message}\n`)
			return 1
		}
		// Unexpected: report the message only (never a stack that could carry paths or values from a key flow).
		ctx.err(`aihydro-pack: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`)
		return 1
	}
}
