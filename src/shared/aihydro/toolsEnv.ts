/**
 * Host-neutral model of the managed AI-Hydro tools environment (X0-3): the requirement the extension installs,
 * the status it reports, and the pure helpers the host (installer, status bar) and the webview (status chip,
 * About diagnostics) share, so the two cannot drift. No `vscode` and no Node-only imports, so the webview bundle can load it.
 */
export const TOOLS_PACKAGE = "aihydro-tools"
export const TOOLS_EXTRAS = ["data", "analysis", "mcp", "viz", "gee", "delineation"] as const
/** Compatible-release pin: the 2.8.x line, never below 2.8.2. */
export const TOOLS_VERSION_SPEC = "~=2.8.2"
export const TOOLS_REQUIREMENT = `${TOOLS_PACKAGE}[${TOOLS_EXTRAS.join(",")}]${TOOLS_VERSION_SPEC}`
/** Directory (under `<aihydro_home>/venvs/`) of the managed environment for the pinned line. */
export const MANAGED_VENV_NAME = "tools-2.8"
export const MIN_PYTHON: readonly [number, number] = [3, 10]

export type ToolsEnvPhase =
	/** Probing the environment (import + MCP handshake). */
	| "checking"
	/** Installed, importable, answers the MCP handshake. */
	| "ready"
	/** pip or venv creation is running. */
	| "installing"
	/** No managed environment yet and nothing is running. */
	| "missing"
	/** The environment exists but failed the health check. */
	| "unhealthy"
	/** The last install attempt failed or was cancelled; retryable. */
	| "failed"
	/** A first-party launcher the user chose to keep (or a non-standard one) is registered instead of the managed one. */
	| "custom"

export type ToolsTrustVerdict = "trusted" | "untrusted" | "unregistered"

export type ToolsEnvAction = "install" | "repair" | "retry" | "cancel" | "showLog" | "trust" | "copyDiagnostics" | "useManaged"

export interface ToolsEnvStatus {
	phase: ToolsEnvPhase
	/** Importable and answering the MCP handshake (true only when probed so). */
	healthy: boolean
	/** Installed aihydro-tools version, "" when unknown. */
	version: string
	trust: ToolsTrustVerdict
	/** Why the trust verdict is what it is (the wording `explainServerTrust` gives). */
	trustReason: string
	/** Current progress step while installing, otherwise a one-line detail (the error when failed). */
	message: string
	/** Stable machine code for the last failure ("" when none): NO_PYTHON, VENV_FAILED, PIP_FAILED, OFFLINE, CANCELLED, UNHEALTHY, SETTINGS_UNREADABLE. */
	errorCode: string
	venvPath: string
	/** Python inside the managed venv ("" until it exists). */
	interpreterPath: string
	/** The interpreter used to create the venv ("" when the venv already existed). */
	basePython: string
	serverName: string
	serverCommand: string
	requirement: string
}

export function emptyToolsEnvStatus(overrides: Partial<ToolsEnvStatus> = {}): ToolsEnvStatus {
	return {
		phase: "checking",
		healthy: false,
		version: "",
		trust: "unregistered",
		trustReason: "",
		message: "",
		errorCode: "",
		venvPath: "",
		interpreterPath: "",
		basePython: "",
		serverName: "",
		serverCommand: "",
		requirement: TOOLS_REQUIREMENT,
		...overrides,
	}
}

// ── Versions ────────────────────────────────────────────────────────────────

export function parseVersion(text: string): number[] | undefined {
	const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text)
	if (!m) {
		return undefined
	}
	return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}

export function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < 3; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0)
		if (d !== 0) {
			return d
		}
	}
	return 0
}

/**
 * Whether `version` is at or above the pinned floor of the compatible-release line. Higher minors count as
 * satisfied: a hand-upgraded environment is adopted, never downgraded.
 */
export function versionMeetsFloor(version: string, floor: string = TOOLS_VERSION_SPEC.replace(/^~=/, "")): boolean {
	const v = parseVersion(version)
	const f = parseVersion(floor)
	return !!v && !!f && compareVersions(v, f) >= 0
}

export function pythonMeetsMinimum(version: string): boolean {
	const v = parseVersion(version)
	return !!v && (v[0] > MIN_PYTHON[0] || (v[0] === MIN_PYTHON[0] && v[1] >= MIN_PYTHON[1]))
}

// ── Paths ───────────────────────────────────────────────────────────────────

function joinUnder(dir: string, platform: NodeJS.Platform, ...segments: string[]): string {
	const sep = platform === "win32" ? "\\" : "/"
	return [dir.replace(/[\\/]+$/, ""), ...segments].join(sep)
}

export function venvPythonPath(venvDir: string, platform: NodeJS.Platform = process.platform): string {
	return platform === "win32"
		? joinUnder(venvDir, platform, "Scripts", "python.exe")
		: joinUnder(venvDir, platform, "bin", "python")
}

export function venvMcpPath(venvDir: string, platform: NodeJS.Platform = process.platform): string {
	return platform === "win32"
		? joinUnder(venvDir, platform, "Scripts", "aihydro-mcp.exe")
		: joinUnder(venvDir, platform, "bin", "aihydro-mcp")
}

// ── Presentation (shared by the webview chip and the status bar) ─────────────

export type ToolsChipTone = "ok" | "busy" | "warn" | "error"

export interface ToolsChipModel {
	tone: ToolsChipTone
	/** Compact label, e.g. "Tools 2.8.2 · healthy · trusted". */
	label: string
	/** Longer line for the tooltip / second row. */
	detail: string
	actions: ToolsEnvAction[]
}

export function describeToolsStatus(s: ToolsEnvStatus): ToolsChipModel {
	const v = s.version ? ` ${s.version}` : ""
	const trust = s.trust === "trusted" ? "trusted" : s.trust === "untrusted" ? "not trusted" : "not registered"
	switch (s.phase) {
		case "checking":
			return {
				tone: "busy",
				label: "Tools · checking",
				detail: s.message || "Checking the AI-Hydro tools environment",
				actions: [],
			}
		case "installing":
			return {
				tone: "busy",
				label: "Tools · installing",
				detail: s.message || "Installing AI-Hydro tools",
				actions: ["cancel", "showLog"],
			}
		case "ready":
			if (s.trust !== "trusted") {
				return {
					tone: "warn",
					label: `Tools${v} · healthy · ${trust}`,
					detail: s.trustReason || "The registered launcher is not the one AI-Hydro recorded.",
					actions: s.trust === "untrusted" ? ["trust", "showLog"] : ["repair", "showLog"],
				}
			}
			return { tone: "ok", label: `Tools${v} · healthy · trusted`, detail: s.trustReason, actions: ["showLog"] }
		case "unhealthy":
			return {
				tone: "error",
				label: `Tools${v} · unhealthy · ${trust}`,
				detail: s.message || "The tools environment failed its health check.",
				actions: ["repair", "showLog"],
			}
		case "failed":
			return {
				tone: "error",
				label: "Tools · install failed",
				detail: s.message || "The tools install did not finish.",
				actions: ["retry", "showLog"],
			}
		case "custom":
			return {
				tone: s.trust === "trusted" ? "ok" : "warn",
				label: `Tools · custom launcher · ${trust}`,
				detail: "A launcher outside the managed environment is registered.",
				actions: s.trust === "untrusted" ? ["trust", "useManaged"] : ["useManaged"],
			}
		default:
			return {
				tone: "error",
				label: "Tools · not installed",
				detail: s.message || "AI-Hydro tools are not installed.",
				actions: ["install", "showLog"],
			}
	}
}

export const TOOLS_ACTION_LABEL: Record<ToolsEnvAction, string> = {
	install: "Install",
	repair: "Repair",
	retry: "Retry",
	cancel: "Cancel",
	showLog: "Show log",
	trust: "Trust this launcher…",
	copyDiagnostics: "Copy diagnostics",
	useManaged: "Use managed environment",
}

/** Plain-text diagnostics block (About, Copy diagnostics). Never includes secrets: only paths, versions, verdicts. */
export function formatToolsDiagnostics(s: ToolsEnvStatus, extensionVersion?: string): string {
	const rows: [string, string][] = [
		["Extension build", extensionVersion ?? ""],
		["Tools version", s.version || "not installed"],
		["Status", `${s.phase}${s.healthy ? " (healthy)" : ""}`],
		["Requirement", s.requirement],
		["Interpreter", s.interpreterPath || s.basePython || "none found"],
		["Venv path", s.venvPath],
		["Server name", s.serverName || "not registered"],
		["Server command", s.serverCommand || "not registered"],
		["Trust", `${s.trust}${s.trustReason ? ` (${s.trustReason})` : ""}`],
	]
	if (s.message && (s.phase === "failed" || s.phase === "unhealthy")) {
		rows.push(["Last error", `${s.errorCode ? `${s.errorCode}: ` : ""}${s.message}`])
	}
	return rows
		.filter(([, v]) => v !== "")
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n")
}
