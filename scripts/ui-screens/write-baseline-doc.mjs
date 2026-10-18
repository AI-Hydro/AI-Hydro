#!/usr/bin/env node
/**
 * Renders docs/ui/screens-before-<label>.md from a harness run's summary.json.
 *   node scripts/ui-screens/write-baseline-doc.mjs <summary.json> <out.md> [label]
 * Numbers are copied from the run; nothing is computed beyond sums and sorting.
 */
import { readFileSync, writeFileSync } from "node:fs"

const [summaryPath, outPath, label = "baseline"] = process.argv.slice(2)
if (!summaryPath || !outPath) {
	console.error("usage: write-baseline-doc.mjs <summary.json> <out.md> [label]")
	process.exit(2)
}
const s = JSON.parse(readFileSync(summaryPath, "utf8"))
const RULES = ["noName", "smallTarget", "smallText", "contrast"]
const rows = Object.entries(s.perScreen).map(([id, v]) => ({
	id,
	ref: v.ref ?? {},
	total: v.matrixTotal,
	meta: s.results.find((r) => r.screen === id),
}))
const sum = (r) => RULES.reduce((n, k) => n + (r[k] ?? 0), 0)
rows.sort((a, b) => sum(b.ref) - sum(a.ref) || a.id.localeCompare(b.id))
const cell = (r) => RULES.map((k) => r[k] ?? 0).join(" | ")
const out = []
out.push(`# UI screens: ${label} checker baseline`)
out.push("")
out.push(
	"All screens are FIXTURE renders (synthetic, or recorded server output replayed offline; each banner says which) from `webview-ui/src/screens/registry.tsx` (harness: `docs/ui/README.md`). Nothing here is a research result. Theme tokens are approximate hand-authored sets, so contrast counts are indicative.",
)
out.push("")
out.push(
	`- Screens: ${s.screens}; cells rendered: ${s.cells} (themes ${s.matrix.themes.join(", ")}; widths ${s.matrix.widths.join(", ")}; font px ${s.matrix.fonts.join(", ")}; motion ${s.matrix.motion.join(", ")}).`,
)
out.push(
	`- Uncaught page errors: ${s.errors}. Unrouted external requests: ${s.unroutedRequests}. External hosts the app tried to reach (all answered from fixtures): ${
		Object.entries(s.externalRoutedRequests)
			.map(([h, n]) => `${h} (${n})`)
			.join(", ") || "none"
	}.`,
)
out.push(`- axe-core: ${s.axe}.`)
out.push(
	"- Budget file: `webview-ui/screens-baseline/checker-budget.json`. Counts may shrink, never grow (enforced by `--check`).",
)
out.push(
	"- Reference cell: dark theme, 13 px, native width (sidebar 400, panel 800, editor 1280). Matrix total = sum over every cell of that screen.",
)
out.push(
	"- Rules: noName = button/link without accessible name; smallTarget = interactive target under 24x24 px; smallText = text under 11 px; contrast = WCAG ratio below 4.5 (3 for large text). Text over canvas/gradients is counted separately as indeterminate and excluded here.",
)
out.push("")
out.push("## Totals")
out.push("")
out.push("| Scope | noName | smallTarget | smallText | contrast |")
out.push("|---|---|---|---|---|")
out.push(`| Reference cells | ${cell(s.checker.referenceCellTotals)} |`)
out.push(`| Whole matrix | ${cell(s.checker.matrixTotals)} |`)
out.push("")
out.push("## Per screen (reference cell, then matrix total)")
out.push("")
out.push("| Screen | Group | noName | smallTarget | smallText | contrast | matrix: noName | smallTarget | smallText | contrast |")
out.push("|---|---|---|---|---|---|---|---|---|---|")
for (const r of [...rows].sort((a, b) => a.id.localeCompare(b.id)))
	out.push(`| \`${r.id}\` | ${r.meta?.group ?? ""} | ${cell(r.ref)} | ${cell(r.total)} |`)
out.push("")
out.push("## Ten worst screens by reference-cell violations")
out.push("")
rows.slice(0, 10).forEach((r, i) =>
	out.push(`${i + 1}. \`${r.id}\`: ${sum(r.ref)} (${RULES.map((k) => `${k} ${r.ref[k] ?? 0}`).join(", ")})`),
)
out.push("")
writeFileSync(outPath, out.join("\n"))
