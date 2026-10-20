/** Synthetic Studio / HTML-preview items. Content is invented placeholder text. */
import { HtmlPreviewMode, type HtmlPreviewItem } from "@shared/proto/cline/html_preview"

const page = (title: string, body: string) =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font:14px system-ui;margin:24px;line-height:1.5;color:#222;background:#fff}h1{font-size:1.4em}</style></head><body>${body}</body></html>`

export const item = (id: string, title: string, htmlContent: string, metadata: Record<string, string> = {}): HtmlPreviewItem => ({
	id,
	title,
	htmlContent,
	filePath: `/fixture/${id}.html`,
	interactive: false,
	metadata,
	webviewUri: "",
	dirUri: "",
	contentHash: "0".repeat(16),
	resolvedMode: HtmlPreviewMode.SAFE,
})

export const staticDoc = item(
	"fx-static",
	"Synthetic static document",
	page(
		"Static",
		"<h1>Static report (synthetic)</h1><p>Layout fixture. Contains no analysis.</p><figure><img alt='' width='1' height='1'><figcaption>Figure placeholder</figcaption></figure>",
	),
)

export const executableModule = {
	...item(
		"fx-module",
		"Synthetic executable module",
		page(
			"Module",
			`<script type="application/vnd.aihydro.module+json">{"id":"fx.module","title":"Synthetic module","level":"intro","estimated_minutes":10,"requires":{"executable":true}}</script><h1>Executable module (synthetic)</h1><p>Cells would run here.</p>`,
		),
		{ artifactKind: "module" },
	),
	interactive: true,
	resolvedMode: HtmlPreviewMode.INTERACTIVE,
}

export const courseModule = {
	...item(
		"fx-course-m2",
		"Module 2: Synthetic signatures",
		page("M2", "<h1>Module 2 (synthetic)</h1><p>Course module body placeholder.</p>"),
	),
	filePath: "/fixture/course/02-signatures/module.html",
	interactive: true,
	resolvedMode: HtmlPreviewMode.INTERACTIVE,
}

export const courseManifest = {
	courseId: "fx-course",
	title: "Synthetic Hydrology Course",
	version: "0.0.0-fixture",
	abstract: "Invented course used only to review layout.",
	estimatedHours: 3,
	modules: [
		{ id: "m1", path: "01-intro/module.html", title: "Module 1: Synthetic introduction", estimatedMinutes: 20 },
		{
			id: "m2",
			path: "02-signatures/module.html",
			title: "Module 2: Synthetic signatures",
			estimatedMinutes: 40,
			prerequisites: ["m1"],
		},
		{
			id: "m3",
			path: "03-models/module.html",
			title: "Module 3: Synthetic models",
			estimatedMinutes: 60,
			prerequisites: ["m2"],
		},
	],
}

export const courseProgress = {
	courseId: "fx-course",
	startedAt: 1_700_000_000_000,
	lastVisitedAt: 1_700_000_100_000,
	currentModuleId: "m2",
	completed: { m1: { completedAt: 1_700_000_050_000, timeSpentMs: 1_200_000 } },
}

/** FIXTURE catalogue entries (synthetic): one with no declared licence, one with a declared licence. */
export const catalogueModules: Record<string, unknown>[] = [
	{
		moduleId: "fixture-hydrograph",
		title: "Fixture: reading a hydrograph",
		description: "Synthetic catalogue entry with no declared licence.",
		version: "0.1.0",
		author: "Fixture Author",
		license: "",
		level: "intro",
		estimatedMinutes: 20,
		tags: [],
		topic: "fixture",
		aiHydroInstalls: 0,
		aiHydroStars: 0,
		downloadUrl: "https://raw.githubusercontent.com/AI-Hydro/Modules/main/fixture/module.html",
	},
	{
		moduleId: "fixture-baseflow",
		title: "Fixture: baseflow separation",
		description: "Synthetic catalogue entry with a declared licence.",
		version: "0.2.0",
		author: "Fixture Author",
		license: "MIT",
		level: "intermediate",
		estimatedMinutes: 30,
		tags: [],
		topic: "fixture",
		aiHydroInstalls: 0,
		aiHydroStars: 0,
		downloadUrl: "https://raw.githubusercontent.com/AI-Hydro/Modules/main/fixture2/module.html",
	},
]
