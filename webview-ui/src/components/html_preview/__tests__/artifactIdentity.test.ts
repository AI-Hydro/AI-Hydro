import { type HtmlPreviewItem, HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { describe, expect, it } from "vitest"
import type { AiHydroModuleManifest } from "@/context/HtmlPreviewContext"
import { deriveArtifactIdentity, isStaticDocument, profileFromBuildPath, shortSourceLabel } from "../artifactIdentity"

function makeItem(overrides: Partial<HtmlPreviewItem> = {}): HtmlPreviewItem {
	return {
		id: "file_x",
		title: "03-unit-hydrograph-convolution.html",
		htmlContent: "",
		filePath: "/repo/_build/aihydro/labs/03-unit-hydrograph-convolution.html",
		interactive: false,
		metadata: { source: "file" },
		webviewUri: "",
		dirUri: "",
		contentHash: "",
		resolvedMode: HtmlPreviewMode.INTERACTIVE,
		...overrides,
	}
}

const EXECUTABLE_MANIFEST: AiHydroModuleManifest = { requires: { executable: true, python: ["matplotlib"] } }

describe("profileFromBuildPath", () => {
	it("extracts the profile segment after _build/", () => {
		expect(profileFromBuildPath("/repo/_build/aihydro/labs/x.html")).to.equal("aihydro")
		expect(profileFromBuildPath("/repo/_build/web/index.html")).to.equal("web")
		expect(profileFromBuildPath("/repo/_build/student/labs/x.html")).to.equal("student")
	})

	it("handles Windows-style backslashes", () => {
		expect(profileFromBuildPath("C:\\repo\\_build\\instructor\\x.html")).to.equal("instructor")
	})

	it("returns null when there is no _build segment", () => {
		expect(profileFromBuildPath("/repo/reports/summary.html")).to.equal(null)
		expect(profileFromBuildPath("")).to.equal(null)
	})

	it("uses the last _build when the path contains more than one", () => {
		expect(profileFromBuildPath("/a/_build/web/_build/aihydro/x.html")).to.equal("aihydro")
	})
})

describe("shortSourceLabel", () => {
	it("returns the whole path when it has few segments", () => {
		expect(shortSourceLabel("labs/x.html")).to.equal("labs/x.html")
	})

	it("keeps the trailing 3 segments with an ellipsis prefix", () => {
		expect(shortSourceLabel("/repo/_build/aihydro/labs/x.html")).to.equal("…/aihydro/labs/x.html")
	})
})

describe("deriveArtifactIdentity", () => {
	it("distinguishes the same basename across build profiles", () => {
		const aihydro = deriveArtifactIdentity(makeItem(), EXECUTABLE_MANIFEST)
		const web = deriveArtifactIdentity(
			makeItem({ filePath: "/repo/_build/web/labs/03-unit-hydrograph-convolution.html" }),
			undefined,
		)
		expect(aihydro.profile).to.equal("aihydro")
		expect(web.profile).to.equal("web")
		expect(aihydro.sourceLabel).to.not.equal(web.sourceLabel)
	})

	it("marks an executable manifest as executable", () => {
		const id = deriveArtifactIdentity(makeItem(), EXECUTABLE_MANIFEST)
		expect(id.capability).to.equal("executable")
		expect(id.capabilityLabel).to.equal("Executable")
	})

	it("marks a manifest without executable cells as a module", () => {
		const id = deriveArtifactIdentity(makeItem(), { requires: { executable: false } })
		expect(id.capability).to.equal("module")
	})

	it("marks a plain document as static", () => {
		const id = deriveArtifactIdentity(makeItem({ filePath: "/repo/report.html" }), undefined)
		expect(id.capability).to.equal("static")
		expect(id.profile).to.equal(null)
	})

	it("treats HTML embedding a module manifest as a module even before it is parsed", () => {
		// No parsed manifest yet, but the inline HTML carries the marker — this
		// is the load-time window; must NOT flash as static.
		const item = makeItem({
			htmlContent: '<html><head><script type="application/vnd.aihydro.module+json">{"id":"m"}</script></head></html>',
		})
		const id = deriveArtifactIdentity(item, undefined)
		expect(id.capability).to.equal("module")
	})

	it("uses the pack edition as profile and marks capability as installed-pack", () => {
		const item = makeItem({
			metadata: { source: "file", artifactKind: "learning-pack-v1", learningPackEdition: "student" },
		})
		const id = deriveArtifactIdentity(item, EXECUTABLE_MANIFEST)
		expect(id.capability).to.equal("installed-pack")
		expect(id.profile).to.equal("student")
		expect(id.profileSource).to.equal("pack-edition")
	})

	it("prefers the pack edition over a build-dir profile when both are present", () => {
		const item = makeItem({
			filePath: "/repo/_build/aihydro/labs/x.html",
			metadata: { source: "file", artifactKind: "learning-pack-v1", learningPackEdition: "instructor" },
		})
		const id = deriveArtifactIdentity(item, undefined)
		expect(id.profile).to.equal("instructor")
		expect(id.profileSource).to.equal("pack-edition")
	})
})

describe("isStaticDocument", () => {
	it("is true for a plain doc with no manifest", () => {
		expect(isStaticDocument(makeItem({ filePath: "/repo/report.html" }), undefined)).to.equal(true)
	})

	it("is false for an executable module and for an installed pack", () => {
		expect(isStaticDocument(makeItem(), EXECUTABLE_MANIFEST)).to.equal(false)
		expect(
			isStaticDocument(
				makeItem({ metadata: { source: "file", artifactKind: "learning-pack-v1", learningPackEdition: "student" } }),
				undefined,
			),
		).to.equal(false)
	})

	it("is false for an undefined item", () => {
		expect(isStaticDocument(undefined, undefined)).to.equal(false)
	})
})
