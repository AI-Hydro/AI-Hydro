import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import foldcase from "@ar-nelson/foldcase"
import yauzl from "yauzl"

export const REQUIRED_LEARNING_PACK_COMMANDS = Object.freeze([
	"aihydro.learningPacks.install",
	"aihydro.learningPacks.manageTrustedPublishers",
	"aihydro.learningPacks.remove",
	"aihydro.learningPacks.rollback",
])

export const REQUIRED_RUNTIME_ENTRIES = Object.freeze([
	"[Content_Types].xml",
	"extension.vsixmanifest",
	"extension/LICENSE.txt",
	"extension/assets/icons/icon.png",
	"extension/assets/icons/icon.svg",
	"extension/assets/icons/robot_panel_dark.png",
	"extension/assets/icons/robot_panel_light.png",
	"extension/assets/docs/aihydro-hero-animated.svg",
	"extension/assets/docs/aihydro-hero-static.png",
	"extension/dist/extension.js",
	"extension/dist/services/artifact-preview/artifact_kernel_runner.py",
	"extension/dist/tree-sitter-c.wasm",
	"extension/dist/tree-sitter-c_sharp.wasm",
	"extension/dist/tree-sitter-cpp.wasm",
	"extension/dist/tree-sitter-go.wasm",
	"extension/dist/tree-sitter-java.wasm",
	"extension/dist/tree-sitter-javascript.wasm",
	"extension/dist/tree-sitter-kotlin.wasm",
	"extension/dist/tree-sitter-php.wasm",
	"extension/dist/tree-sitter-python.wasm",
	"extension/dist/tree-sitter-ruby.wasm",
	"extension/dist/tree-sitter-rust.wasm",
	"extension/dist/tree-sitter-swift.wasm",
	"extension/dist/tree-sitter-tsx.wasm",
	"extension/dist/tree-sitter-typescript.wasm",
	"extension/dist/tree-sitter.wasm",
	"extension/node_modules/@vscode/codicons/dist/codicon.css",
	"extension/node_modules/@vscode/codicons/dist/codicon.ttf",
	"extension/changelog.md",
	"extension/package.json",
	"extension/readme.md",
	"extension/schemas/learning-pack/v1/pack.schema.json",
	"extension/standalone/runtime-files/vscode/enhanced-terminal.js",
	"extension/walkthrough/step1.md",
	"extension/walkthrough/step2.md",
	"extension/walkthrough/step3.md",
	"extension/walkthrough/step4.md",
	"extension/walkthrough/step5.md",
	"extension/webview-ui/build/assets/codicon.ttf",
	"extension/webview-ui/build/assets/azeret-mono-latin-400-normal.woff",
	"extension/webview-ui/build/assets/azeret-mono-latin-400-normal.woff2",
	"extension/webview-ui/build/assets/azeret-mono-latin-ext-400-normal.woff",
	"extension/webview-ui/build/assets/azeret-mono-latin-ext-400-normal.woff2",
	"extension/webview-ui/build/assets/index.css",
	"extension/webview-ui/build/assets/index.js",
	"extension/webview-ui/build/index.html",
])

const ALLOWED_ROOT_FILES = new Set([
	"extension/LICENSE.txt",
	"extension/PRIVACY.md",
	"extension/changelog.md",
	"extension/package.json",
	"extension/readme.md",
])

const ALLOWED_EXACT_FILES = new Set(REQUIRED_RUNTIME_ENTRIES)
const FORBIDDEN_FILE_PATTERNS = Object.freeze([
	/\.(?:aihydropack|bak|log|map|qmd|tmp|trace|vsix)$/i,
	/(?:^|\/)(?:screenshots?|test-results)(?:\/|$)/i,
])
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".py", ".svg", ".txt", ".xml"])
const SECRET_PATTERNS = Object.freeze([
	{ label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
	{ label: "OpenAI-style key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
	{ label: "SendGrid key", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
	{ label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ label: "private key", pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/ },
])

function sha256(buffer) {
	return crypto.createHash("sha256").update(buffer).digest("hex")
}

function isAllowedEntry(name) {
	return ALLOWED_EXACT_FILES.has(name) || ALLOWED_ROOT_FILES.has(name)
}

function shouldReadEntry(name) {
	return name === "extension.vsixmanifest" || TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())
}

function readZip(vsixPath) {
	return new Promise((resolve, reject) => {
		yauzl.open(vsixPath, { autoClose: false, lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
			if (openError) {
				reject(openError)
				return
			}

			const entries = []
			const selected = new Map()
			const seen = new Set()
			const seenFolded = new Set()
			const sizes = new Map()
			let settled = false

			function fail(error) {
				if (settled) return
				settled = true
				zip.close()
				reject(error)
			}

			zip.on("error", fail)
			zip.on("end", () => {
				if (settled) return
				settled = true
				zip.close()
				resolve({ entries, selected, sizes })
			})
			zip.on("entry", (entry) => {
				const name = entry.fileName
				if (
					name !== name.normalize("NFC") ||
					name.includes("\\") ||
					name.includes("\0") ||
					name.startsWith("/") ||
					/^[A-Za-z]:/.test(name) ||
					name.split("/").some((component) => component === "" || component === "..")
				) {
					fail(new Error(`VSIX contains an unsafe archive path: ${JSON.stringify(name)}`))
					return
				}

				const folded = foldcase(name)
				if (seen.has(name) || seenFolded.has(folded)) {
					fail(new Error(`VSIX contains a duplicate or case-colliding entry: ${name}`))
					return
				}
				seen.add(name)
				seenFolded.add(folded)
				entries.push(name)
				sizes.set(name, entry.uncompressedSize)

				const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
				if ((unixMode & 0o170000) === 0o120000) {
					fail(new Error(`VSIX contains a symbolic link: ${name}`))
					return
				}
				if (!isAllowedEntry(name)) {
					fail(new Error(`VSIX contains an undeclared archive entry: ${name}`))
					return
				}
				if (FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
					fail(new Error(`VSIX contains a forbidden generated, temporary, or course-source file: ${name}`))
					return
				}
				if (!shouldReadEntry(name)) {
					zip.readEntry()
					return
				}
				if (entry.uncompressedSize > 64 * 1024 * 1024) {
					fail(new Error(`Inspectable VSIX entry is unexpectedly large: ${name}`))
					return
				}

				zip.openReadStream(entry, (streamError, stream) => {
					if (streamError) {
						fail(streamError)
						return
					}
					const chunks = []
					stream.on("data", (chunk) => chunks.push(chunk))
					stream.on("error", fail)
					stream.on("end", () => {
						selected.set(name, Buffer.concat(chunks))
						zip.readEntry()
					})
				})
			})

			zip.readEntry()
		})
	})
}

export async function verifyDevelopmentVsix(vsixPath, expected = {}) {
	const absolutePath = path.resolve(vsixPath)
	const archive = fs.readFileSync(absolutePath)
	const { entries, selected, sizes } = await readZip(absolutePath)

	for (const required of REQUIRED_RUNTIME_ENTRIES) {
		if (!sizes.has(required)) {
			throw new Error(`VSIX is missing required entry: ${required}`)
		}
		if (sizes.get(required) === 0) {
			throw new Error(`Required VSIX runtime entry is empty: ${required}`)
		}
	}

	for (const [name, content] of selected) {
		const text = content.toString("utf8")
		for (const { label, pattern } of SECRET_PATTERNS) {
			if (pattern.test(text)) {
				throw new Error(`VSIX contains a possible ${label} in ${name}`)
			}
		}
	}

	let manifest
	try {
		manifest = JSON.parse(selected.get("extension/package.json").toString("utf8"))
	} catch (error) {
		throw new Error(`VSIX package.json is not valid JSON: ${error.message}`)
	}
	if (manifest.main !== "./dist/extension.js") {
		throw new Error(`VSIX package.json main mismatch: expected ./dist/extension.js, received ${manifest.main}`)
	}

	for (const [field, wanted] of Object.entries({
		name: expected.name,
		publisher: expected.publisher,
		version: expected.version,
	})) {
		if (wanted !== undefined && manifest[field] !== wanted) {
			throw new Error(`VSIX ${field} mismatch: expected ${wanted}, received ${manifest[field]}`)
		}
	}

	const declaredCommands = (manifest.contributes?.commands ?? []).map((entry) => entry.command)
	for (const command of REQUIRED_LEARNING_PACK_COMMANDS) {
		const count = declaredCommands.filter((candidate) => candidate === command).length
		if (count !== 1) {
			throw new Error(`VSIX must declare Learning Pack command exactly once (${command}); received ${count}`)
		}
	}

	const installMenuEntries = (manifest.contributes?.menus?.["explorer/context"] ?? []).filter(
		(entry) => entry.command === "aihydro.learningPacks.install" && entry.when === "resourceExtname == .aihydropack",
	)
	if (installMenuEntries.length !== 1) {
		throw new Error(
			`VSIX must declare exactly one .aihydropack Explorer install action; received ${installMenuEntries.length}`,
		)
	}

	const referencedManifestAssets = new Set()
	function collectManifestAssets(value) {
		if (typeof value === "string" && value.startsWith("assets/")) referencedManifestAssets.add(`extension/${value}`)
		else if (Array.isArray(value)) value.forEach(collectManifestAssets)
		else if (value && typeof value === "object") Object.values(value).forEach(collectManifestAssets)
	}
	collectManifestAssets(manifest)
	const readmeText = selected.get("extension/readme.md").toString("utf8")
	const referencedReadmeAssets = new Set(
		[...readmeText.matchAll(/(?:src|srcset)="\.\/(assets\/[^"]+)"/g)].map((match) => `extension/${match[1]}`),
	)
	for (const referenced of [...referencedManifestAssets, ...referencedReadmeAssets]) {
		if (!sizes.has(referenced)) {
			throw new Error(`VSIX is missing a manifest- or README-referenced asset: ${referenced}`)
		}
	}

	const identityText = selected.get("extension.vsixmanifest").toString("utf8")
	const identityTag = identityText.match(/<Identity\s+([^>]+?)\s*\/>/)?.[1]
	const identityAttributes = Object.fromEntries(
		[...(identityTag ?? "").matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
	)
	if (
		identityAttributes.Id !== manifest.name ||
		identityAttributes.Publisher !== manifest.publisher ||
		identityAttributes.Version !== manifest.version
	) {
		throw new Error("VSIX manifest identity does not match embedded package.json")
	}

	const schemaBytes = selected.get("extension/schemas/learning-pack/v1/pack.schema.json")
	let packSchema
	try {
		packSchema = JSON.parse(schemaBytes.toString("utf8"))
	} catch (error) {
		throw new Error(`Packaged Learning Pack schema is not valid JSON: ${error.message}`)
	}
	const learningPackContract = Object.freeze({
		packApi: packSchema.properties?.compatibility?.properties?.packApi?.const,
		runtimeContract: packSchema.properties?.compatibility?.properties?.runtimeContract?.const,
		schemaSha256: sha256(schemaBytes),
		schemaVersion: packSchema.properties?.schemaVersion?.const,
	})
	if (
		learningPackContract.schemaVersion !== 1 ||
		learningPackContract.packApi !== 1 ||
		learningPackContract.runtimeContract !== "html-preview-v1"
	) {
		throw new Error("Packaged Learning Pack schema does not declare the supported v1 contract tuple")
	}

	return Object.freeze({
		artifact: path.basename(absolutePath),
		bytes: archive.length,
		entryCount: entries.length,
		name: manifest.name,
		publisher: manifest.publisher,
		sha256: sha256(archive),
		version: manifest.version,
		vscodeEngine: manifest.engines?.vscode,
		learningPackContract,
		learningPackCommands: REQUIRED_LEARNING_PACK_COMMANDS,
	})
}

async function main() {
	const vsixPath = process.argv[2]
	if (!vsixPath) {
		throw new Error("Usage: node scripts/verify-development-vsix.mjs <path-to-vsix>")
	}
	const result = await verifyDevelopmentVsix(vsixPath)
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main().catch((error) => {
		process.stderr.write(`${error.stack ?? error.message}\n`)
		process.exitCode = 1
	})
}
