import { generateKeyPairSync, type KeyObject } from "node:crypto"
import { type BuildPackInput, type SourceBundle } from "../buildPack"
import { publicKeySpkiDer } from "../keys"
import { type PackConfig, parsePackConfig } from "../packConfig"

export const COMMIT = "0123456789abcdef0123456789abcdef01234567"
export const GENERATED_AT = "2026-10-20T12:00:00Z"

export function moduleHtml(id: string, options?: { executable?: boolean; extra?: string; manifestExtra?: object }): Buffer {
	const manifest = JSON.stringify(
		{
			id,
			title: `Module ${id}`,
			version: "0.1.0",
			license: "CC-BY-4.0",
			requires: { executable: options?.executable ?? false, python: [] },
			...options?.manifestExtra,
		},
		null,
		2,
	)
	return Buffer.from(
		`<!doctype html>\n<html><head>\n<script type="application/vnd.aihydro.module+json">\n${manifest}\n</script>\n</head>\n<body>${id}${options?.extra ?? ""}</body></html>\n`,
		"utf8",
	)
}

export function sourceCourse(): Record<string, unknown> {
	return {
		courseId: "intro-demo-2026",
		title: "Intro Demo",
		license: "CC-BY-4.0",
		version: "0.2.0",
		trustLevel: "official",
		kernel: "isolated",
		modules: [
			{
				id: "water-basics",
				path: "../m/water-basics.html",
				title: "Water Basics",
				downloadUrl: "https://example.invalid/x",
			},
			{
				id: "runoff-lab",
				path: "../m/runoff-lab.html",
				title: "Runoff Lab",
				prerequisites: ["water-basics"],
				estimatedMinutes: 30,
			},
		],
	}
}

export function makeSources(overrides?: {
	course?: unknown
	modules?: Map<string, Uint8Array>
	extra?: Map<string, Uint8Array>
}): SourceBundle {
	return {
		course: overrides?.course ?? sourceCourse(),
		modules:
			overrides?.modules ??
			new Map<string, Uint8Array>([
				["water-basics", moduleHtml("water-basics")],
				["runoff-lab", moduleHtml("runoff-lab", { executable: true })],
			]),
		extraFiles: overrides?.extra ?? new Map(),
	}
}

export function makeConfig(overrides?: Record<string, unknown>): PackConfig {
	return parsePackConfig(
		Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				packId: "aihydro.intro-demo",
				version: "0.2.0",
				edition: "student",
				publisher: { name: "Test Publisher" },
				aiHydroRange: ">=0.4.0 <0.5.0",
				idMap: { "intro-demo-2026": "aihydro.intro-demo.course" },
				idPrefix: "aihydro.intro-demo.",
				...overrides,
			}),
		),
	)
}

export function makeKeyPair(): { privateKey: KeyObject; publicDer: Buffer } {
	const { privateKey } = generateKeyPairSync("ed25519")
	return { privateKey, publicDer: publicKeySpkiDer(privateKey) }
}

export function buildInput(overrides?: Partial<BuildPackInput> & { publisherSpkiDer?: Uint8Array }): BuildPackInput {
	return {
		config: makeConfig(),
		sources: makeSources(),
		buildKind: "development",
		provenance: { sourceCommit: COMMIT, sourceDirty: false, generatedAt: GENERATED_AT },
		...overrides,
	}
}
