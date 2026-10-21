/**
 * Best-effort, string-only protected-path test for DISPLAY in the webview (Wave 2, W2-A2). It is NOT an authority.
 *
 * The authority is the host: when a tool row names a path, the host runs the real `isProtectedPath`
 * (src/core/task/protectedPaths.ts: filesystem, symlinks, every workspace base) and stamps the row
 * `policyClass: "protected_path"` (src/core/task/protectedStamp.ts). The presenter lifts on that stamp. This matcher
 * only ADDS lifts for rows the host has not stamped (old tasks, a stamping failure) and can only over-lift:
 *
 *  - separators are normalised and `.`/`..` resolved lexically; the comparison is case-insensitive; a Windows
 *    `\\?\` prefix and the macOS `/private` alias are stripped on both sides;
 *  - a relative path that climbs out (`..`) or starts with `~` counts as protected;
 *  - a relative path whose leading segments equal the trailing segments of a root (`.ssh/id`, `./.ssh/id`,
 *    `.aihydro/approvals/x`) counts as protected, because the workspace may sit directly under that root's parent;
 *  - other relative paths are workspace-relative and are not under an absolute root here;
 *  - symlinks are NOT followed: a link from the workspace into a protected root is only caught by the host stamp.
 */
const GIT_EXEC_PATH = /(^|\/)\.git\/(config|hooks)(\/|$)/i

function normalise(p: string): { text: string; absolute: boolean; escapes: boolean } {
	let slashed = p.replace(/\\/g, "/").replace(/^\/\/[?.]\//, "")
	// macOS: /var, /tmp and /etc are links into /private
	slashed = slashed.replace(/^\/private\/(var|tmp|etc)\b/i, "/$1")
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

/** `.ssh/id`, `.aihydro/approvals/x`: leading segments equal the trailing segments of a root. */
function relativeLooksLikeRoot(relative: string, roots: readonly string[]): boolean {
	const segs = relative.split("/").filter(Boolean)
	for (const root of roots) {
		const rootSegs = normalise(root).text.split("/").filter(Boolean)
		for (let k = 1; k <= Math.min(segs.length, rootSegs.length); k++) {
			const tail = rootSegs.slice(rootSegs.length - k)
			// One bare segment is only meaningful for a dot-directory (.ssh); a plain name like "registry" is ambiguous.
			if ((k > 1 || tail[0].startsWith(".")) && tail.every((seg, i) => seg === segs[i])) {
				return true
			}
		}
	}
	return false
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
		return target.escapes || relativeLooksLikeRoot(target.text, roots)
	}
	for (const root of roots) {
		const r = normalise(root)
		if (target.text === r.text || target.text.startsWith(r.text.endsWith("/") ? r.text : `${r.text}/`)) {
			return true
		}
	}
	return false
}
