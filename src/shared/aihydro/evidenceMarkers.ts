/**
 * The one definition of an AI-Hydro evidence marker: `[run:<id>#<path>]`, `[claim:<id>]`, `[lit:<tag>]`.
 * Every id/tag/path must start alphanumeric, so grammar placeholders such as `[lit:...]` or `[lit:<tag>]` are never
 * mistaken for a real reference. The markdown renderer (inline chips) and the answer card's evidence strip both use
 * this module, so the two can never disagree about what counts as a citation.
 */
export const AIHYDRO_MARKER_SOURCE =
	"\\[(?:run:([A-Za-z0-9][A-Za-z0-9._-]*)#([A-Za-z0-9][A-Za-z0-9._-]*)|claim:([A-Za-z0-9][A-Za-z0-9._-]*)|lit:([A-Za-z0-9][A-Za-z0-9._-]*))\\]"

export type EvidenceMarker =
	| { type: "run"; runId: string; jsonPath: string }
	| { type: "claim"; claimId: string }
	| { type: "lit"; tag: string }

/** The marker a regex match (of AIHYDRO_MARKER_SOURCE) stands for, or undefined when it carries no usable reference. */
export function markerFromMatch(match: RegExpExecArray | RegExpMatchArray): EvidenceMarker | undefined {
	if (match[1] && match[2]) {
		return { type: "run", runId: match[1], jsonPath: match[2] }
	}
	if (match[3]) {
		return { type: "claim", claimId: match[3] }
	}
	if (match[4]) {
		return { type: "lit", tag: match[4] }
	}
	return undefined
}

/** Chip hProperties for a marker (the shape the markdown pipeline hands to the chip components). */
export function markerChipProperties(marker: EvidenceMarker): Record<string, string> {
	switch (marker.type) {
		case "run":
			return { "data-chip-type": "run", "data-run-id": marker.runId, "data-json-path": marker.jsonPath }
		case "claim":
			return { "data-chip-type": "claim", "data-claim-id": marker.claimId }
		case "lit":
			return { "data-chip-type": "lit", "data-lit-tag": marker.tag }
	}
}

export interface EvidenceStrip {
	runs: Array<{ runId: string; jsonPath: string }>
	claims: string[]
	lits: string[]
}

const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[^\S\n]*(?=\n|$)|$)/gm
const INLINE_CODE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g

/**
 * The prose the markdown renderer would chip: fenced code blocks are dropped, and so are inline code spans, except a
 * span whose ENTIRE value is one marker (models often backtick their citations; the renderer chips those, #68).
 * A marker inside longer code is a grammar example or fix hint, never a citation. Indented code blocks are not
 * detected (list continuation is indistinguishable from them without a parser).
 */
export function proseForEvidence(text: string): string {
	const whole = new RegExp(`^${AIHYDRO_MARKER_SOURCE}$`)
	return text.replace(FENCED_CODE, "").replace(INLINE_CODE, (_m, _ticks, inner: string) => {
		const value = /^ .* $/s.test(inner) && inner.trim() !== "" ? inner.slice(1, -1) : inner
		return whole.test(value) ? value : ""
	})
}

/**
 * Distinct markers in `text`, in first-seen order. Pure. Scans the same prose the markdown plugin chips (see
 * `proseForEvidence`), so the evidence row and the inline chips agree on what counts as a citation.
 */
export function extractEvidence(text: string | undefined): EvidenceStrip {
	const out: EvidenceStrip = { runs: [], claims: [], lits: [] }
	if (!text) {
		return out
	}
	const re = new RegExp(AIHYDRO_MARKER_SOURCE, "g")
	const seen = new Set<string>()
	let m: RegExpExecArray | null
	const prose = proseForEvidence(text)
	while ((m = re.exec(prose)) !== null) {
		const marker = markerFromMatch(m)
		if (!marker || seen.has(m[0])) {
			continue
		}
		seen.add(m[0])
		if (marker.type === "run") {
			out.runs.push({ runId: marker.runId, jsonPath: marker.jsonPath })
		} else if (marker.type === "claim") {
			out.claims.push(marker.claimId)
		} else {
			out.lits.push(marker.tag)
		}
	}
	return out
}
