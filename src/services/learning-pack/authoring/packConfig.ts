/**
 * `pack.config.json`: everything an author decides about a pack that is not in the course sources. Parsed
 * strictly and fail closed: an unknown key, a wrong type or an unusable ID is an error, never ignored, so a
 * typo cannot silently change what gets signed.
 */

import Ajv from "ajv"
import { validRange, valid as validSemver } from "semver"
import { parseStrictJsonSource } from "../canonicalJson"

export const DEFAULT_AI_HYDRO_RANGE = ">=0.4.0 <0.5.0"
export const CONTRACT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/
/** Where an author may place extra files in a pack, and the one file the builder owns. */
export const EXTRA_FILE_ROOTS = ["assets", "datasets", "citations", "environments"] as const
const BUILDER_OWNED_PATHS = new Set(["environments/environment.json"])

export interface PackConfig {
	schemaVersion: 1
	packId: string
	version: string
	edition: "student" | "instructor"
	publisher: { name: string }
	title?: string
	license?: string
	aiHydroRange: string
	localPython: "none" | "terminal-equivalent"
	/** Source module ID that opens first; defaults to the first module in the source `course.json`. */
	entryModule?: string
	/** Prefix added to every source ID without an explicit `idMap` entry. */
	idPrefix?: string
	/** Source ID (course or module) to pack ID. */
	idMap: Record<string, string>
	environment: { python: string; requiredImports: string[] }
	files: { source: string; dest: string }[]
}

const idSchema = { type: "string", minLength: 1, maxLength: 128 } as const

const schema = {
	type: "object",
	additionalProperties: false,
	required: ["schemaVersion", "packId", "version", "edition", "publisher"],
	properties: {
		schemaVersion: { const: 1 },
		packId: idSchema,
		version: { type: "string", minLength: 1, maxLength: 100 },
		edition: { enum: ["student", "instructor"] },
		publisher: {
			type: "object",
			additionalProperties: false,
			required: ["name"],
			properties: { name: { type: "string", minLength: 1, maxLength: 200 } },
		},
		title: { type: "string", minLength: 1, maxLength: 200 },
		license: { type: "string", minLength: 1, maxLength: 100 },
		aiHydroRange: { type: "string", minLength: 1, maxLength: 100 },
		localPython: { enum: ["none", "terminal-equivalent"] },
		entryModule: { type: "string", minLength: 1, maxLength: 256 },
		idPrefix: { type: "string", minLength: 1, maxLength: 120 },
		idMap: { type: "object", additionalProperties: idSchema },
		environment: {
			type: "object",
			additionalProperties: false,
			properties: {
				python: { type: "string", minLength: 1, maxLength: 100 },
				requiredImports: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 100 } },
			},
		},
		files: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["source", "dest"],
				properties: {
					source: { type: "string", minLength: 1, maxLength: 1024 },
					dest: { type: "string", minLength: 1, maxLength: 1024 },
				},
			},
		},
	},
} as const

const ajv = new Ajv({ allErrors: true, strict: true })
const validateSchema = ajv.compile(schema)

export class PackConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "PackConfigError"
	}
}

/** Parse and validate `pack.config.json` bytes. Throws PackConfigError with one actionable message. */
export function parsePackConfig(bytes: Uint8Array, label = "pack.config.json"): PackConfig {
	let raw: unknown
	try {
		raw = parseStrictJsonSource(bytes, label)
	} catch (error) {
		throw new PackConfigError(error instanceof Error ? error.message : String(error))
	}
	if (!validateSchema(raw)) {
		const detail = validateSchema.errors
			?.map((error) => {
				const extra = error.keyword === "additionalProperties" ? ` (${String(error.params.additionalProperty)})` : ""
				return `${error.instancePath || "/"} ${error.message}${extra}`
			})
			.join("; ")
		throw new PackConfigError(`${label} is invalid: ${detail ?? "unknown error"}`)
	}
	const input = raw as unknown as Record<string, unknown> & {
		packId: string
		version: string
		edition: "student" | "instructor"
		publisher: { name: string }
		idMap?: Record<string, string>
		environment?: { python?: string; requiredImports?: string[] }
		files?: { source: string; dest: string }[]
	}
	if (!CONTRACT_ID_PATTERN.test(input.packId)) {
		throw new PackConfigError(`${label}: packId "${input.packId}" is not a valid contract ID`)
	}
	if (!validSemver(input.version)) throw new PackConfigError(`${label}: version "${input.version}" is not valid SemVer`)
	const range = typeof input.aiHydroRange === "string" ? input.aiHydroRange : DEFAULT_AI_HYDRO_RANGE
	if (!validRange(range)) throw new PackConfigError(`${label}: aiHydroRange "${range}" is not a valid SemVer range`)
	if (typeof input.idPrefix === "string" && !/^[a-z0-9][a-z0-9._-]*$/.test(input.idPrefix)) {
		throw new PackConfigError(`${label}: idPrefix "${input.idPrefix}" must be lowercase ASCII (letters, digits, . _ -)`)
	}
	const idMap = Object.create(null) as Record<string, string>
	for (const [source, target] of Object.entries(input.idMap ?? {})) {
		if (!CONTRACT_ID_PATTERN.test(target)) {
			throw new PackConfigError(`${label}: idMap target "${target}" for "${source}" is not a valid contract ID`)
		}
		idMap[source] = target
	}
	const files = (input.files ?? []).map((entry) => normaliseExtraFile(entry, label))
	const dests = files.map((file) => file.dest)
	if (new Set(dests).size !== dests.length) throw new PackConfigError(`${label}: files contains a duplicate dest`)
	return {
		schemaVersion: 1,
		packId: input.packId,
		version: input.version,
		edition: input.edition,
		publisher: { name: input.publisher.name },
		...(typeof input.title === "string" ? { title: input.title } : {}),
		...(typeof input.license === "string" ? { license: input.license } : {}),
		aiHydroRange: range,
		localPython: (input.localPython as PackConfig["localPython"] | undefined) ?? "terminal-equivalent",
		...(typeof input.entryModule === "string" ? { entryModule: input.entryModule } : {}),
		...(typeof input.idPrefix === "string" ? { idPrefix: input.idPrefix } : {}),
		idMap,
		environment: {
			python: input.environment?.python ?? ">=3.11",
			requiredImports: [...(input.environment?.requiredImports ?? [])],
		},
		files,
	}
}

function normaliseExtraFile(entry: { source: string; dest: string }, label: string): { source: string; dest: string } {
	const dest = entry.dest
	const parts = dest.split("/")
	const bad =
		dest !== dest.normalize("NFC") ||
		dest.includes("\\") ||
		dest.includes("\0") ||
		parts.some((part) => part === "" || part === "." || part === "..")
	if (bad || parts.length < 2 || !(EXTRA_FILE_ROOTS as readonly string[]).includes(parts[0])) {
		throw new PackConfigError(`${label}: files dest "${dest}" must be a relative path under ${EXTRA_FILE_ROOTS.join("/, ")}/`)
	}
	if (BUILDER_OWNED_PATHS.has(dest)) throw new PackConfigError(`${label}: files dest "${dest}" is generated by the builder`)
	return { source: entry.source, dest }
}
