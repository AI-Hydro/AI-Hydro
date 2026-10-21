/**
 * Pure, string-only protected-path test for the webview (Wave 2, W2-A2).
 *
 * The authoritative check is `isProtectedPath` in src/core/task/protectedPaths.ts: it needs `fs`/`os`/`path` and
 * resolves symlinks, so it cannot run in the webview. The host computes the protected ROOTS (getHostProtectedRoots)
 * and sends them in the extension state; this helper only decides, from the path text alone, whether a displayed
 * call touched one. It exists to NARROW what the transcript presenter lifts, never to authorise anything: a
 * mismatch with the host check can only over-lift (it fails safe), never hide a protected write.
 *
 *  - separators are normalised and `.`/`..` segments resolved lexically; the comparison is case-insensitive;
 *  - a relative path that climbs out (`..`) or starts with `~` cannot be resolved here, so it counts as protected;
 *  - other relative paths are workspace-relative and are not under an absolute root;
 *  - symlinks are not followed (the host check does that when the call is approved).
 */
const GIT_EXEC_PATH = /(^|\/)\.git\/(config|hooks)(\/|$)/i

function normalise(p: string): { text: string; absolute: boolean; escapes: boolean } {
	const slashed = p.replace(/\\/g, "/")
	const drive = /^[A-Za-z]:/.exec(slashed)?.[0] ?? ""
	const rest = slashed.slice(drive.length)
	const absolute = drive !== "" || rest.startsWith("/")
	const out: string[] = []
	let escapes = false
	for (const seg of rest.split("/")) {
		if (seg === "" || seg === ".") {
			continue
		}
		if (seg === "..") {
			if (out.length) {
				out.pop()
			} else {
				escapes = true
			}
			continue
		}
		out.push(seg)
	}
	return { text: `${drive}${absolute ? "/" : ""}${out.join("/")}`.toLowerCase(), absolute, escapes }
}

export function isUnderProtectedRoots(path: string, roots: readonly string[]): boolean {
	if (GIT_EXEC_PATH.test(path.replace(/\\/g, "/"))) {
		return true
	}
	if (path.startsWith("~")) {
		return true
	}
	const target = normalise(path)
	if (!target.absolute) {
		return target.escapes
	}
	for (const root of roots) {
		const r = normalise(root)
		if (target.text === r.text || target.text.startsWith(r.text.endsWith("/") ? r.text : `${r.text}/`)) {
			return true
		}
	}
	return false
}
