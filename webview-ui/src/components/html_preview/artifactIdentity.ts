import { readArtifactTrust } from "@shared/artifactTrust"
import type { HtmlPreviewItem } from "@shared/proto/cline/html_preview"
import type { AiHydroModuleManifest } from "@/context/HtmlPreviewContext"
import { isInstalledLearningPack } from "./installedPackCsp"

/**
 * Derives a disambiguating identity for a loaded artifact so the sidebar can
 * distinguish otherwise-identical basenames.
 *
 * The motivating problem (redesign brief §8.1): a Quarto book renders the same
 * `03-unit-hydrograph-convolution.html` into `_build/web/`, `_build/aihydro/`,
 * `_build/student/`, `_build/instructor/`, and installed-pack outputs. The old
 * list showed only the basename, so several rows looked identical. This helper
 * surfaces (a) a short source-path label, (b) a profile/edition badge, and
 * (c) a capability badge — all derived from the item + its manifest, never from
 * the filename alone (brief §16).
 */

export type ArtifactCapability = "static" | "executable" | "module" | "installed-pack"

export interface ArtifactIdentity {
	/** Full source path (absolute or workspace-relative), for tooltip/title. */
	sourcePath: string
	/** Short, disambiguating tail of the source path (≤ 3 trailing segments). */
	sourceLabel: string
	/**
	 * Quarto profile (`aihydro`/`web`/`student`/`instructor`/…) parsed from a
	 * `_build/<profile>/` path segment, or a Learning Pack edition
	 * (`student`/`instructor`) from pack metadata. `null` when neither applies.
	 */
	profile: string | null
	/** Where `profile` came from — lets the UI label a pack edition distinctly. */
	profileSource: "build-dir" | "pack-edition" | null
	capability: ArtifactCapability
	/** Human-readable capability label for the badge. */
	capabilityLabel: string
}

const KNOWN_PROFILES = new Set(["aihydro", "web", "student", "instructor", "default", "pdf", "epub", "pack"])

export const MODULE_MANIFEST_MARKER = 'type="application/vnd.aihydro.module+json"'

/**
 * Whether the artifact's own HTML embeds an executable-module manifest script.
 * This is the authoritative "this is a module" signal and is available
 * immediately from `htmlContent`, before the manifest is parsed and pushed to
 * `manifestsById` — so capability derivation doesn't flash "Static" during the
 * brief window between load and manifest parse. Empty for large webviewUri-only
 * artifacts (no inline HTML), where we fall back to the parsed manifest.
 */
export function hasEmbeddedModuleManifest(item: HtmlPreviewItem): boolean {
	return item.htmlContent.includes(MODULE_MANIFEST_MARKER)
}

function normalizeSlashes(p: string): string {
	return p.replace(/\\/g, "/")
}

/** Parse the profile from a `.../_build/<profile>/...` path, if present. */
export function profileFromBuildPath(sourcePath: string): string | null {
	const parts = normalizeSlashes(sourcePath).split("/")
	const buildIdx = parts.lastIndexOf("_build")
	if (buildIdx < 0 || buildIdx + 1 >= parts.length) {
		return null
	}
	const candidate = parts[buildIdx + 1]
	return KNOWN_PROFILES.has(candidate) ? candidate : candidate || null
}

/** The last `count` non-empty path segments, joined with "/". */
export function shortSourceLabel(sourcePath: string, count = 3): string {
	const segments = normalizeSlashes(sourcePath)
		.split("/")
		.filter((s) => s.length > 0)
	if (segments.length <= count) {
		return segments.join("/")
	}
	return `…/${segments.slice(-count).join("/")}`
}

function deriveCapability(
	item: HtmlPreviewItem,
	manifest: AiHydroModuleManifest | undefined,
): { capability: ArtifactCapability; capabilityLabel: string } {
	// Capability is what the host will actually enforce, never what the document
	// claims. A manifest or pack-looking metadata on an untrusted document grants
	// nothing: it is static (or an unsigned marketplace module).
	const trust = readArtifactTrust(item.metadata)
	if (!trust.trusted) {
		return trust.source === "unsigned-module"
			? { capability: "static", capabilityLabel: "Unsigned" }
			: { capability: "static", capabilityLabel: "Static" }
	}
	if (isInstalledLearningPack(item)) {
		return { capability: "installed-pack", capabilityLabel: "Learning Pack" }
	}
	if (manifest?.requires?.executable === true) {
		return { capability: "executable", capabilityLabel: "Executable" }
	}
	if (manifest) {
		// A module manifest is present but doesn't declare executable cells.
		return { capability: "module", capabilityLabel: "Module" }
	}
	if (hasEmbeddedModuleManifest(item)) {
		// The HTML embeds a module manifest that hasn't been parsed into
		// `manifestsById` yet — it's a module, not a static doc. Avoids a
		// "Static" flash (and a flash of the static-document notice) on load.
		return { capability: "module", capabilityLabel: "Module" }
	}
	return { capability: "static", capabilityLabel: "Static" }
}

export function deriveArtifactIdentity(item: HtmlPreviewItem, manifest: AiHydroModuleManifest | undefined): ArtifactIdentity {
	const sourcePath = item.filePath || ""
	const buildProfile = profileFromBuildPath(sourcePath)
	const packEdition = isInstalledLearningPack(item) ? item.metadata?.learningPackEdition : undefined

	let profile: string | null = null
	let profileSource: ArtifactIdentity["profileSource"] = null
	if (packEdition === "student" || packEdition === "instructor") {
		profile = packEdition
		profileSource = "pack-edition"
	} else if (buildProfile) {
		profile = buildProfile
		profileSource = "build-dir"
	}

	const { capability, capabilityLabel } = deriveCapability(item, manifest)

	return {
		sourcePath,
		sourceLabel: shortSourceLabel(sourcePath),
		profile,
		profileSource,
		capability,
		capabilityLabel,
	}
}

/**
 * Whether the document is static: its source is not trusted, so the host gives
 * it no Python kernel and no agent access (see `@shared/artifactTrust`).
 */
export function isStaticDocument(item: HtmlPreviewItem | undefined, manifest: AiHydroModuleManifest | undefined): boolean {
	if (!item) {
		return false
	}
	return deriveArtifactIdentity(item, manifest).capability === "static"
}
