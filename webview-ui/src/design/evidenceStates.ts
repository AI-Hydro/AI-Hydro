/**
 * One semantic table for evidence, uncertainty and approval states, shared by
 * every science surface (chat chips, Evidence Board, Experiment Table, Replay,
 * map provenance, Studio).
 *
 * Rules, enforced by __tests__/evidenceStates.test.ts:
 *  - Only `approved` may use the passed/green token. Everything else, including
 *    "supported", is non-green.
 *  - Every state has a text label AND an icon (distinct per state) AND a border
 *    shape. Colour is never the only carrier of meaning (WCAG 1.4.1).
 *  - `observed` and `modelled` differ in line style (solid vs dashed) and in badge
 *    shape, not just hue, so the distinction survives greyscale and high-contrast themes.
 *  - Each state's (shape, lineStyle) pair is unique.
 *  - Tokens come from a per-state ALLOWLIST (below); a state can only use a theme
 *    variable named for it there, so no other state can reach a success/green token.
 *
 * This module is pure data: no React, no webview imports.
 */

export type EvidenceStateId =
	| "approved"
	| "integrity-only"
	| "verified"
	| "unverified"
	| "refused"
	| "stale"
	| "provisional"
	| "observed"
	| "modelled"
	| "derived"
	| "agent-asserted"

/** Border treatment of a badge; distinct treatments help when colours collapse. */
export type EvidenceShape = "filled" | "outline" | "dashed" | "dotted" | "double"
/** Stroke style used when the state labels a plotted series or map line. */
export type EvidenceLineStyle = "solid" | "dashed" | "dotted" | "dash-dot"

export interface EvidenceStateDef {
	id: EvidenceStateId
	/** Short visible label. Always rendered as text next to the icon. */
	label: string
	/** CSS colour expression (a VS Code theme variable with a fallback). */
	token: string
	/** Codicon class, e.g. `codicon-pass-filled`. Unique per state. */
	icon: string
	shape: EvidenceShape
	lineStyle: EvidenceLineStyle
	/** One-sentence meaning shown as a tooltip / accessible description. */
	description: string
}

/** The single green token. Referenced by `approved` only. */
export const APPROVED_TOKEN = "var(--vscode-testing-iconPassed, #388a34)"

export const EVIDENCE_STATES: Record<EvidenceStateId, EvidenceStateDef> = {
	approved: {
		id: "approved",
		label: "Approved",
		token: APPROVED_TOKEN,
		icon: "codicon-pass-filled",
		shape: "filled",
		lineStyle: "solid",
		description: "Approved through a signed system or supplied trust root outside the agent.",
	},
	"integrity-only": {
		id: "integrity-only",
		label: "Integrity only",
		token: "var(--vscode-editorWarning-foreground, #bf8803)",
		icon: "codicon-shield",
		shape: "double",
		lineStyle: "solid",
		description: "Recorded without a trusted signer: the record is intact but not human-verified.",
	},
	verified: {
		id: "verified",
		label: "Verified by package",
		token: "var(--vscode-textLink-foreground, #3794ff)",
		icon: "codicon-check",
		shape: "outline",
		lineStyle: "dotted",
		description: "Computed or re-checked by the AI-Hydro package from recorded data.",
	},
	unverified: {
		id: "unverified",
		label: "Not checked",
		token: "var(--vscode-descriptionForeground, #9d9d9d)",
		icon: "codicon-question",
		shape: "dotted",
		lineStyle: "solid",
		description: "No check was recorded. This does not mean the value is wrong.",
	},
	refused: {
		id: "refused",
		label: "Refused",
		token: "var(--vscode-errorForeground, #f85149)",
		icon: "codicon-stop-circle",
		shape: "filled",
		lineStyle: "dashed",
		description: "The tool stopped instead of guessing; see the recovery options.",
	},
	stale: {
		id: "stale",
		label: "Stale",
		token: "var(--vscode-editorWarning-foreground, #bf8803)",
		icon: "codicon-history",
		shape: "dashed",
		lineStyle: "solid",
		description: "Cited evidence or the claim itself changed after this was recorded.",
	},
	provisional: {
		id: "provisional",
		label: "Provisional",
		token: "var(--vscode-editorWarning-foreground, #bf8803)",
		icon: "codicon-clock",
		shape: "dashed",
		lineStyle: "dash-dot",
		description: "Provisional data that the source may still revise.",
	},
	observed: {
		id: "observed",
		label: "Observed",
		token: "var(--vscode-charts-blue, #3794ff)",
		icon: "codicon-eye",
		shape: "outline",
		lineStyle: "solid",
		description: "Measured at a gauge or sensor.",
	},
	modelled: {
		id: "modelled",
		label: "Modelled",
		token: "var(--vscode-charts-purple, #b180d7)",
		icon: "codicon-graph-scatter",
		shape: "dashed",
		lineStyle: "dashed",
		description: "Produced by a model or reanalysis, not measured.",
	},
	derived: {
		id: "derived",
		label: "Derived",
		token: "var(--vscode-descriptionForeground, #9d9d9d)",
		icon: "codicon-git-merge",
		shape: "dotted",
		lineStyle: "dotted",
		description: "Computed from other recorded values.",
	},
	"agent-asserted": {
		id: "agent-asserted",
		label: "Agent-asserted",
		token: "var(--vscode-descriptionForeground, #9d9d9d)",
		icon: "codicon-hubot",
		shape: "dotted",
		lineStyle: "dash-dot",
		description: "Stated by the agent. Nothing in the package verified it.",
	},
}

/**
 * Per-state allowlist of theme variables. Only `approved` may use a success colour; everything else is limited to
 * neutral, link, warning, error or chart-blue/purple variables. Adding a variable here is a deliberate review point.
 */
export const TOKEN_ALLOWLIST: Record<EvidenceStateId, readonly string[]> = {
	approved: ["--vscode-testing-iconPassed"],
	"integrity-only": ["--vscode-editorWarning-foreground"],
	verified: ["--vscode-textLink-foreground"],
	unverified: ["--vscode-descriptionForeground"],
	refused: ["--vscode-errorForeground"],
	stale: ["--vscode-editorWarning-foreground"],
	provisional: ["--vscode-editorWarning-foreground"],
	observed: ["--vscode-charts-blue"],
	modelled: ["--vscode-charts-purple"],
	derived: ["--vscode-descriptionForeground"],
	"agent-asserted": ["--vscode-descriptionForeground"],
}

/** The CSS custom property named in a `var(--x, fallback)` token. */
export function tokenVariable(token: string): string | undefined {
	return /^var\((--[A-Za-z0-9-]+)/.exec(token)?.[1]
}

export const EVIDENCE_STATE_IDS = Object.keys(EVIDENCE_STATES) as EvidenceStateId[]

export function evidenceState(id: EvidenceStateId): EvidenceStateDef {
	return EVIDENCE_STATES[id]
}

/** Stroke dash arrays for plotted series (SVG `stroke-dasharray`). */
export const LINE_DASH: Record<EvidenceLineStyle, string> = {
	solid: "none",
	dashed: "6 4",
	dotted: "1.5 3",
	"dash-dot": "6 3 1.5 3",
}

/** Map an information class reported by a server to a state; unknown classes yield undefined (never inferred). */
export function stateForInformationClass(value: string | undefined | null): EvidenceStateId | undefined {
	switch ((value ?? "").trim().toLowerCase()) {
		case "observed":
			return "observed"
		case "modelled":
		case "modeled":
		case "reanalysis":
		case "projection":
			return "modelled"
		case "derived":
			return "derived"
		default:
			return undefined
	}
}
