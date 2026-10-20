import type React from "react"

/**
 * A single quiet line for host-side corrections the user need not act on (a nonexistent tool name that was
 * refused, a malformed tool call that was retried). Text format of the `info` say: the first paragraph is the
 * muted line; anything after the first blank line is raw detail, kept behind a disclosure.
 */
export function splitNotice(text: string | undefined): { line: string; detail?: string } {
	const value = (text ?? "").trim()
	const sep = value.indexOf("\n\n")
	if (sep === -1) {
		return { line: value }
	}
	return { line: value.slice(0, sep).trim(), detail: value.slice(sep + 2).trim() || undefined }
}

export const MutedNotice: React.FC<{ text?: string }> = ({ text }) => {
	const { line, detail } = splitNotice(text)
	if (!line) {
		return null
	}
	return (
		<div className="text-xs opacity-60 py-0.5" data-testid="muted-notice">
			<span aria-hidden="true" className="codicon codicon-info mr-1 align-middle" />
			<span className="ph-no-capture">{line}</span>
			{detail && (
				<details className="mt-1">
					<summary className="cursor-pointer select-none">Show raw text</summary>
					<pre className="whitespace-pre-wrap break-words mt-1 p-1.5 rounded-sm bg-[var(--vscode-textCodeBlock-background)] ph-no-capture">
						{detail}
					</pre>
				</details>
			)}
		</div>
	)
}
