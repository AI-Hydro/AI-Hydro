import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { verifyDevelopmentVsix } from "./verify-development-vsix.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"))
const EXPECTED_VSCE_VERSION = "3.6.2"
const FORBIDDEN_BUILD_ENVIRONMENT = Object.freeze([
	"CLINE_ENVIRONMENT",
	"ERROR_SERVICE_API_KEY",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_HEADERS",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_LOGS_EXPORTER",
	"OTEL_METRICS_EXPORTER",
	"OTEL_METRIC_EXPORT_INTERVAL",
	"OTEL_TELEMETRY_ENABLED",
	"OVSX_PAT",
	"POSTHOG_TELEMETRY_ENABLED",
	"TELEMETRY_SERVICE_API_KEY",
	"VSCE_PAT",
])

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		stdio: options.capture ? "pipe" : "inherit",
		...options,
	})
	if (result.status !== 0) {
		throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`)
	}
	return options.capture ? result.stdout.trim() : undefined
}

function sha256File(filePath) {
	return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function stableJson(value) {
	if (Array.isArray(value)) return value.map(stableJson)
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, stableJson(value[key])]),
		)
	}
	return value
}

function parseOutputPath() {
	const outIndex = process.argv.indexOf("--out")
	if (outIndex === -1) return undefined
	if (!process.argv[outIndex + 1]) throw new Error("--out requires a path")
	return path.resolve(process.cwd(), process.argv[outIndex + 1])
}

async function main() {
	if (Number.parseInt(process.versions.node.split(".")[0], 10) !== 22) {
		throw new Error(`Development VSIX builds require Node.js 22; received ${process.version}`)
	}
	const injectedBuildEnvironment = FORBIDDEN_BUILD_ENVIRONMENT.filter((name) => process.env[name])
	if (injectedBuildEnvironment.length > 0) {
		throw new Error(
			`Development VSIX builds must not inject publishing or telemetry configuration: ${injectedBuildEnvironment.join(", ")}`,
		)
	}

	const commit = run("git", ["rev-parse", "HEAD"], { capture: true })
	const dirty = run("git", ["status", "--porcelain", "--untracked-files=normal"], { capture: true })
	if (dirty && process.env.AIHYDRO_ALLOW_DIRTY_VSIX !== "1") {
		throw new Error(
			"Refusing to produce commit-labelled evidence from a dirty source tree. Commit the intended changes or set AIHYDRO_ALLOW_DIRTY_VSIX=1 for a non-evidence local build.",
		)
	}

	const defaultName = `ai-hydro-${packageJson.version}-${commit.slice(0, 12)}.vsix`
	const vsixPath = parseOutputPath() ?? path.join(root, "dist", defaultName)
	const outputDir = path.dirname(vsixPath)
	const sumsPath = path.join(outputDir, "SHA256SUMS")
	const provenancePath = path.join(outputDir, "vsix-provenance.json")
	for (const output of [vsixPath, sumsPath, provenancePath]) {
		if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing artifact: ${output}`)
	}
	fs.mkdirSync(path.dirname(vsixPath), { recursive: true })

	const vsceCli = path.join(root, "node_modules", "@vscode", "vsce", "vsce")
	if (!fs.existsSync(vsceCli)) {
		throw new Error("Locked @vscode/vsce is not installed. Run npm ci before packaging.")
	}
	const installedVsceVersion = JSON.parse(
		fs.readFileSync(path.join(root, "node_modules", "@vscode", "vsce", "package.json"), "utf8"),
	).version
	const lockedVsceVersion = packageLock.packages?.["node_modules/@vscode/vsce"]?.version
	const lockedVsceSpec = packageLock.packages?.[""]?.devDependencies?.["@vscode/vsce"]
	if (
		installedVsceVersion !== EXPECTED_VSCE_VERSION ||
		lockedVsceVersion !== EXPECTED_VSCE_VERSION ||
		lockedVsceSpec !== packageJson.devDependencies?.["@vscode/vsce"]
	) {
		throw new Error(
			`Development VSIX builds require lock-installed @vscode/vsce ${EXPECTED_VSCE_VERSION}; manifest=${packageJson.devDependencies?.["@vscode/vsce"]}, lockSpec=${lockedVsceSpec}, lock=${lockedVsceVersion}, installed=${installedVsceVersion}`,
		)
	}

	let inspection
	try {
		run(process.execPath, [vsceCli, "package", "--allow-package-secrets", "sendgrid", "--out", vsixPath])
		inspection = await verifyDevelopmentVsix(vsixPath, {
			name: packageJson.name,
			publisher: packageJson.publisher,
			version: packageJson.version,
		})
		const postBuildDirty = run("git", ["status", "--porcelain", "--untracked-files=normal"], { capture: true })
		if (postBuildDirty !== dirty) {
			throw new Error("VSIX build changed the tracked source tree; refusing to retain misleading commit evidence")
		}
	} catch (error) {
		fs.rmSync(vsixPath, { force: true })
		throw error
	}
	const npmVersion = run("npm", ["--version"], { capture: true })

	const provenance = stableJson({
		artifact: {
			bytes: inspection.bytes,
			entryCount: inspection.entryCount,
			file: inspection.artifact,
			sha256: inspection.sha256,
			sha256SumsCoverage: "VSIX raw bytes only",
		},
		buildKind: "development",
		buildTimeUtc: new Date().toISOString(),
		extension: {
			learningPackCommands: inspection.learningPackCommands,
			learningPackContract: inspection.learningPackContract,
			name: inspection.name,
			publisher: inspection.publisher,
			version: inspection.version,
			vscodeEngine: inspection.vscodeEngine,
		},
		nonClaims: [
			"Not a marketplace release",
			"Not durable or immutable distribution",
			"Not functional execution proof beyond packaged declarations and runtime assets",
			"Not publisher-identity verification",
			"Not signed provenance or byte-reproducible build proof",
			"Not a sandbox for Python execution",
			"Not a final student distribution",
		],
		run: {
			event: process.env.GITHUB_EVENT_NAME || null,
			id: process.env.GITHUB_RUN_ID || null,
			attempt: process.env.GITHUB_RUN_ATTEMPT || null,
			ref: process.env.GITHUB_REF || null,
		},
		schemaVersion: 1,
		secretBoundary: {
			forbiddenBuildEnvironment: FORBIDDEN_BUILD_ENVIRONMENT,
			vsceAllowPackageSecrets: ["sendgrid"],
		},
		source: {
			clean: dirty.length === 0,
			commit,
			packageLockSha256: sha256File(path.join(root, "package-lock.json")),
			repository: packageJson.repository?.url,
			webviewPackageLockSha256: sha256File(path.join(root, "webview-ui", "package-lock.json")),
		},
		toolchain: {
			architecture: process.arch,
			node: process.version,
			npm: npmVersion,
			operatingSystem: `${process.platform} ${os.release()}`,
			vsce: installedVsceVersion,
		},
	})

	fs.writeFileSync(sumsPath, `${inspection.sha256}  ${inspection.artifact}\n`, "utf8")
	fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8")
	const writtenSum = fs.readFileSync(sumsPath, "utf8")
	if (writtenSum !== `${sha256File(vsixPath)}  ${path.basename(vsixPath)}\n`) {
		throw new Error("Written SHA256SUMS does not match the retained VSIX raw bytes")
	}

	process.stdout.write(`${JSON.stringify({ provenance: provenancePath, sha256sums: sumsPath, vsix: vsixPath }, null, 2)}\n`)
}

main().catch((error) => {
	process.stderr.write(`${error.stack ?? error.message}\n`)
	process.exitCode = 1
})
