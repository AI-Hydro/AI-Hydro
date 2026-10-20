/**
 * Entry point for `aihydro-pack`, bundled to dist/aihydro-pack.cjs by `node esbuild.mjs --pack-cli`.
 * It is a separate bundle on purpose: the signer must never be part of extension.js, and it is excluded
 * from the VSIX (.vscodeignore). All logic lives in src/services/learning-pack/authoring/cli.ts.
 */

import pkg from "../package.json"
import { runCli } from "../src/services/learning-pack/authoring/cli"
import { readPassphraseFromTty } from "../src/services/learning-pack/authoring/keys"

runCli({
	argv: process.argv.slice(2),
	cwd: process.cwd(),
	env: process.env,
	stdinIsTTY: Boolean(process.stdin.isTTY),
	stdoutIsTTY: Boolean(process.stdout.isTTY),
	aiHydroVersion: pkg.version,
	readPassphrase: readPassphraseFromTty,
	out: (text) => {
		process.stdout.write(text)
	},
	err: (text) => {
		process.stderr.write(text)
	},
}).then(
	(code) => {
		process.exitCode = code
	},
	(error: unknown) => {
		process.stderr.write(`aihydro-pack: ${error instanceof Error ? error.message : String(error)}\n`)
		process.exitCode = 1
	},
)
