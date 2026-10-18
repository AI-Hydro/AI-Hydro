/** Plain-text rendering of a markdown task title: no markers, links reduced to their text, whitespace collapsed. */
export function stripMarkdown(input: string): string {
	let text = input
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
	// Single-pass tag removal lets `<<b>img ...>` re-form a tag, so strip until stable. The result is still
	// treated as untrusted text by callers: it is rendered as React text nodes, never as HTML.
	for (let prev = ""; prev !== text; ) {
		prev = text
		text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "")
	}
	return (
		text
			.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
			// Underscore emphasis only counts at word boundaries, so snake_case_name and a_b_c survive intact.
			.replace(/(?<![\w])(\*\*|__)(?=\S)(.+?)(?<=\S)\1(?![\w])/g, "$2")
			.replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])|(?<![\w])_(?=\S)(.+?)(?<=\S)_(?![\w])/g, "$1$2")
			.replace(/~~(.+?)~~/g, "$1")
			.replace(/`([^`]*)`/g, "$1")
			.replace(/\s+/g, " ")
			.trim()
	)
}
