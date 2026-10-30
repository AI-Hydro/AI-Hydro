import { describeToolsStatus, type ToolsEnvStatus } from "@shared/aihydro/toolsEnv"

/**
 * The status bar item for the managed tools environment. Free of the `vscode` runtime so it is unit-testable.
 * The text names the product ("AI-Hydro") because the item sits beside other extensions' items; the version is the
 * tools package's, so the text says "tools". The icon carries the state.
 */
export function statusBarText(s: ToolsEnvStatus): { text: string; tooltip: string; warn: boolean } {
	const model = describeToolsStatus(s)
	const icon =
		model.tone === "busy"
			? "$(sync~spin)"
			: model.tone === "ok"
				? "$(check)"
				: model.tone === "warn"
					? "$(warning)"
					: "$(error)"
	const v = s.version ? ` ${s.version}` : ""
	const short =
		s.phase === "ready" && s.trust === "trusted"
			? `AI-Hydro tools${v}`
			: s.phase === "ready"
				? `AI-Hydro tools${v} untrusted`
				: s.phase === "installing"
					? "AI-Hydro tools installing"
					: s.phase === "checking"
						? "AI-Hydro tools checking"
						: s.phase === "failed"
							? "AI-Hydro tools failed"
							: s.phase === "unhealthy"
								? "AI-Hydro tools unhealthy"
								: s.phase === "custom"
									? "AI-Hydro tools custom"
									: "AI-Hydro tools missing"
	return {
		text: `${icon} ${short}`,
		tooltip: `${model.label}\n${model.detail}`.trim(),
		warn: model.tone === "warn" || model.tone === "error",
	}
}
